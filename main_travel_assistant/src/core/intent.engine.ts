/**
 * Intent Engine — Signal-Based keyword scoring from DB.
 *
 * Keywords loaded once at startup, cached in memory.
 * All keywords stored diacritics-stripped in DB → single token space.
 *
 * Key change from v1:
 *   - classifyIntent() replaced with scoreKeywordIntents()
 *   - Takes REMAINING tokens (after entity consumed) as input
 *   - Returns scored intent list, not a single ClassifyResult
 *   - tokensContain changed from subsequence to CONTIGUOUS match
 */

import { query } from '../config/db';
import { normalize } from '../utils/normalize';
import { parseDirections, parseTour } from '../utils/parser';
import { logger } from '../utils/logger';
import type { ClassifyResult, IntentName } from '../types';

// ── Module-level state (populated at startup) ──

interface KeywordEntry {
  tokens: string[];  // pre-tokenized keyword (diacritics-stripped)
  raw: string;       // original keyword string
  priority: number;  // priority from DB
}

/** Intent → keywords sorted longest-first within each intent */
let keywordMap = new Map<IntentName, KeywordEntry[]>();

/** Intents in evaluation order (highest max-priority first) */
let intentOrder: IntentName[] = [];

// ── Startup loader ──

/**
 * Load intent keywords from DB into memory.
 * Must be called once before the server starts accepting requests.
 * Keywords are stored diacritics-stripped in DB.
 */
export async function loadIntentKeywords(): Promise<void> {
  const result = await query(
    `SELECT intent_type, keyword, priority
     FROM intent_keywords
     WHERE active = true
     ORDER BY priority DESC, keyword`,
  );

  const grouped = new Map<IntentName, { keyword: string; priority: number }[]>();

  for (const row of result.rows) {
    const intent = row.intent_type as IntentName;
    if (!grouped.has(intent)) grouped.set(intent, []);
    grouped.get(intent)!.push({ keyword: row.keyword, priority: row.priority });
  }

  // Build keywordMap: intent → keyword entries sorted longest-first
  keywordMap = new Map();
  for (const [intent, entries] of grouped) {
    const sorted = entries
      .map(e => ({
        tokens: e.keyword.trim().toLowerCase().split(/\s+/),
        raw: e.keyword.trim().toLowerCase(),
        priority: e.priority,
      }))
      // Sort by token count descending (longest keyword first)
      .sort((a, b) => b.tokens.length - a.tokens.length);

    keywordMap.set(intent, sorted);
  }

  // Intent evaluation order: sort by max priority descending
  intentOrder = [...grouped.entries()]
    .sort((a, b) => (b[1][0]?.priority ?? 0) - (a[1][0]?.priority ?? 0))
    .map(([intent]) => intent);

  logger.info(
    `[IntentEngine] Loaded ${result.rows.length} keywords for ${intentOrder.length} intents`,
  );
}

// ── Keyword Scoring (new API) ──

export interface ScoredKeywordResult {
  intent: IntentName;
  score: number;        // sum of matched keyword priorities
  matchedKeywords: string[];
}

/**
 * Score remaining signal tokens against intent_keywords.
 * Tokens = normalized, post-entity-consumed, post-noise-filtered.
 * Returns all intents that scored > 0, sorted descending by score.
 *
 * Uses CONTIGUOUS token matching (primary) + bag-of-words (secondary, 0.5x).
 */
