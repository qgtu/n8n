/**
 * Text normalization: NFC unicode, lowercase, remove punctuation, remove fillers.
 * extracted from n8n nodes for consistency.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  
  return text
    .normalize('NFC')
    .toLowerCase()
    // Remove punctuation
    .replace(/[.,!?;:]/g, '')
    // Remove filler words (Vietnam specific)
    .replace(/\b(thông tin|cho tôi biết|cho tôi|giúp tôi|tôi cần|tôi muốn|cần biết|muốn biết|xem|tìm hiểu|tìm|hãy|về|của|là|ở|tại|vào|cửa|vé|bao nhiêu|bao nhieu|hết|tất cả|vui lòng|nhé|nha|đi|à|ạ|giá|giá vé|gia ve)\b/gi, '')
    // Collapse spaces
    .replace(/\s+/g, ' ')
    .trim();
}
