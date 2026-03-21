/**
 * Signal Extractor — Structural pattern + question frame detection.
 *
 * Runs AFTER entity extraction, BEFORE noise filter.
 * Extracts:
 *   1. Structural patterns (duration, price, time, weather, travel topics)
 *   2. Question frames ("co...nao...khong", "the nao", "o dau")
 *   3. Sentence particles (khong, nao, chua at boundaries)
 *
 * Returns intent boosts + slots + consumed token indices.
 */

import { logger } from '../utils/logger';

// ── Types ──

export interface ExtractedSignals {
  /** Extracted slot values, e.g. { duration_days: 3 } */
  slots: Record<string, any>;
  /** Intent → boost score (additive on top of keyword scores) */
  intentBoosts: Map<string, number>;
  /** Detected question frame, e.g. 'SEARCH_EXIST', 'PRICE_QUESTION' */
  questionFrame: string | null;
  /** Token indices consumed by signal patterns (excluded from keyword matching) */
  consumedIndices: Set<number>;
  /** Logging labels for matched patterns */
  matchedPatterns: string[];
}

// ── Helpers ──

function addBoost(boosts: Map<string, number>, intent: string, value: number): void {
  boosts.set(intent, (boosts.get(intent) || 0) + value);
}

/**
 * Find token indices that form a contiguous match for a regex on the joined remaining string.
 * Returns the indices in the ORIGINAL token array, or empty array if no match.
 */
function findMatchIndices(
  tokens: string[],
  remaining: number[],
  regex: RegExp,
): number[] {
  // Build a string from remaining tokens with position tracking
  const parts: { idx: number; start: number; end: number }[] = [];
  let pos = 0;
  for (const idx of remaining) {
    const token = tokens[idx];
    parts.push({ idx, start: pos, end: pos + token.length });
    pos += token.length + 1; // +1 for space
  }
  const joined = remaining.map(i => tokens[i]).join(' ');

  const match = regex.exec(joined);
  if (!match) return [];

  const matchStart = match.index;
  const matchEnd = match.index + match[0].length;

  // Find which tokens are covered by this match
  const indices: number[] = [];
  for (const part of parts) {
    if (part.start >= matchEnd) break;
    if (part.end <= matchStart) continue;
    indices.push(part.idx);
  }
  return indices;
}

// ── Main export ──

/**
 * Extract structural signals from tokens.
 *
 * @param tokens - Full normalized token array
 * @param entityConsumed - Indices already consumed by entity extraction
 */
