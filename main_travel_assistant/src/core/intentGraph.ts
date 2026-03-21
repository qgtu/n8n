/**
 * Intent Graph — Entity-aware intent scoring + multi-intent detection.
 *
 * Core components:
 *   1. INTENT_ENTITY_MATRIX: which entity types are valid for which intents
 *   2. scoreIntents(): score intent candidates using keyword scores + entity meta + context
 *   3. detectMultiIntent(): split "giá vé và giờ mở cửa tam cốc" into 2 intents
 *
 * Design: deterministic scoring (no ML), runs after intent.engine keyword scoring + entityGraph match.
 */

import type { IntentName, BotSession } from '../types';
import type { EntityMatch, EntityType } from './entityGraph';
import type { ScoredKeywordResult } from './intent.engine';
import type { ExtractedSignals } from './signalExtractor';
import { scoreKeywordIntents } from './intent.engine';
import { extractSignals } from './signalExtractor';
import { matchEntities } from './entityGraph';
import { normalize, tokenize, stripNoiseTokens } from '../utils/normalize';
import { logger } from '../utils/logger';

// ── Types ──

export interface ScoredIntent {
  intent: IntentName;
  score: number;
  entity: EntityMatch | null;
  entityName: string;         // clean entity name for handler
  slug?: string;              // resolved slug if available
  source: 'rule' | 'graph' | 'context';
  // Carry-over fields
  duration_days?: number;
  entity_origin?: string;
  entity_destination?: string;
  _routeMode?: string;
  _nearbyCategory?: string;
  _weatherMode?: 'current' | 'forecast';
  _forecastDays?: number;
  _forecastOffset?: number;
}

export interface MultiIntentResult {
  isMulti: boolean;
  intents: ScoredIntent[];
}

// ── Intent-Entity compatibility matrix ──

const INTENT_ENTITY_MATRIX: Record<string, Set<EntityType>> = {
  GET_TICKET_PRICE: new Set(['place']),
  GET_OPENING_HOURS: new Set(['place']),
  GET_PLACE_INFO: new Set(['place', 'province']),
  GET_WEATHER: new Set(['place', 'province']),
  SEARCH_NEARBY: new Set(['place', 'province']),
  GET_DIRECTIONS: new Set(['place']),
  SEARCH_TOUR: new Set(['place', 'tour', 'province']),
  DISCOVER_LOCATION: new Set(['place', 'province']),
};

// ── Scoring constants ──

const ENTITY_MATCH_BONUS = 0.3;   // entity found in graph
const META_MATCH_BONUS = 0.2;     // entity.meta confirms intent (e.g. hasTicket for TICKET_PRICE)
const META_MISS_PENALTY = -0.1;   // entity.meta contradicts (e.g. no ticket data)
const CONTEXT_BONUS = 0.15;       // session.last_intent matches
const ENTITY_COMPAT_BONUS = 0.1;  // entity type in INTENT_ENTITY_MATRIX

// ── Multi-intent connector patterns ──

const CONNECTOR_PATTERN = /\s+(?:va|and|with|,)\s+/i;

// ── Public API ──

/**
 * Score intent candidates using keyword scores + entity graph + session context + signals.
 *
 * Input: ScoredKeywordResult[] from scoreKeywordIntents() + EntityMatch[] from matchEntities().
 * Optional: ExtractedSignals from signalExtractor (provides intent boosts + slots).
 * Returns sorted list of scored intents (highest first).
 */
