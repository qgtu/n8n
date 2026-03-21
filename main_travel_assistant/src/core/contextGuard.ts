/**
 * ContextGuard — Conversation Safety Layer.
 *
 * Only validates entity in multi-turn context.
 * Does NOT detect intent or handle overrides (pipeline does that).
 *
 * Responsibilities:
 *   1. Stopword rejection (token-level)
 *   2. Cancel detection
 *   3. Session TTL expiry
 */

import type { BotSession } from '../types';

export interface GuardResult {
  action: 'proceed' | 'reject_stopword' | 'cancel' | 'expired';
  message?: string;
}

// Vietnamese filler / pronoun words that are NOT valid place names
const STOPWORDS = new Set([
  'đó', 'này', 'kia', 'đây', 'đi', 'ừ', 'ok', 'ờ', 'hả',
  'vâng', 'uh', 'à', 'ơi', 'nha', 'nhé', 'mà', 'ở', 'chỗ',
  'vậy', 'thế', 'rồi', 'được', 'có', 'không', 'hả', 'ạ',
]);

const CANCEL_WORDS = new Set([
  'thôi', 'không cần', 'bỏ đi', 'cancel', 'hủy', 'thôi không cần',
  'không', 'bỏ', 'dừng', 'stop',
]);

const SESSION_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Validate entity text during multi-turn awaiting state.
 *
 * Call this ONLY when session has pending multi-turn state.
 * Optional slotName for slot-specific rejection messages.
 */
export function validateEntity(
  text: string,
  entity: string,
  session: BotSession,
  slotName?: string,
): GuardResult {
  const trimmed = text.trim().toLowerCase();

  // 1. Cancel detection (exact match on full text)
  if (CANCEL_WORDS.has(trimmed)) {
    return {
      action: 'cancel',
      message: 'Ok, bạn cần mình hỗ trợ gì thêm không?',
    };
  }

  // 2. Session TTL — auto-expire if user went silent too long
  const lastInteraction = session.context_data.last_interaction;
  if (lastInteraction && Date.now() - lastInteraction > SESSION_TTL_MS) {
    return {
      action: 'expired',
      message: undefined, // pipeline handles fresh processing
    };
  }

  // 3. Stopword check (token-level: ALL tokens must be stopwords to reject)
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every(t => STOPWORDS.has(t))) {
    const msg = slotName === 'duration_days'
      ? 'Bạn muốn đi mấy ngày ạ? (Ví dụ: 3 ngày)'
      : 'Mình chưa hiểu địa điểm. Bạn có thể nhập rõ tên địa điểm không?';
    return { action: 'reject_stopword', message: msg };
  }

  // 4. For duration slot: any non-empty input is potentially valid (parseTour extracts number)
  if (slotName === 'duration_days') {
    if (trimmed.length > 0) return { action: 'proceed' };
  }

  // 5. Entity too short after normalization
  if (!entity || entity.length < 2) {
    return {
      action: 'reject_stopword',
      message: 'Mình chưa hiểu địa điểm. Bạn có thể nhập rõ tên địa điểm không?',
    };
  }

  return { action: 'proceed' };
}
