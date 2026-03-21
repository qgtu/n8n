import type { InternalMessage, InternalResponse, ClassifyResult } from '../types';

/**
 * UNKNOWN / fallback handler.
 * Triggered when no intent matched (or LLM also failed).
 */
export async function handleFallback(
  _message: InternalMessage,
  _ctx: ClassifyResult,
): Promise<InternalResponse> {
  return {
    type: 'text',
    message:
      '🤖 Xin lỗi, mình chưa hiểu ý bạn.\n\n' +
      'Bạn có thể hỏi mình về:\n' +
      '• <b>Giá vé</b> — "giá vé Tràng An"\n' +
      '• <b>Giờ mở cửa</b> — "giờ mở cửa Hang Múa"\n' +
      '• <b>Thời tiết</b> — "thời tiết Ninh Bình"\n' +
      '• <b>Chỉ đường</b> — "từ Tam Cốc đến Tràng An"\n' +
      '• <b>Gần đây</b> — "quán ăn gần Tràng An"\n' +
      '• <b>Tour</b> — "tour 3 ngày Ninh Bình"',
  };
}
