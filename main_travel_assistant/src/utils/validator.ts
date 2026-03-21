import type { InternalResponse } from '../types';
import { logger } from './logger';

const MAX_LEN = 4096;

/**
 * Validate user input. Returns error response if invalid, null if OK.
 */
export function validateInput(text: string): InternalResponse | null {
  if (!text || text.trim().length === 0) {
    return {
      type: 'clarify',
      message:
        'Bạn muốn hỏi gì ạ? 😊\nTôi có thể giúp tìm thông tin du lịch Ninh Bình:\n• Giá vé\n• Giờ mở cửa\n• Thời tiết\n• Tìm đường\n• Địa điểm gần đây\n• Tour du lịch',
    };
  }

  if (text.length > MAX_LEN) {
    return { type: 'error', message: 'Tin nhắn quá dài. Bạn vui lòng gửi ngắn hơn nhé.' };
  }

  // Gibberish check: strip non-readable chars
  const readable = text.replace(/[^a-zA-ZÀ-ỹ0-9\s]/g, '').trim();
  if (readable.length < 2) {
    return {
      type: 'clarify',
      message: 'Mình chưa hiểu ý bạn. Bạn có thể hỏi về giá vé, giờ mở cửa, thời tiết, hoặc tìm địa điểm ạ.',
    };
  }

  return null;
}

const MAX_MESSAGE_LEN = 4000; // Telegram limit 4096, leave 96 overhead

/**
 * Validate and sanitize a handler response before sending.
 * Ensures `type` and `message` are present, truncates if needed.
 */
export function validateResponse(response: any): InternalResponse {
  if (
    !response ||
    typeof response.type !== 'string' ||
    typeof response.message !== 'string' ||
    response.message.length === 0
  ) {
    logger.warn('[Validator] Malformed handler response');
    return { type: 'error', message: 'Xin lỗi, đã xảy ra lỗi. Bạn thử lại sau nhé.' };
  }
  if (response.message.length > MAX_MESSAGE_LEN) {
    logger.warn(`[Validator] Truncating response: ${response.message.length} chars`);
    return {
      ...response,
      message: response.message.slice(0, MAX_MESSAGE_LEN) + '\n\n... (đã cắt bớt)',
    };
  }
  return response;
}