export function extractSignals(
  tokens: string[],
  entityConsumed: Set<number>,
): ExtractedSignals {
  const slots: Record<string, any> = {};
  const intentBoosts = new Map<string, number>();
  let questionFrame: string | null = null;
  const consumedIndices = new Set<number>();
  const matchedPatterns: string[] = [];

  // Remaining token indices (not consumed by entity)
  const remaining = tokens
    .map((_, i) => i)
    .filter(i => !entityConsumed.has(i));

  const remainingStr = remaining.map(i => tokens[i]).join(' ');

  // ── Phase 1: Structural patterns ──

  // DURATION: "3 ngay 2 dem" or "3 ngay"
  const durationMatch = remainingStr.match(/(\d+)\s*ngay(?:\s*(\d+)\s*dem)?/);
  if (durationMatch && durationMatch[1]) {
    const days = parseInt(durationMatch[1], 10);
    if (days > 0 && days <= 30) {
      slots.duration_days = days;
      addBoost(intentBoosts, 'SEARCH_TOUR', 500);
      matchedPatterns.push(`DURATION:${days}d`);
      // Consume matched tokens
      const indices = findMatchIndices(tokens, remaining, /(\d+)\s*ngay(?:\s*(\d+)\s*dem)?/);
      for (const idx of indices) consumedIndices.add(idx);
    }
  }

  // DURATION_SHORT: "3n2d" or "3n2đ"
  if (!slots.duration_days) {
    const shortMatch = remainingStr.match(/(\d+)\s*n\s*\d*\s*d/);
    if (shortMatch && shortMatch[1]) {
      const days = parseInt(shortMatch[1], 10);
      if (days > 0 && days <= 30) {
        slots.duration_days = days;
        addBoost(intentBoosts, 'SEARCH_TOUR', 500);
        matchedPatterns.push(`DURATION_SHORT:${days}d`);
        const indices = findMatchIndices(tokens, remaining, /(\d+)\s*n\s*\d*\s*d/);
        for (const idx of indices) consumedIndices.add(idx);
      }
    }
  }

  // PRICE_QUESTION: "bao nhieu", "mat bao nhieu", "gia", "phi"
  if (/(?:bao nhieu|mat bao nhieu)/.test(remainingStr)) {
    addBoost(intentBoosts, 'GET_TICKET_PRICE', 300);
    matchedPatterns.push('PRICE_QUESTION');
    const indices = findMatchIndices(tokens, remaining, /mat\s*bao\s*nhieu|bao\s*nhieu/);
    for (const idx of indices) consumedIndices.add(idx);
  }

  // TIME_QUESTION: "may gio", "luc nao", "khi nao", "thoi gian"
  if (/(?:may gio|luc nao|khi nao|thoi gian)/.test(remainingStr)) {
    addBoost(intentBoosts, 'GET_OPENING_HOURS', 300);
    matchedPatterns.push('TIME_QUESTION');
    const indices = findMatchIndices(tokens, remaining, /may\s*gio|luc\s*nao|khi\s*nao|thoi\s*gian/);
    for (const idx of indices) consumedIndices.add(idx);
  }

  // WEATHER_TOPIC: "troi", "mua", "nang", "nhiet do", "nong", "lanh", "am"
  if (/\b(?:troi|nhiet do|nong|lanh)\b/.test(remainingStr)) {
    addBoost(intentBoosts, 'GET_WEATHER', 300);
    matchedPatterns.push('WEATHER_TOPIC');
    // Don't consume — these also serve as keywords
  }

  // TRAVEL_TOPIC: "du lich", "tham quan", "kham pha", "di choi"
  if (/(?:du lich|tham quan|kham pha|di choi)/.test(remainingStr)) {
    addBoost(intentBoosts, 'SEARCH_TOUR', 200);
    addBoost(intentBoosts, 'DISCOVER_LOCATION', 100);
    matchedPatterns.push('TRAVEL_TOPIC');
    // Don't consume — let keyword matching also pick these up
  }

  // DIRECTION_PATTERN: "tu X den/toi Y" → strong directional/routing signal
  // Detects "từ...đến" and "từ...tới" patterns, the core Vietnamese direction frame.
  // Note: after diacritics stripping, "đến" (to) and "đền" (temple) both → "den",
  // but entity extraction already consumed entity "den" tokens, so remaining "den"
  // is always the directional preposition "đến".
  if (/\btu\b.*\b(?:den|toi)\b/.test(remainingStr)) {
    addBoost(intentBoosts, 'GET_DIRECTIONS', 500);
    matchedPatterns.push('DIRECTION_PATTERN');
    // Consume directional prepositions so they don't pollute keyword matching
    for (const idx of remaining) {
      if (tokens[idx] === 'tu') {
        consumedIndices.add(idx);
      }
    }
    // Consume "den" or "toi" that's NOT part of an entity (already filtered in remaining)
    for (const idx of remaining) {
      if (tokens[idx] === 'den' || tokens[idx] === 'toi') {
        consumedIndices.add(idx);
      }
    }
  }

  // DISTANCE_QUESTION: "khoang cach", "bao xa", "cach bao xa", "bao nhieu km", "may km"
  if (/(?:khoang cach|cach bao xa|bao xa|bao nhieu km|may km)/.test(remainingStr)) {
    addBoost(intentBoosts, 'GET_DIRECTIONS', 300);
    matchedPatterns.push('DISTANCE_QUESTION');
    // Don't consume — these also serve as keywords for GET_DIRECTIONS
  }

  // ── Phase 2: Question frames ──

  // SEARCH_EXIST: "co ... nao ... khong" / "co ... khong" / "co ... chua"
  if (/\bco\b.*\b(?:nao|khong|chua)\b/.test(remainingStr)) {
    questionFrame = 'SEARCH_EXIST';
    addBoost(intentBoosts, 'SEARCH_TOUR', 200);
    addBoost(intentBoosts, 'DISCOVER_LOCATION', 200);
    matchedPatterns.push('FRAME:SEARCH_EXIST');
  }

  // QUALITY_STATE: "the nao", "nhu the nao", "ra sao"
  if (/(?:the nao|nhu the nao|ra sao)\b/.test(remainingStr)) {
    if (!questionFrame) questionFrame = 'QUALITY_STATE';
    addBoost(intentBoosts, 'GET_PLACE_INFO', 150);
    addBoost(intentBoosts, 'GET_WEATHER', 150);
    matchedPatterns.push('FRAME:QUALITY_STATE');
    const indices = findMatchIndices(tokens, remaining, /nhu\s*the\s*nao|the\s*nao|ra\s*sao/);
    for (const idx of indices) consumedIndices.add(idx);
  }

  // LOCATION_QUERY: "o dau", "cho nao", "noi nao"
  if (/(?:o dau|cho nao|noi nao)\b/.test(remainingStr)) {
    if (!questionFrame) questionFrame = 'LOCATION_QUERY';
    addBoost(intentBoosts, 'SEARCH_NEARBY', 200);
    addBoost(intentBoosts, 'DISCOVER_LOCATION', 200);
    matchedPatterns.push('FRAME:LOCATION_QUERY');
    const indices = findMatchIndices(tokens, remaining, /o\s*dau|cho\s*nao|noi\s*nao/);
    for (const idx of indices) consumedIndices.add(idx);
  }

  // RECOMMENDATION: "nen", "goi y", "de xuat"
  if (/\b(?:nen|goi y|de xuat)\b/.test(remainingStr)) {
    if (!questionFrame) questionFrame = 'RECOMMENDATION';
    addBoost(intentBoosts, 'DISCOVER_LOCATION', 200);
    addBoost(intentBoosts, 'SEARCH_TOUR', 100);
    matchedPatterns.push('FRAME:RECOMMENDATION');
  }

  // ── Phase 3: Sentence particles ──
  // Consume question markers at sentence boundaries to prevent keyword pollution

  const lastRemainingIdx = remaining.length > 0 ? remaining[remaining.length - 1] : -1;
  const firstRemainingIdx = remaining.length > 0 ? remaining[0] : -1;

  // Trailing particles: "khong", "nao", "chua", "nhi", "ha", "vay"
  const TRAILING_PARTICLES = new Set(['khong', 'nao', 'chua', 'nhi', 'ha', 'vay']);
  if (lastRemainingIdx >= 0 && TRAILING_PARTICLES.has(tokens[lastRemainingIdx])) {
    consumedIndices.add(lastRemainingIdx);
  }

  // Leading "co" when part of question frame (already detected above)
  if (questionFrame === 'SEARCH_EXIST' && firstRemainingIdx >= 0 && tokens[firstRemainingIdx] === 'co') {
    consumedIndices.add(firstRemainingIdx);
  }

  // Preposition "o" (at) immediately before entity → consume
  for (const idx of remaining) {
    if (tokens[idx] === 'o' && entityConsumed.has(idx + 1)) {
      consumedIndices.add(idx);
    }
  }

  if (matchedPatterns.length > 0) {
    logger.debug(
      `[SignalExtractor] Patterns: ${matchedPatterns.join(', ')} | ` +
      `Boosts: ${[...intentBoosts.entries()].map(([k, v]) => `${k}=${v}`).join(', ')} | ` +
      `Slots: ${JSON.stringify(slots)} | Consumed: ${consumedIndices.size} tokens`,
    );
  }

  return { slots, intentBoosts, questionFrame, consumedIndices, matchedPatterns };
}
