import { env } from '../config/env';
import { http } from '../utils/http';
import { isCircuitClosed, recordSuccess, recordFailure } from '../utils/circuitBreaker';
import { logger } from '../utils/logger';
import type { IntentName } from '../types';

const CB_NAME = 'llm';

/** Whitelist of valid intents the LLM is allowed to return */
const VALID_INTENTS: ReadonlySet<string> = new Set<IntentName>([
  'GET_PLACE_INFO',
  'GET_OPENING_HOURS',
  'GET_TICKET_PRICE',
  'GET_WEATHER',
  'SEARCH_NEARBY',
  'GET_DIRECTIONS',
  'SEARCH_TOUR',
  'UNKNOWN',
]);

// ── Full classification prompt (used when rule returns UNKNOWN) ─────────────
const CLASSIFY_SYSTEM_PROMPT = `You are an intent classifier for a Vietnamese travel assistant bot.
Given the user message, return ONLY a JSON object:
{"intent":"<INTENT>","entity":"<clean place name>","entity_origin":null,"entity_destination":null,"duration_days":null}

Valid intents: GET_PLACE_INFO, GET_OPENING_HOURS, GET_TICKET_PRICE, GET_WEATHER, SEARCH_NEARBY, GET_DIRECTIONS, SEARCH_TOUR, UNKNOWN.

Rules:
- entity: the clean place/location name only. Remove filler words, intent keywords, time expressions, and conversational particles.
- entity_origin + entity_destination: ONLY for GET_DIRECTIONS.
- duration_days: ONLY for SEARCH_TOUR (integer).
- Return UNKNOWN if not confident.
- Return ONLY the JSON, no explanation.`;

// ── Entity extraction prompt (used when rule already found the intent) ───────
const ENTITY_SYSTEM_PROMPT = `You are an entity extractor for a Vietnamese travel assistant.
The intent has already been identified. Your only job is to extract the clean location/place name from the user message.

Return ONLY a JSON object:
{"entity":"<clean place name>","entity_origin":null,"entity_destination":null,"duration_days":null}

Rules:
- entity: the place/location name ONLY. Strip all filler words, intent keywords (thời tiết, giá vé, giờ mở cửa, gần đây, tour...), time expressions (hiện tại, hôm nay, bây giờ...), prepositions (ở, tại, trong...), and conversational particles.
- entity_origin + entity_destination: only if intent is GET_DIRECTIONS.
- duration_days: only if intent is SEARCH_TOUR (integer).
- If no clear location found, return empty string for entity.
- Return ONLY the JSON, no explanation.`;

export interface LlmClassifyResult {
  intent: IntentName;
  entity: string;
  entity_origin?: string;
  entity_destination?: string;
  duration_days?: number;
}

/** Shared HTTP call to OpenRouter */
async function callLlm(systemPrompt: string, userText: string): Promise<string | null> {
  const res = await http.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: 150,
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${env.API.OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    },
  );
  return res.data?.choices?.[0]?.message?.content?.trim() ?? null;
}

/** Parse LLM JSON response safely */
function parseJson(raw: string): Record<string, any> | null {
  try {
    const jsonStr = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Full intent + entity classification.
 * Called ONLY when rule engine returns UNKNOWN.
 */
export async function classifyWithLlm(userText: string): Promise<LlmClassifyResult | null> {
  if (!env.API.OPENROUTER_KEY) return null;
  if (!isCircuitClosed(CB_NAME)) {
    logger.warn('[LLM] Circuit OPEN — skipping classify');
    return null;
  }

  try {
    const raw = await callLlm(CLASSIFY_SYSTEM_PROMPT, userText);
    if (!raw) { recordSuccess(CB_NAME); return null; }

    const parsed = parseJson(raw);
    if (!parsed || !VALID_INTENTS.has(parsed.intent)) {
      logger.warn(`[LLM] Invalid intent: "${parsed?.intent}" — rejected`);
      recordSuccess(CB_NAME);
      return null;
    }

    const result = buildResult(parsed.intent as IntentName, parsed);
    logger.info(`[LLM] classify: intent=${result.intent} entity="${result.entity}"`);
    recordSuccess(CB_NAME);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[LLM] classifyWithLlm failed: ${err.message}`);
    return null;
  }
}

/**
 * Entity-only extraction for a known intent.
 * Called in PARALLEL with rule engine for every non-UNKNOWN request.
 * Never throws — returns null on any failure.
 */
export async function extractEntityWithLlm(
  userText: string,
  intent: IntentName,
): Promise<LlmClassifyResult | null> {
  if (!env.API.OPENROUTER_KEY) return null;
  if (!isCircuitClosed(CB_NAME)) return null;

  try {
    const promptWithContext = `Intent: ${intent}\nMessage: ${userText}`;
    const raw = await callLlm(ENTITY_SYSTEM_PROMPT, promptWithContext);
    if (!raw) { recordSuccess(CB_NAME); return null; }

    const parsed = parseJson(raw);
    if (!parsed) { recordSuccess(CB_NAME); return null; }

    const result = buildResult(intent, parsed);
    logger.debug(`[LLM] extract entity: intent=${intent} entity="${result.entity}" origin="${result.entity_origin ?? ''}" dest="${result.entity_destination ?? ''}"`);
    recordSuccess(CB_NAME);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[LLM] extractEntityWithLlm failed: ${err.message}`);
    return null;
  }
}

function buildResult(intent: IntentName, parsed: Record<string, any>): LlmClassifyResult {
  return {
    intent,
    entity: typeof parsed.entity === 'string' ? parsed.entity.trim() : '',
    entity_origin: typeof parsed.entity_origin === 'string' && parsed.entity_origin.trim()
      ? parsed.entity_origin.trim() : undefined,
    entity_destination: typeof parsed.entity_destination === 'string' && parsed.entity_destination.trim()
      ? parsed.entity_destination.trim() : undefined,
    duration_days: typeof parsed.duration_days === 'number' && parsed.duration_days > 0
      ? parsed.duration_days : undefined,
  };
}
