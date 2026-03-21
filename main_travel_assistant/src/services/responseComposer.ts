import { env } from '../config/env';
import { http } from '../utils/http';
import { isCircuitClosed, recordSuccess, recordFailure } from '../utils/circuitBreaker';
import { normalize } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalResponse, IntentName } from '../types';

const CB_NAME = 'llm_composer';

const SYSTEM_PROMPT = `Bạn là trợ lý du lịch Ninh Bình thân thiện.
Viết lại dữ liệu JSON bên dưới thành đoạn văn tiếng Việt tự nhiên, dễ đọc.
KHÔNG bịa thêm thông tin — chỉ dùng dữ liệu được cung cấp.
Dùng emoji phù hợp. Giữ nguyên số liệu (giá, giờ, khoảng cách).
Giới hạn 300 từ. Có thể dùng HTML <b>, <i> cho Telegram.`;

/**
 * Utility intents — deterministic template output, no LLM rewrite.
 * These intents return structured data (numbers, times, prices) where
 * LLM rewriting adds latency and produces awkward marketing-tone text.
 */
const UTILITY_INTENTS: ReadonlySet<string> = new Set<IntentName>([
  'GET_DIRECTIONS',
  'GET_WEATHER',
  'GET_OPENING_HOURS',
  'GET_TICKET_PRICE',
]);

/**
 * LLM Response Composer — rewrites handler JSON data into natural Vietnamese.
 *
 * n8n node: HTTP_ResponseComposer + Fn_BuildFinalResponse
 *
 * **Never-fail**: any error → returns original response unchanged.
 * **Hallucination guard**: checks entity name appears in LLM output.
 * **Utility intents**: skipped entirely — handler templates are already formatted.
 */
export async function composeResponse(
  rawResponse: InternalResponse,
  entityName: string,
  intent?: string,
): Promise<InternalResponse> {
  // Skip LLM rewrite for utility intents — template output is better
  if (intent && UTILITY_INTENTS.has(intent)) {
    logger.debug(`[Composer] Skipping rewrite for utility intent ${intent}`);
    return rawResponse;
  }

  // Feature flag gate
  if (!env.API.OPENROUTER_KEY) return rawResponse;
  if (!rawResponse.data) return rawResponse;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn('[Composer] Circuit OPEN — returning raw response');
    return rawResponse;
  }

  try {
    const userPrompt = JSON.stringify({
      entity: entityName,
      data: rawResponse.data,
    });

    const res = await http.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.0-flash-001',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${env.API.OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 6000,
      },
    );

    const composed = res.data?.choices?.[0]?.message?.content?.trim();
    if (!composed || composed.length < 20) {
      recordSuccess(CB_NAME);
      return rawResponse;
    }

    // Hallucination guard: entity name must appear in LLM output
    if (entityName && entityName.length >= 2) {
      const entityNorm = normalize(entityName);
      const outputNorm = normalize(composed);
      if (!outputNorm.includes(entityNorm)) {
        logger.warn(
          `[Composer] Hallucination guard: "${entityName}" not found in LLM output — discarding`,
        );
        recordSuccess(CB_NAME);
        return rawResponse;
      }
    }

    recordSuccess(CB_NAME);
    logger.info(`[Composer] Rewrote response (${composed.length} chars)`);
    return { ...rawResponse, message: composed };
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[Composer] Failed: ${err.message} — returning raw response`);
    return rawResponse;
  }
}
