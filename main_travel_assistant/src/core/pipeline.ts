import type { InternalMessage, InternalResponse, ClassifyResult, HandlerFn, IntentName } from '../types';
import { validateInput, validateResponse } from '../utils/validator';
import { scoreKeywordIntents } from './intent.engine';
import { validateContext } from './context';
import { validateEntity } from './contextGuard';
import { getMissingSlot, extractFilledSlots } from './slotSchema';
import { extractWeatherSlots } from './slotExtractor';
import { extractSignals } from './signalExtractor';
import { isDuplicate, rollbackIdempotency } from '../services/idempotency';
import { loadSession, saveSession, updateSessionAfterResponse } from '../services/session';
import { logSearch, type SearchLogMeta } from '../services/searchLog';
import { classifyWithLlm } from '../services/llm';
import { resolveSlug } from '../utils/slugResolver';
import { normalize, tokenize, stripNoiseTokens } from '../utils/normalize';
import { parseDirections, parseTour } from '../utils/parser';
import { composeResponse } from '../services/responseComposer';
import { logger } from '../utils/logger';
import { matchEntities } from './entityGraph';
import { scoreIntents, detectMultiIntent } from './intentGraph';
import { resolveAmbiguity } from './ambiguityResolver';
import { handleMultiIntent } from './multiIntentHandler';