export function scoreKeywordIntents(tokens: string[]): ScoredKeywordResult[] {
  const scores = new Map<IntentName, { score: number; keywords: string[] }>();

  // Primary pass: contiguous match (full priority)
  for (const [intent, keywords] of keywordMap) {
    for (const kw of keywords) {
      if (tokensContainContiguous(tokens, kw.tokens)) {
        const entry = scores.get(intent) || { score: 0, keywords: [] };
        entry.score += kw.priority;
        entry.keywords.push(kw.raw);
        scores.set(intent, entry);
      }
    }
  }

  // Secondary pass: bag-of-words for multi-word keywords (0.5x priority)
  for (const [intent, keywords] of keywordMap) {
    for (const kw of keywords) {
      if (kw.tokens.length < 2) continue; // only multi-word
      const alreadyMatched = scores.get(intent)?.keywords.includes(kw.raw);
      if (alreadyMatched) continue;
      if (tokensContainBagOfWords(tokens, kw.tokens)) {
        const entry = scores.get(intent) || { score: 0, keywords: [] };
        entry.score += Math.floor(kw.priority * 0.5);
        entry.keywords.push(kw.raw + '~bag');
        scores.set(intent, entry);
      }
    }
  }

  return [...scores.entries()]
    .map(([intent, data]) => ({
      intent,
      score: data.score,
      matchedKeywords: data.keywords,
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Legacy classifyIntent (kept for multi-intent segment classification) ──

/**
 * Classify user text into an intent using token-level keyword matching.
 * Used by detectMultiIntent for per-segment classification.
 *
 * Priority:
 *   1. Structural pattern "tu X den Y" → GET_DIRECTIONS
 *   2. Token-level keyword loop (longest match within highest-priority intent)
 *   3. No match → UNKNOWN
 */
export function classifyIntent(text: string): ClassifyResult {
  const cleaned = normalize(text);
  const entity = normalize(text);
  const textTokens = cleaned.split(/\s+/);

  // 1. Structural pattern: "tu X den/toi Y" → DIRECTIONS
  if (/tu\s+.+\s+(?:den|toi)\s+/.test(cleaned)) {
    const parsed = parseDirections(text);
    if (parsed) {
      return {
        intent: 'GET_DIRECTIONS',
        entity: '',
        entity_origin: parsed.entity_origin,
        entity_destination: parsed.entity_destination,
        _routeMode: parsed._routeMode,
        confidence: 1,
        source: 'rule',
      };
    }
  }

  // 2. Token-level keyword matching (longest keyword first per intent)
  for (const intent of intentOrder) {
    const keywords = keywordMap.get(intent);
    if (!keywords) continue;

    for (const kw of keywords) {
      if (tokensContainContiguous(textTokens, kw.tokens)) {
        // Strip matched keyword from entity — avoids dirty entity
        const strippedEntity = stripKeywordFromEntity(entity, kw.raw);
        return handleMatch(intent, text, strippedEntity);
      }
    }
  }

  // 3. No match → UNKNOWN
  return { intent: 'UNKNOWN', entity, confidence: 0, source: 'rule' };
}

// ── Token matching (CONTIGUOUS) ──

/**
 * Check if kwTokens appear as a CONTIGUOUS subsequence in textTokens.
 * "gia ve" must match ["abc", "gia", "ve", "xyz"] at positions [1,2].
 * NOT match ["gia", "abc", "ve"] (non-contiguous).
 *
 * This fixes the old subsequence match which caused false positives.
 */
function tokensContainContiguous(textTokens: string[], kwTokens: string[]): boolean {
  if (kwTokens.length === 0) return false;
  if (kwTokens.length > textTokens.length) return false;

  for (let i = 0; i <= textTokens.length - kwTokens.length; i++) {
    let match = true;
    for (let j = 0; j < kwTokens.length; j++) {
      if (textTokens[i + j] !== kwTokens[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Check if ALL kwTokens appear somewhere in textTokens (any order).
 * Only used for multi-word keywords as a secondary matcher at reduced priority.
 */
function tokensContainBagOfWords(textTokens: string[], kwTokens: string[]): boolean {
  if (kwTokens.length === 0) return false;
  return kwTokens.every(kt => textTokens.includes(kt));
}

/**
 * Strip an intent keyword from the entity string (token-level).
 * Returns the remaining text as the clean entity.
 */
function stripKeywordFromEntity(entity: string, keyword: string): string {
  const entityTokens = entity.split(/\s+/);
  const kwTokens = keyword.split(/\s+/);

  for (let i = 0; i <= entityTokens.length - kwTokens.length; i++) {
    let match = true;
    for (let j = 0; j < kwTokens.length; j++) {
      if (entityTokens[i + j] !== kwTokens[j]) { match = false; break; }
    }
    if (match) {
      const remaining = [
        ...entityTokens.slice(0, i),
        ...entityTokens.slice(i + kwTokens.length),
      ].join(' ').trim();
      return remaining || entity;
    }
  }
  return entity;
}

// ── Per-intent post-match logic ──

function handleMatch(
  intent: IntentName,
  rawText: string,
  entity: string,
): ClassifyResult {
  switch (intent) {
    case 'GET_DIRECTIONS': {
      const parsed = parseDirections(rawText);
      if (parsed) {
        return {
          intent: 'GET_DIRECTIONS',
          entity: '',
          entity_origin: parsed.entity_origin,
          entity_destination: parsed.entity_destination,
          _routeMode: parsed._routeMode,
          confidence: 1,
          source: 'rule',
        };
      }
      return { intent: 'GET_DIRECTIONS', entity, confidence: 0.7, source: 'rule' };
    }

    case 'SEARCH_TOUR': {
      const parsed = parseTour(rawText);
      return {
        intent: 'SEARCH_TOUR',
        entity: parsed.entity || entity,
        duration_days: parsed.duration_days,
        confidence: 1,
        source: 'rule',
      };
    }

    case 'SEARCH_NEARBY': {
      const nearbyCategory = detectNearbyCategory(rawText);
      return {
        intent: 'SEARCH_NEARBY',
        entity,
        _nearbyCategory: nearbyCategory,
        confidence: 1,
        source: 'rule',
      };
    }

    default:
      return { intent, entity, confidence: 1, source: 'rule' };
  }
}

/** Vietnamese keyword → HERE search category mapping */
const NEARBY_CATEGORY_PATTERNS: [RegExp, string][] = [
  [/nha hang|quan an|an uong/i, 'restaurant'],
  [/ca phe|cafe|coffee/i, 'cafe'],
  [/khach san|nha nghi|hotel|homestay/i, 'hotel'],
  [/atm/i, 'ATM'],
  [/ngan hang|bank/i, 'bank'],
  [/benh vien|hospital/i, 'hospital'],
  [/tram xang/i, 'gas station'],
  [/sieu thi|supermarket/i, 'supermarket'],
  [/cho|market/i, 'market'],
  [/dia diem du lich|diem du lich|diem tham quan|du lich/i, 'tourist attraction'],
];

function detectNearbyCategory(text: string): string | undefined {
  const cleaned = normalize(text);
  for (const [pattern, category] of NEARBY_CATEGORY_PATTERNS) {
    if (pattern.test(cleaned)) return category;
  }
  return undefined;
}
