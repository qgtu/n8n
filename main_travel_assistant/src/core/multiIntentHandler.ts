/**
 * Multi-Intent Handler — Execute multiple intents in parallel, merge responses.
 *
 * When user asks "giá vé và giờ mở cửa tam cốc":
 *   1. Execute TICKET_PRICE handler + OPENING_HOURS handler in parallel
 *   2. Merge both responses into a single message
 *   3. Skip LLM rewrite (template output is already formatted)
 *
 * Max 2 intents per message (prevent abuse/confusion).
 */

import type { InternalMessage, InternalResponse, ClassifyResult, HandlerFn } from '../types';
import type { ScoredIntent } from './intentGraph';
import { resolveSlug } from '../utils/slugResolver';
import { logger } from '../utils/logger';

// ── Types ──

const HANDLER_TIMEOUT_MS = 8_000;

// ── Public API ──

/**
 * Execute multiple intents in parallel and merge responses.
 *
 * @param intents - Array of scored intents (max 2)
 * @param message - Original user message
 * @param handlers - Handler registry from pipeline
 */
export async function handleMultiIntent(
  intents: ScoredIntent[],
  message: InternalMessage,
  handlers: Map<string, HandlerFn>,
): Promise<InternalResponse> {
  // Limit to 2 intents
  const toExecute = intents.slice(0, 2);

  logger.info(
    `[MultiIntent] Executing ${toExecute.length} intents: ${toExecute.map(i => i.intent).join(' + ')}`,
  );

  // Build ClassifyResult for each intent
  const tasks = toExecute.map(async (scored) => {
    const handler = handlers.get(scored.intent);
    if (!handler) {
      return { type: 'error' as const, message: '', intent: scored.intent };
    }

    // Resolve slug if entity available
    let slug = scored.slug;
    if (!slug && scored.entityName) {
      slug = await resolveSlug(scored.entityName);
    }

    const ctx: ClassifyResult = {
      intent: scored.intent,
      entity: scored.entityName,
      slug,
      confidence: scored.score,
      source: scored.source,
      duration_days: scored.duration_days,
      entity_origin: scored.entity_origin,
      entity_destination: scored.entity_destination,
      _routeMode: scored._routeMode,
      _nearbyCategory: scored._nearbyCategory,
      _weatherMode: scored._weatherMode,
      _forecastDays: scored._forecastDays,
      _forecastOffset: scored._forecastOffset,
    };

    try {
      const result = await Promise.race([
        handler(message, ctx),
        new Promise<InternalResponse>((_, reject) =>
          setTimeout(() => reject(new Error(`MultiIntent timeout: ${scored.intent}`)), HANDLER_TIMEOUT_MS),
        ),
      ]);
      return { ...result, intent: scored.intent };
    } catch (err: any) {
      logger.error(`[MultiIntent] Handler ${scored.intent} failed: ${err.message}`);
      return { type: 'error' as const, message: '', intent: scored.intent };
    }
  });

  // Execute in parallel
  const results = await Promise.all(tasks);

  // Filter successful results
  const successful = results.filter(
    r => r.type !== 'error' && r.message && r.message.length > 0,
  );

  if (successful.length === 0) {
    return {
      type: 'error',
      message: '⚠️ Đã xảy ra lỗi. Bạn vui lòng thử lại sau giây lát nhé.',
    };
  }

  if (successful.length === 1) {
    // Only one succeeded — return as-is
    const { intent: _intent, ...response } = successful[0] as any;
    return response as InternalResponse;
  }

  // Merge multiple responses
  const merged = successful
    .map(r => r.message.trim())
    .join('\n\n━━━━━━━━━━━━━━━\n\n');

  logger.info(
    `[MultiIntent] Merged ${successful.length} responses (${merged.length} chars)`,
  );

  return {
    type: 'text',
    message: merged,
    data: { _multiIntent: true, intents: successful.map((r: any) => r.intent) },
  };
}