// ── Handler timeout ──
const HANDLER_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Handler timeout: ${label} (${ms}ms)`)), ms),
    ),
  ]);
}

// ── Handler registry ──
const handlers = new Map<string, HandlerFn>();

export function registerIntent(intent: string, handler: HandlerFn): void {
  handlers.set(intent, handler);
}

// ── Fallback / clarify messages ──
const FALLBACK_MSG =
  '🤖 Mình chưa hiểu ý bạn. Bạn có thể hỏi về:\n' +
  '• Giá vé (ví dụ: giá vé Tràng An)\n' +
  '• Giờ mở cửa\n' +
  '• Thời tiết\n' +
  '• Chỉ đường (từ A đến B)\n' +
  '• Địa điểm gần đây\n' +
  '• Tour du lịch';

const FINAL_FALLBACK = 'Bạn có thể nhập đầy đủ tên địa điểm giúp mình nhé.';

/** All intents that support multi-turn slot filling */
const MULTI_TURN_INTENTS = new Set<string>([
  'GET_TICKET_PRICE', 'GET_OPENING_HOURS', 'GET_WEATHER',
  'GET_PLACE_INFO', 'SEARCH_NEARBY', 'SEARCH_TOUR', 'GET_DIRECTIONS',
  'DISCOVER_LOCATION',
]);

/** Helper: clear all multi-turn fields from session */
function clearMultiTurnState(ctx_data: Record<string, any>): void {
  ctx_data.awaiting_entity = false;
  ctx_data.awaiting_intent = undefined;
  ctx_data.clarify_count = 0;
  ctx_data.pending_intent = undefined;
  ctx_data.filled_slots = undefined;
  ctx_data.awaiting_slot = undefined;
}

/**
 * Try to fill the awaiting slot from user text.
 * Returns the extracted value or undefined.
 */
function extractSlotValue(slotName: string, text: string): any {
  if (slotName === 'duration_days') {
    const tourParsed = parseTour(text);
    return tourParsed.duration_days || undefined;
  }
  // All other slots: treat the whole text as entity string
  const entity = normalize(text);
  return entity && entity.length >= 2 ? entity : undefined;
}

// ── Pipeline Trace ──
interface PipelineTrace {
  req_id: string;
  input: string;
  session_state: { pending_intent?: string; awaiting_slot?: string };
  signal_entities: string[];
  signal_keywords: string[];
  signal_patterns: string[];
  final_intent: string;
  entity_final: string;
  slug?: string;
  slot_complete: boolean;
  missing_slot?: string;
  handler: string;
  response_type: string;
  composed: boolean;
  latency_ms: number;
}

/**
 * Main pipeline — Signal Fusion NLP.
 *
 *   validate → session → [slot-fill?] → signal pipeline → context gate → resolve → handle → compose → log
 *
 * Signal pipeline (unified — ALL intents go through the same flow):
 *   1. NORMALIZE — lowercase + strip diacritics + remove punctuation
 *   2. TOKENIZE — split whitespace
 *   3. ENTITY EXTRACTION — longest-first N-gram match on FULL tokens
 *   3.5 SIGNAL EXTRACTION — structural patterns + question frames on remaining tokens
 *   4. NOISE FILTER — strip filler words (excluding entity + signal consumed tokens)
 *   5. INTENT KEYWORD SCORING — contiguous + bag-of-words on signal tokens
 *   6. INTENT RESOLVER — keyword scores + signal boosts + entity meta + ambiguity
 *   7. LLM FALLBACK — only when no keywords + no signals + no entity
 *   8. SLOT FILL — post-classification parsers (directions, tour, weather)
 *
 * NEVER throws. Always returns a structured response.
 */
export async function runPipeline(message: InternalMessage): Promise<InternalResponse> {
  const updateId = (message.metadata?.updateId as string) || '';
  const reqId = (message.metadata?.reqId as string) || '';
  const start = Date.now();

  const trace: PipelineTrace = {
    req_id: reqId,
    input: message.text,
    session_state: {},
    signal_entities: [],
    signal_keywords: [],
    signal_patterns: [],
    final_intent: 'UNKNOWN',
    entity_final: '',
    slot_complete: true,
    handler: 'none',
    response_type: 'unknown',
    composed: false,
    latency_ms: 0,
  };

  try {
    // 1. Idempotency
    if (updateId && (await isDuplicate(updateId))) {
      return { type: 'text', message: 'OK' };
    }

    logger.debug(`[Pipeline] ▶ START text="${message.text}" userId=${message.userId} reqId=${reqId}`);

    // 2. Load session
    const session = await loadSession(message.sessionId);
    logger.debug(`[Pipeline] session loaded: pending_intent=${session.context_data.pending_intent ?? 'none'} awaiting_slot=${session.context_data.awaiting_slot ?? 'none'} filled_slots=${JSON.stringify(session.context_data.filled_slots ?? {})}`);
    trace.session_state = {
      pending_intent: session.context_data.pending_intent,
      awaiting_slot: session.context_data.awaiting_slot,
    };

    // 3. Validate input
    const inputErr = validateInput(message.text);
    if (inputErr) return inputErr;

    let ctx: ClassifyResult | undefined;

    // ────────────────────────────────────────────────
    // 4. Multi-turn slot filling: session has pending_intent?
    // ────────────────────────────────────────────────
    if (session.context_data.pending_intent && session.context_data.awaiting_slot) {
      const pendingIntent = session.context_data.pending_intent as IntentName;
      const awaitingSlot = session.context_data.awaiting_slot;
      const filledSlots = session.context_data.filled_slots || {};
      const entity = normalize(message.text);
      logger.debug(`[Pipeline] Multi-turn resume: pending=${pendingIntent} awaiting=${awaitingSlot} filled=${JSON.stringify(filledSlots)} entity="${entity}"`);
      const guard = validateEntity(message.text, entity, session, awaitingSlot);

      logger.debug(`[Pipeline] Guard action: ${guard.action}`);

      switch (guard.action) {
        case 'cancel':
          clearMultiTurnState(session.context_data);
          await saveSession(session);
          return { type: 'text', message: guard.message! };

        case 'expired':
          clearMultiTurnState(session.context_data);
          await saveSession(session);
          logger.info(`[Pipeline] Session expired, processing fresh. reqId=${reqId}`);
          break; // fall through to fresh classification

        case 'reject_stopword': {
          const count = (session.context_data.clarify_count || 0) + 1;
          session.context_data.clarify_count = count;
          session.context_data.last_interaction = Date.now();

          if (count >= 3) {
            clearMultiTurnState(session.context_data);
            await saveSession(session);
            return { type: 'clarify', message: FINAL_FALLBACK };
          }

          await saveSession(session);
          return { type: 'clarify', message: guard.message! };
        }

        case 'proceed': {
          // Check if user sent a completely new intent (override) using signal pipeline
          const overrideTokens = tokenize(normalize(message.text));
          const overrideEntityResult = matchEntities(overrideTokens);
          const overrideRemaining = overrideTokens.filter((_, idx) => !overrideEntityResult.consumedIndices.has(idx));
          const overrideSignal = stripNoiseTokens(overrideRemaining);
          const overrideKw = scoreKeywordIntents(overrideSignal);

          if (overrideKw.length > 0 && overrideKw[0].intent !== pendingIntent) {
            // OVERRIDE: user changed their mind to a DIFFERENT intent
            clearMultiTurnState(session.context_data);
            await saveSession(session);
            const overrideEntity = overrideEntityResult.entities[0];
            ctx = {
              intent: overrideKw[0].intent,
              entity: overrideEntity?.node.name || '',
              slug: overrideEntity?.node.slug,
              confidence: 1,
              source: 'rule',
            };
            logger.info(
              `[Pipeline] Intent override: ${pendingIntent} → ${ctx.intent} reqId=${reqId}`,
            );
          } else {
            // RESUME: same intent or no intent detected — extract slot value and merge
            const slotValue = extractSlotValue(awaitingSlot, message.text);
            logger.debug(`[Pipeline] Slot fill: awaiting=${awaitingSlot} extracted=${JSON.stringify(slotValue)}`);
            if (slotValue !== undefined) {
              filledSlots[awaitingSlot] = slotValue;
            }

            // Also try parseTour for SEARCH_TOUR to catch duration from "tour 3 ngày"
            if (pendingIntent === 'SEARCH_TOUR') {
              const tourParsed = parseTour(message.text);
              if (tourParsed.duration_days && !filledSlots.duration_days) {
                filledSlots.duration_days = tourParsed.duration_days;
              }
              if (tourParsed.entity && tourParsed.entity.length >= 2) {
                const current = filledSlots.entity || '';
                if (!current || current.split(/\s+/).length > 3) {
                  filledSlots.entity = tourParsed.entity;
                }
              }
            }

            // Build ctx from filled slots
            ctx = {
              intent: pendingIntent,
              entity: filledSlots.entity || '',
              entity_origin: filledSlots.entity_origin,
              entity_destination: filledSlots.entity_destination,
              duration_days: filledSlots.duration_days,
              _nearbyCategory: filledSlots._nearbyCategory,
              _routeMode: filledSlots._routeMode,
              confidence: 0.8,
              source: 'context',
            } as ClassifyResult;

            // Check if more slots are still missing
            const stillMissing = getMissingSlot(pendingIntent, ctx);
            if (stillMissing) {
              session.context_data.filled_slots = filledSlots;
              session.context_data.awaiting_slot = stillMissing.name;
              session.context_data.clarify_count = 0;
              session.context_data.last_interaction = Date.now();
              await saveSession(session);
              return { type: 'clarify', message: stillMissing.prompt };
            }

            // All slots filled — clear state and proceed
            clearMultiTurnState(session.context_data);
            await saveSession(session);
            logger.info(
              `[Pipeline] Slots filled: intent=${ctx.intent} slots=${JSON.stringify(filledSlots)} reqId=${reqId}`,
            );
          }
          break;
        }
      }
    }
    // ── V3 compat: awaiting_entity without V4 fields ──
    else if (session.context_data.awaiting_entity && session.context_data.awaiting_intent) {
      const awaitingIntent = session.context_data.awaiting_intent as IntentName;
      const entity = normalize(message.text);
      const guard = validateEntity(message.text, entity, session);

      switch (guard.action) {
        case 'cancel':
          clearMultiTurnState(session.context_data);
          await saveSession(session);
          return { type: 'text', message: guard.message! };

        case 'expired':
          clearMultiTurnState(session.context_data);
          await saveSession(session);
          break;

        case 'reject_stopword': {
          const count = (session.context_data.clarify_count || 0) + 1;
          session.context_data.clarify_count = count;
          session.context_data.last_interaction = Date.now();
          if (count >= 3) {
            clearMultiTurnState(session.context_data);
            await saveSession(session);
            return { type: 'clarify', message: FINAL_FALLBACK };
          }
          await saveSession(session);
          return { type: 'clarify', message: guard.message! };
        }

        case 'proceed': {
          // Quick check if user typed a new intent
          const overrideTokens = tokenize(normalize(message.text));
          const overrideEntityResult = matchEntities(overrideTokens);
          const overrideRemaining = overrideTokens.filter((_, idx) => !overrideEntityResult.consumedIndices.has(idx));
          const overrideKw = scoreKeywordIntents(stripNoiseTokens(overrideRemaining));

          clearMultiTurnState(session.context_data);
          await saveSession(session);

          if (overrideKw.length > 0) {
            const overrideEntity = overrideEntityResult.entities[0];
            ctx = {
              intent: overrideKw[0].intent,
              entity: overrideEntity?.node.name || normalize(message.text),
              slug: overrideEntity?.node.slug,
              confidence: 1,
              source: 'rule',
            };
          } else {
            ctx = {
              intent: awaitingIntent,
              entity,
              confidence: 0.8,
              source: 'context',
            };
          }
          break;
        }
      }
    }

    // ────────────────────────────────────────────────
    // 5. Fresh classification — Signal Fusion NLP Pipeline
    //
    //   Step 1: NORMALIZE
    //   Step 2: TOKENIZE
    //   Step 3: ENTITY EXTRACTION — on FULL tokens (before noise filter)
    //   Step 3.5: SIGNAL EXTRACTION — structural patterns + question frames
    //   Step 4: NOISE FILTER — on REMAINING tokens (excluding entity + signal consumed)
    //   Step 5: INTENT KEYWORD SCORING — contiguous + bag-of-words
    //   Step 6: INTENT RESOLVER — keyword + signal boosts + entity meta + ambiguity
    //   Step 7: LLM FALLBACK — only when UNKNOWN
    //   Step 8: SLOT FILL — parseDirections, parseTour, extractWeatherSlots
    // ────────────────────────────────────────────────
    if (!ctx) {
      // ── Step 1: Normalize ──
      const cleaned = normalize(message.text);

      // ── Step 2: Tokenize ──
      const tokens = tokenize(cleaned);

      // ── Step 3: Entity extraction on FULL tokens (before noise filter) ──
      const entityResult = matchEntities(tokens);
      const graphEntities = entityResult.entities;
      trace.signal_entities = graphEntities.map(e => `${e.node.name}(${e.node.type})`);

      if (graphEntities.length > 0) {
        logger.debug(
          `[Pipeline] EntityGraph: ${trace.signal_entities.join(', ')} reqId=${reqId}`,
        );
      }

      // ── Step 3.5: Signal extraction on REMAINING tokens ──
      const signals = extractSignals(tokens, entityResult.consumedIndices);
      trace.signal_patterns = signals.matchedPatterns;

      if (signals.matchedPatterns.length > 0) {
        logger.debug(
          `[Pipeline] Signals: ${signals.matchedPatterns.join(', ')} ` +
          `boosts=[${[...signals.intentBoosts.entries()].map(([k, v]) => `${k}=${v}`).join(',')}] ` +
          `slots=${JSON.stringify(signals.slots)} reqId=${reqId}`,
        );
      }

      // ── Step 4: Noise filter — exclude entity AND signal consumed indices ──
      const allConsumed = new Set([...entityResult.consumedIndices, ...signals.consumedIndices]);
      const remaining = tokens.filter((_, idx) => !allConsumed.has(idx));
      const signalTokens = stripNoiseTokens(remaining);

      logger.debug(
        `[Pipeline] Tokens: all=${tokens.length} entity_consumed=${entityResult.consumedIndices.size} ` +
        `signal_consumed=${signals.consumedIndices.size} ` +
        `remaining=${remaining.length} signal=${signalTokens.length} ` +
        `signal=[${signalTokens.join(',')}] reqId=${reqId}`,
      );

      // ── Multi-intent detection (before scoring) ──
      const multiResult = detectMultiIntent(message.text, graphEntities, session);
      if (multiResult.isMulti && multiResult.intents.length >= 2) {
        logger.info(`[Pipeline] Multi-intent: ${multiResult.intents.map(i => i.intent).join(' + ')} reqId=${reqId}`);
        const merged = await handleMultiIntent(multiResult.intents, message, handlers);
        const latency = Date.now() - start;
        const primary = multiResult.intents[0];
        logSearch(
          message.chatId, message.text,
          { intent: primary.intent, entity: primary.entityName, confidence: primary.score, source: primary.source } as ClassifyResult,
          primary.slug,
          { is_unknown: false, is_missing_entity: false, is_fallback: false, latency_ms: latency },
        ).catch(() => {});
        await updateSessionAfterResponse(message.sessionId, primary.intent, primary.entityName, primary.slug);
        trace.final_intent = multiResult.intents.map(i => i.intent).join('+');
        trace.latency_ms = latency;
        logger.debug({ message: '[Trace]', ...trace });
        return merged;
      }

      // ── Step 5: Intent keyword scoring on signal tokens ──
      const keywordScores = scoreKeywordIntents(signalTokens);
      trace.signal_keywords = keywordScores.map(k => `${k.intent}(${k.score})`);

        logger.debug(
          `[Pipeline] KeywordScores: ${keywordScores.length > 0
            ? keywordScores.map(k => `${k.intent}=${k.score} [${k.matchedKeywords.join(',')}]`).join(', ')
            : 'none'
          } reqId=${reqId}`,
        );

        // ── Step 6: Intent resolver (entity-aware scoring + ambiguity + signals) ──
        const scored = scoreIntents(keywordScores, graphEntities, session, signals);

        if (scored.length > 0) {
          const resolved = resolveAmbiguity(scored, graphEntities, session);

          if (resolved.action === 'clarify' && resolved.clarifyMessage) {
            session.context_data.last_interaction = Date.now();
            await saveSession(session);
            trace.final_intent = 'AMBIGUOUS';
            trace.latency_ms = Date.now() - start;
            logger.info(`[Pipeline] Ambiguity → clarify reqId=${reqId}`);
            logger.debug({ message: '[Trace]', ...trace });
            return { type: 'clarify', message: resolved.clarifyMessage };
          }

          if (resolved.action === 'proceed' && resolved.primary) {
            const p = resolved.primary;
            ctx = {
              intent: p.intent,
              entity: p.entityName || '',
              slug: p.slug,
              confidence: p.score,
              source: p.source,
              duration_days: p.duration_days,
              entity_origin: p.entity_origin,
              entity_destination: p.entity_destination,
              _routeMode: p._routeMode,
              _nearbyCategory: p._nearbyCategory,
              _weatherMode: p._weatherMode,
              _forecastDays: p._forecastDays,
              _forecastOffset: p._forecastOffset,
            };
          }
        }

        // ── Step 7: LLM fallback — only when no keywords + no entity ──
        if (!ctx || ctx.intent === 'UNKNOWN') {
          const llmResult = await classifyWithLlm(message.text);
          if (llmResult && llmResult.intent !== 'UNKNOWN') {
            ctx = {
              intent: llmResult.intent,
              entity: llmResult.entity || (graphEntities[0]?.node.name ?? ''),
              slug: graphEntities[0]?.node.slug,
              entity_origin: llmResult.entity_origin,
              entity_destination: llmResult.entity_destination,
              duration_days: llmResult.duration_days,
              confidence: 0.7,
              source: 'llm',
            };
            logger.info(`[Pipeline] LLM classify: intent=${ctx.intent} entity="${ctx.entity}" reqId=${reqId}`);
          }
        }

        // If still no ctx, build UNKNOWN
        if (!ctx) {
          ctx = {
            intent: 'UNKNOWN',
            entity: graphEntities[0]?.node.name || '',
            slug: graphEntities[0]?.node.slug,
            confidence: 0,
            source: 'rule',
          };
        }
    }

    logger.info(
      `[Pipeline] intent=${ctx.intent} entity="${ctx.entity}" confidence=${ctx.confidence} source=${ctx.source} reqId=${reqId}`,
    );
    trace.final_intent = ctx.intent;
    trace.entity_final = ctx.entity || '';

    // ── Universal parseTour for SEARCH_TOUR (all paths) ──
    if (ctx.intent === 'SEARCH_TOUR') {
      const tourParsed = parseTour(message.text);
      if (tourParsed.duration_days && !ctx.duration_days) {
        ctx = { ...ctx, duration_days: tourParsed.duration_days };
      }
      if (tourParsed.entity && (!ctx.entity || ctx.entity.length < 2)) {
        ctx = { ...ctx, entity: tourParsed.entity };
      }
    }

    // ── Universal parseDirections for GET_DIRECTIONS (all paths) ──
    if (ctx.intent === 'GET_DIRECTIONS' && !ctx.entity_origin) {
      const parsed = parseDirections(message.text);
      if (parsed) {
        ctx = {
          ...ctx,
          entity_origin: parsed.entity_origin,
          entity_destination: parsed.entity_destination,
          _routeMode: parsed._routeMode || ctx._routeMode,
        };
        logger.debug(`[Pipeline] Direction slots: origin="${parsed.entity_origin}" dest="${parsed.entity_destination}" mode=${parsed._routeMode || 'default'} reqId=${reqId}`);
      }
    }

    // ── Weather slot extraction: separate time phrase from entity ──
    if (ctx.intent === 'GET_WEATHER') {
      const rawEntity = ctx.entity || '';
      const weatherSlots = extractWeatherSlots(rawEntity);
      if (weatherSlots.mode === 'forecast' || weatherSlots.timePrase) {
        logger.debug(
          `[Pipeline] WeatherSlot: raw="${rawEntity}" → location="${weatherSlots.location}" mode=${weatherSlots.mode} days=${weatherSlots.forecastDays} offset=${weatherSlots.startOffset}`,
        );
        ctx = {
          ...ctx,
          _weatherMode: weatherSlots.mode,
          _forecastDays: weatherSlots.forecastDays,
          _forecastOffset: weatherSlots.startOffset,
        };
        if (!ctx.entity || ctx.entity === rawEntity) {
          ctx = { ...ctx, entity: weatherSlots.location };
        }
      }
    }

    // ────────────────────────────────────────────────
    // 6. Context carry-over — inject session.last_slug when entity is empty
    // ────────────────────────────────────────────────
    if (
      MULTI_TURN_INTENTS.has(ctx.intent) &&
      ctx.intent !== 'SEARCH_TOUR' &&
      ctx.intent !== 'GET_DIRECTIONS' &&
      (!ctx.entity || ctx.entity.length < 2) &&
      session.context_data.last_slug
    ) {
      ctx = {
        ...ctx,
        entity: session.context_data.last_entity || session.context_data.last_slug,
        slug: session.context_data.last_slug,
        source: 'context',
      };
      logger.info(
        `[Pipeline] Context carry-over: slug=${ctx.slug} from session reqId=${reqId}`,
      );
    }

    // ────────────────────────────────────────────────
    // 7. Context gate — slotSchema-based missing field detection
    // ────────────────────────────────────────────────
    const missing = validateContext(ctx);
    if (missing) {
      logger.debug(`[Pipeline] context gate: MISSING slot — asking: "${missing.message}"`);
      trace.slot_complete = false;
      trace.missing_slot = missing.message.slice(0, 60);
      if (MULTI_TURN_INTENTS.has(ctx.intent)) {
        const count = (session.context_data.clarify_count || 0) + 1;

        if (count >= 3) {
          clearMultiTurnState(session.context_data);
          await saveSession(session);
          return { type: 'clarify', message: FINAL_FALLBACK };
        }

        const missingSlot = getMissingSlot(ctx.intent, ctx);
        session.context_data.pending_intent = ctx.intent;
        session.context_data.filled_slots = extractFilledSlots(ctx);
        session.context_data.awaiting_slot = missingSlot?.name || 'entity';
        session.context_data.awaiting_entity = true;
        session.context_data.awaiting_intent = ctx.intent;
        session.context_data.clarify_count = count;
        session.context_data.last_interaction = Date.now();
        await saveSession(session);

        return missing;
      }

      return missing;
    }

    // ────────────────────────────────────────────────
    // 8. Resolve slug for entity
    // ────────────────────────────────────────────────
    let resolvedSlug: string | undefined = ctx.slug;
    if (!resolvedSlug && ctx.entity) {
      resolvedSlug = await resolveSlug(ctx.entity);
      ctx = { ...ctx, slug: resolvedSlug };
    }
    logger.debug(`[Pipeline] slug resolved: entity="${ctx.entity}" slug="${resolvedSlug ?? 'none'}"`);
    trace.slug = resolvedSlug;

    // ── 8b. UNKNOWN intent promotion ──
    if (ctx.intent === 'UNKNOWN' && resolvedSlug && ctx.entity && ctx.entity.length >= 2) {
      logger.info(
        `[Pipeline] Promoting UNKNOWN → GET_PLACE_INFO (slug="${resolvedSlug}" resolved from "${ctx.entity}") reqId=${reqId}`,
      );
      ctx = { ...ctx, intent: 'GET_PLACE_INFO', confidence: 0.6 };
      trace.final_intent = 'GET_PLACE_INFO';
    }

    // 9. Dispatch to handler
    const handler = handlers.get(ctx.intent) || handlers.get('UNKNOWN');
    if (!handler) {
      return { type: 'text', message: FALLBACK_MSG };
    }
    trace.handler = ctx.intent;
    logger.debug(`[Pipeline] ▶ Dispatching to handler: ${ctx.intent} entity="${ctx.entity}" slug="${resolvedSlug ?? 'none'}" duration=${ctx.duration_days ?? 'none'} weatherMode=${ctx._weatherMode ?? 'none'}`);

    const rawResponse = await withTimeout(handler(message, ctx), HANDLER_TIMEOUT_MS, ctx.intent);
    const validated = validateResponse(rawResponse);
    logger.debug(`[Pipeline] Handler returned: type=${validated.type} msg_len=${validated.message?.length ?? 0}`);

    // 9b. Handler-triggered clarify — save multi-turn state
    if (validated.type === 'clarify' && MULTI_TURN_INTENTS.has(ctx.intent)) {
      logger.debug(`[Pipeline] Handler returned clarify for ${ctx.intent} — saving slot state`);
      const filledSlots = extractFilledSlots(ctx);
      const missingSlot = getMissingSlot(ctx.intent, ctx);
      let awaitingSlotName = missingSlot?.name || 'entity';

      if (ctx.intent === 'SEARCH_TOUR' && filledSlots.entity && !filledSlots.duration_days) {
        awaitingSlotName = 'duration_days';
      }

      session.context_data.pending_intent = ctx.intent;
      session.context_data.filled_slots = filledSlots;
      session.context_data.awaiting_slot = awaitingSlotName;
      session.context_data.awaiting_entity = true;
      session.context_data.awaiting_intent = ctx.intent;
      session.context_data.clarify_count = 0;
      session.context_data.last_interaction = Date.now();
      session.context_data.last_intent = ctx.intent;
      session.context_data.last_entity = ctx.entity || session.context_data.last_entity;
      session.context_data.last_slug = resolvedSlug || session.context_data.last_slug;
      await saveSession(session);

      logger.debug(`[Pipeline] Saved clarify state: awaiting_slot=${awaitingSlotName} filled=${JSON.stringify(filledSlots)}`);
      trace.response_type = validated.type;
      trace.latency_ms = Date.now() - start;
      logger.debug({ message: '[Trace]', ...trace });
      return validated;
    }

    // 10. LLM Response Composer
    const response = await composeResponse(validated, ctx.entity || '', ctx.intent);
    trace.composed = response !== validated;
    trace.response_type = response.type;

    // 11. Log search (fire-and-forget)
    const latency = Date.now() - start;
    const meta: SearchLogMeta = {
      is_unknown: ctx.intent === 'UNKNOWN',
      is_missing_entity: false,
      is_fallback: !handlers.has(ctx.intent),
      latency_ms: latency,
    };
    logSearch(message.chatId, message.text, ctx, resolvedSlug, meta).catch(() => {});

    // 12. Update session (clears all multi-turn state)
    await updateSessionAfterResponse(
      message.sessionId,
      ctx.intent,
      ctx.entity,
      resolvedSlug,
    );

    const cacheHit = response.data?._cacheHit === true;
    logger.info({
      message: '[Pipeline] Done',
      intent: ctx.intent,
      entity: ctx.entity,
      slug: resolvedSlug,
      source: ctx.source,
      cache_hit: cacheHit,
      response_type: response.type,
      latency_ms: latency,
      user_id: message.userId,
      reqId,
    });

    trace.latency_ms = latency;
    trace.entity_final = ctx.entity || '';
    logger.debug({ message: '[Trace]', ...trace });

    return response;
  } catch (error: any) {
    logger.error(`[Pipeline] Error reqId=${reqId}: ${error.message}`);
    if (updateId) await rollbackIdempotency(updateId).catch(() => {});
    return {
      type: 'error',
      message: '⚠️ Đã xảy ra lỗi. Bạn vui lòng thử lại sau giây lát nhé.',
    };
  }
}