export function scoreIntents(
  keywordScores: ScoredKeywordResult[],
  entities: EntityMatch[],
  session: BotSession,
  signals?: ExtractedSignals,
): ScoredIntent[] {
  const candidates: ScoredIntent[] = [];
  const primaryEntity = entities.length > 0 ? entities[0] : null;
  const entityName = primaryEntity?.node.name || '';

  // 1. Score each keyword-matched intent
  for (const kwResult of keywordScores) {
    let score = kwResult.score; // use raw keyword priority sum as base

    // Entity match bonus
    if (primaryEntity) {
      score += ENTITY_MATCH_BONUS;

      // Entity type compatibility
      const allowed = INTENT_ENTITY_MATRIX[kwResult.intent];
      if (allowed && allowed.has(primaryEntity.node.type)) {
        score += ENTITY_COMPAT_BONUS;
      }

      // Meta match: does entity data support this intent?
      score += getMetaScore(kwResult.intent, primaryEntity);
    }

    // Context bonus
    if (session.context_data.last_intent === kwResult.intent) {
      score += CONTEXT_BONUS;
    }

    // Signal boosts (additive)
    if (signals) {
      const boost = signals.intentBoosts.get(kwResult.intent) || 0;
      if (boost > 0) score += boost;
    }

    candidates.push({
      intent: kwResult.intent,
      score,
      entity: primaryEntity,
      entityName,
      slug: primaryEntity?.node.slug,
      source: 'rule',
      duration_days: signals?.slots.duration_days,
    });
  }

  // 2. Generate candidates from signal boosts that have no keyword match
  if (signals) {
    for (const [intent, boost] of signals.intentBoosts) {
      if (candidates.some(c => c.intent === intent)) continue;
      if (boost <= 0) continue;

      let score = boost;
      if (primaryEntity) {
        score += ENTITY_MATCH_BONUS;
        const allowed = INTENT_ENTITY_MATRIX[intent];
        if (allowed && allowed.has(primaryEntity.node.type)) {
          score += ENTITY_COMPAT_BONUS;
        }
        score += getMetaScore(intent, primaryEntity);
      }
      if (session.context_data.last_intent === intent) {
        score += CONTEXT_BONUS;
      }

      candidates.push({
        intent: intent as IntentName,
        score,
        entity: primaryEntity,
        entityName,
        slug: primaryEntity?.node.slug,
        source: 'rule',
        duration_days: signals.slots.duration_days,
      });
    }
  }

  // 3. Generate alternative intents from entity meta (graph-based)
  if (primaryEntity) {
    const topIntent = candidates.length > 0 ? candidates[0].intent : 'UNKNOWN';
    const alternates = getEntityDrivenIntents(primaryEntity, topIntent);
    for (const alt of alternates) {
      // Don't duplicate
      if (candidates.some(c => c.intent === alt)) continue;

      let score = 0.5; // lower base for graph-inferred
      score += ENTITY_MATCH_BONUS;
      score += getMetaScore(alt, primaryEntity);

      if (session.context_data.last_intent === alt) {
        score += CONTEXT_BONUS;
      }

      candidates.push({
        intent: alt,
        score,
        entity: primaryEntity,
        entityName,
        slug: primaryEntity.node.slug,
        source: 'graph',
      });
    }
  }

  // 4. If no keywords matched and no signal boosts but entity found → promote GET_PLACE_INFO
  if (keywordScores.length === 0 && (!signals || signals.intentBoosts.size === 0) && primaryEntity && primaryEntity.node.type === 'place') {
    if (!candidates.some(c => c.intent === 'GET_PLACE_INFO')) {
      candidates.push({
        intent: 'GET_PLACE_INFO',
        score: 0.6,
        entity: primaryEntity,
        entityName,
        slug: primaryEntity.node.slug,
        source: 'graph',
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.debug(
    `[IntentGraph] Scored ${candidates.length} candidates: ` +
    candidates.map(c => `${c.intent}=${c.score.toFixed(2)}`).join(', '),
  );

  return candidates;
}

/**
 * Detect multi-intent queries (e.g. "gia ve va gio mo cua tam coc").
 *
 * Strategy:
 *   1. Check for connector words ("va", ",")
 *   2. Split at connectors
 *   3. Run mini signal-fusion pipeline per segment
 *      (normalize → tokenize → entity → signals → noise → keyword score)
 *   4. Return multiple intents if different intents detected
 *
 * Returns { isMulti: false, intents: [] } for normal queries.
 */
export function detectMultiIntent(
  rawText: string,
  sharedEntities: EntityMatch[],
  session: BotSession,
): MultiIntentResult {
  const cleaned = normalize(rawText);

  // Quick check: does text contain a connector?
  if (!CONNECTOR_PATTERN.test(cleaned)) {
    return { isMulti: false, intents: [] };
  }

  const segments = cleaned.split(CONNECTOR_PATTERN).filter(s => s.trim().length > 0);

  if (segments.length < 2) {
    return { isMulti: false, intents: [] };
  }

  logger.debug(`[IntentGraph] Multi-intent segments: ${JSON.stringify(segments)}`);

  // Run mini signal-fusion pipeline per segment
  const segmentIntents: ScoredIntent[] = [];
  const seenIntents = new Set<string>();

  for (const segment of segments) {
    const segTokens = tokenize(segment);

    // Entity extraction on segment
    const segEntityResult = matchEntities(segTokens);
    const segEntities = segEntityResult.entities;

    // Signal extraction on remaining tokens
    const segSignals = extractSignals(segTokens, segEntityResult.consumedIndices);

    // Noise filter — exclude entity + signal consumed
    const allConsumed = new Set([...segEntityResult.consumedIndices, ...segSignals.consumedIndices]);
    const remaining = segTokens.filter((_, idx) => !allConsumed.has(idx));
    const signalTokens = stripNoiseTokens(remaining);

    // Keyword scoring on remaining signal tokens
    const kwScores = scoreKeywordIntents(signalTokens);

    // Determine top intent: keyword winner, or signal-only winner
    let topIntent: IntentName | undefined;
    let topScore = 0;

    if (kwScores.length > 0) {
      topIntent = kwScores[0].intent;
      topScore = kwScores[0].score;
      // Apply signal boosts
      const boost = segSignals.intentBoosts.get(topIntent) || 0;
      topScore += boost;
    }

    // Check for signal-only intents (no keyword match but signal boosts)
    for (const [intent, boost] of segSignals.intentBoosts) {
      if (boost > topScore) {
        topIntent = intent as IntentName;
        topScore = boost;
      }
    }

    if (!topIntent) continue;
    if (seenIntents.has(topIntent)) continue;
    seenIntents.add(topIntent);

    // Use segment entity if found, otherwise fall back to shared entities
    const entity = segEntities.length > 0 ? segEntities[0] : (sharedEntities.length > 0 ? sharedEntities[0] : null);

    segmentIntents.push({
      intent: topIntent,
      score: topScore,
      entity,
      entityName: entity?.node.name || '',
      slug: entity?.node.slug,
      source: 'rule',
      duration_days: segSignals.slots.duration_days,
    });
  }

  // If we found 2+ distinct intents → multi-intent
  if (segmentIntents.length >= 2) {
    // Shared entity: if segments don't have their own entity, use the global one
    const globalEntity = sharedEntities.length > 0 ? sharedEntities[0] : null;
    for (const si of segmentIntents) {
      if (!si.entity && globalEntity) {
        si.entity = globalEntity;
        si.entityName = globalEntity.node.name;
        si.slug = globalEntity.node.slug;
      }
    }

    logger.info(
      `[IntentGraph] Multi-intent detected: ${segmentIntents.map(s => s.intent).join(' + ')}`,
    );
    return { isMulti: true, intents: segmentIntents.slice(0, 2) }; // max 2
  }

  return { isMulti: false, intents: [] };
}

// ── Internal helpers ──

/**
 * Get meta-based score adjustment for an intent given an entity match.
 */
function getMetaScore(intent: IntentName | string, entity: EntityMatch): number {
  const meta = entity.node.meta;

  switch (intent) {
    case 'GET_TICKET_PRICE':
      return meta.hasTicket ? META_MATCH_BONUS : META_MISS_PENALTY;
    case 'GET_OPENING_HOURS':
      return meta.hasOpeningHours ? META_MATCH_BONUS : META_MISS_PENALTY;
    case 'SEARCH_TOUR':
      return meta.hasTour ? META_MATCH_BONUS : META_MISS_PENALTY;
    default:
      return 0;
  }
}

/**
 * Get alternative intents that this entity could serve (based on entity meta).
 */
function getEntityDrivenIntents(entity: EntityMatch, excludeIntent: IntentName): IntentName[] {
  const alts: IntentName[] = [];
  const meta = entity.node.meta;

  if (meta.hasTicket && excludeIntent !== 'GET_TICKET_PRICE') {
    alts.push('GET_TICKET_PRICE');
  }
  if (meta.hasTour && excludeIntent !== 'SEARCH_TOUR') {
    alts.push('SEARCH_TOUR');
  }
  if (meta.hasOpeningHours && excludeIntent !== 'GET_OPENING_HOURS') {
    alts.push('GET_OPENING_HOURS');
  }

  return alts;
}
