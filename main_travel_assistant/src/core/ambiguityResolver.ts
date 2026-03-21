/**
 * Ambiguity Resolver — Detects when intent is ambiguous and builds clarification questions.
 *
 * Cases:
 *   1. Single clear winner (score gap > threshold) → proceed
 *   2. Two close scores → ask clarification question
 *   3. No candidates → UNKNOWN (LLM fallback)
 *   4. Context tie-break → session.last_intent resolves
 *
 * Design: never guesses. If unsure → ask user. Accuracy > intelligence.
 */

import type { BotSession, IntentName } from '../types';
import type { ScoredIntent } from './intentGraph';
import type { EntityMatch } from './entityGraph';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';

// ── Types ──

export interface ResolveResult {
  action: 'proceed' | 'clarify' | 'unknown';
  primary: ScoredIntent | null;
  secondary?: ScoredIntent;       // for multi-intent merge
  clarifyMessage?: string;
}

// ── Constants ──

/** If top-2 score delta is below this → ambiguous → clarify */
const AMBIGUITY_THRESHOLD = 0.15;

/** Human-readable intent labels for clarification questions */
const INTENT_LABELS: Partial<Record<IntentName, (entity: string) => string>> = {
  GET_TICKET_PRICE: (e) => `Giá vé vào ${e}`,
  GET_OPENING_HOURS: (e) => `Giờ mở cửa ${e}`,
  GET_PLACE_INFO: (e) => `Thông tin về ${e}`,
  GET_WEATHER: (e) => `Thời tiết ${e}`,
  SEARCH_TOUR: (e) => `Tour du lịch ${e}`,
  SEARCH_NEARBY: (e) => `Địa điểm gần ${e}`,
  GET_DIRECTIONS: (e) => `Chỉ đường đến ${e}`,
  DISCOVER_LOCATION: (e) => `Khám phá ${e}`,
};

// ── Public API ──

/**
 * Resolve ambiguity from scored intent candidates.
 *
 * @param candidates - Sorted by score descending (from intentGraph.scoreIntents)
 * @param entities - Matched entities from entityGraph
 * @param session - Current session for context tie-breaking
 */
export function resolveAmbiguity(
  candidates: ScoredIntent[],
  entities: EntityMatch[],
  session: BotSession,
): ResolveResult {
  // Case 3: No candidates at all
  if (candidates.length === 0) {
    logger.debug('[AmbiguityResolver] No candidates → UNKNOWN');
    return { action: 'unknown', primary: null };
  }

  // Case 1: Single candidate → proceed
  if (candidates.length === 1) {
    logger.debug(`[AmbiguityResolver] Single candidate: ${candidates[0].intent} → proceed`);
    return { action: 'proceed', primary: candidates[0] };
  }

  const top = candidates[0];
  const second = candidates[1];
  const delta = top.score - second.score;

  // Case 1: Clear winner (score gap > threshold)
  if (delta > AMBIGUITY_THRESHOLD) {
    logger.debug(
      `[AmbiguityResolver] Clear winner: ${top.intent}=${top.score.toFixed(2)} ` +
      `vs ${second.intent}=${second.score.toFixed(2)} (delta=${delta.toFixed(2)}) → proceed`,
    );
    return { action: 'proceed', primary: top };
  }

  // Case 4: Context tie-break — if session.last_intent matches one of the top-2
  const lastIntent = session.context_data.last_intent;
  if (lastIntent) {
    if (top.intent === lastIntent) {
      logger.debug(`[AmbiguityResolver] Context tie-break → ${top.intent} (matches last_intent)`);
      return { action: 'proceed', primary: top };
    }
    if (second.intent === lastIntent) {
      logger.debug(`[AmbiguityResolver] Context tie-break → ${second.intent} (matches last_intent)`);
      return { action: 'proceed', primary: second };
    }
  }

  // Case 2: Ambiguous — build clarification question
  const entityName = top.entityName || second.entityName || 'địa điểm này';
  const safeEntity = escapeHtml(entityName);

  const options = [top, second]
    .map((c, i) => {
      const labelFn = INTENT_LABELS[c.intent];
      const label = labelFn ? labelFn(safeEntity) : c.intent;
      return `${i + 1}️⃣ ${label}`;
    })
    .join('\n');

  const clarifyMessage = `Bạn muốn hỏi:\n${options}\n\nBạn chọn 1 hoặc 2 nhé.`;

  logger.info(
    `[AmbiguityResolver] Ambiguous: ${top.intent}=${top.score.toFixed(2)} ` +
    `vs ${second.intent}=${second.score.toFixed(2)} (delta=${delta.toFixed(2)}) → clarify`,
  );

  return {
    action: 'clarify',
    primary: top,
    secondary: second,
    clarifyMessage,
  };
}
