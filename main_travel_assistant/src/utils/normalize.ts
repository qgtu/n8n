/**
 * Normalize Engine — Signal-Based NLP.
 *
 * Single token space: lowercase + strip diacritics + remove punctuation.
 * Everything downstream (entity graph, intent keywords) operates on this output.
 */

/**
 * Single normalize: lowercase, strip diacritics, remove punctuation, collapse whitespace.
 * This is the ONLY normalization step. Everything downstream works on this output.
 *
 * "Thông tin, giá vé Đền Thái Vi?" → "thong tin gia ve den thai vi"
 */
export function normalize(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[.,!?;:""'`()\[\]{}@#$%^&*~]/g, '')  // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split normalized text into tokens.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text.split(/\s+/).filter(Boolean);
}

// ── Backward compat aliases ──

/** @deprecated Use normalize() instead */
export const normalizeForClassifier = normalize;

/** @deprecated Use normalize() instead */
export const normalizeForEntity = normalize;

/**
 * Escape HTML special characters for safe interpolation into Telegram HTML messages.
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Noise filter ──

/**
 * Filler words that never contribute to intent/entity matching.
 *
 * REMOVED: 'cho' (homograph: chợ=market), 'di' (homograph: entity names),
 *          'hay' (discovery signal "interesting") — handled by signalExtractor instead.
 * ADDED:   'vay','roi','nua','ne','ma','la','lam','qua' — pure filler particles.
 */
const NOISE_TOKENS = new Set([
  'toi', 'minh', 'giup', 'oi', 'a', 'nhe', 'nha',
  'cai', 'thi', 'het', 'duoc',
  'xin', 'vui', 'long',
  'vay', 'roi', 'nua', 'ne', 'ma', 'la', 'lam', 'qua',
]);

/**
 * Strip meaningless filler tokens from remaining (non-entity) tokens.
 * Only removes single-token noise. Does NOT touch entity or keyword tokens.
 * Returns filtered token array (may be shorter).
 */
export function stripNoiseTokens(tokens: string[]): string[] {
  return tokens.filter(t => !NOISE_TOKENS.has(t));
}
