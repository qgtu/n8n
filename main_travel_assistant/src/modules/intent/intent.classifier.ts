import { Intent } from '../../shared/types/common.js';
import { normalizeText } from '../../shared/utils/normalize.js';

/**
 * Regex-based intent classification extracted from n8n Fn_DetectIntentRule.
 * Pure logic, no side effects.
 */
export function classifyIntent(text: string): { intent: Intent; entity: string | null } {
  const norm = normalizeText(text);
  
  // Rule 1: Get Ticket Price
  const ticketMatch = text.match(/(giá vé|vé vào|vé tham quan|bao nhiêu tiền|gia ve|ve vao|ve tham quan).*(đền|chùa|khu du lịch|động|hang|tràng an|bái đính|tam cốc|thái vi)/i);
  if (ticketMatch) {
    // Extract entity (very naive regex logic from original node)
    let entity = text.replace(/(giá vé|vé vào|vé tham quan|bao nhiêu tiền|gia ve|ve vao|ve tham quan|bao nhieu tien|là|bao nhiêu|o|tai|nhu the nao)/gi, '').trim();
    return { intent: Intent.GET_TICKET_PRICE, entity };
  }

  // Fallback / Other rules from n8n can be added here
  // For now, focusing on GET_TICKET_PRICE per plan
  
  return { intent: Intent.UNKNOWN, entity: null };
}
