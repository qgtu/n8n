import type { InternalResponse, IntentName } from '../types';

export type FallbackType =
  | 'ENTITY_NOT_FOUND'      // geocode + DB both miss
  | 'AMBIGUOUS_ENTITY'      // multiple high-confidence candidates in different locations
  | 'COUNTRY_LEVEL_ENTITY'  // entity is a country, need a city
  | 'NO_RESULT'             // location found but no data in DB or APIs
  | 'API_UNAVAILABLE'       // external API timeout / circuit open
  | 'NEEDS_CLARIFICATION'   // entity too short / unclear

// Contextual display names per intent (for natural messages)
const INTENT_CONTEXT: Partial<Record<IntentName, string>> = {
  GET_WEATHER: 'thời tiết',
  GET_PLACE_INFO: 'thông tin địa điểm',
  GET_OPENING_HOURS: 'giờ mở cửa',
  GET_TICKET_PRICE: 'giá vé',
  SEARCH_NEARBY: 'địa điểm gần đây',
  GET_DIRECTIONS: 'chỉ đường',
  SEARCH_TOUR: 'tour du lịch',
  DISCOVER_LOCATION: 'địa điểm nổi bật',
};

/**
 * Build a standardized fallback InternalResponse.
 *
 * Usage in handlers:
 *   if (!loc) return buildFallback('ENTITY_NOT_FOUND', ctx.intent, ctx.entity);
 *   if (loc.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, ctx.entity);
 */
export function buildFallback(
  type: FallbackType,
  intent: IntentName | string,
  entityName?: string,
): InternalResponse {
  const entity = entityName?.trim() || 'địa điểm này';
  const context = INTENT_CONTEXT[intent as IntentName] ?? 'thông tin';

  switch (type) {
    case 'ENTITY_NOT_FOUND':
      return {
        type: 'not_found',
        message:
          `Mình không tìm được địa điểm "**${entity}**". ` +
          `Bạn thử nhập tên đầy đủ hơn hoặc kiểm tra lại chính tả nhé.`,
      };

    case 'AMBIGUOUS_ENTITY':
      return {
        type: 'clarify',
        message:
          `Mình tìm thấy nhiều địa điểm tên "**${entity}**" ở các nơi khác nhau. ` +
          `Bạn có thể cho mình biết thêm tên tỉnh/thành phố hoặc quốc gia không?`,
      };

    case 'COUNTRY_LEVEL_ENTITY':
      return {
        type: 'clarify',
        message:
          `"**${entity}**" là tên quốc gia. Bạn muốn hỏi về thành phố hoặc địa điểm cụ thể nào ở ${entity} không?`,
      };

    case 'NO_RESULT':
      return {
        type: 'not_found',
        message:
          `Mình chưa có ${context} về "**${entity}**". ` +
          `Bạn thử hỏi địa điểm khác hoặc liên hệ trực tiếp để biết thêm nhé.`,
      };

    case 'API_UNAVAILABLE':
      return {
        type: 'temp_error',
        message:
          `Hệ thống đang bận, không lấy được ${context} lúc này. ` +
          `Bạn thử lại sau ít phút nhé.`,
      };

    case 'NEEDS_CLARIFICATION':
      return {
        type: 'clarify',
        message:
          `Bạn muốn hỏi ${context} ở đâu vậy? ` +
          `Bạn cho mình biết tên địa điểm cụ thể hơn nhé.`,
      };
  }
}
