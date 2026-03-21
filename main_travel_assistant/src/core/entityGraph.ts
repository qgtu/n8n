/**
 * Entity Graph — In-memory entity index with hierarchy.
 *
 * Loaded once at startup from DB (attractions, tours, aliases, tickets, opening_hours, tour_stops).
 * Provides deterministic entity extraction (<1ms) replacing LLM entity extraction (~500ms).
 *
 * Data sources:
 *   1. attractions + location_aliases → place entities
 *   2. tours + tour_stops → tour entities (linked to attractions)
 *   3. tickets / opening_hours → meta flags (hasTicket, hasOpeningHours)
 *
 * Match strategy: longest-first N-gram token match against stripped-diacritics aliases.
 */

import { query } from '../config/db';
import { normalize } from '../utils/normalize';
import { logger } from '../utils/logger';

// ── Types ──

export type EntityType = 'place' | 'tour' | 'province';

export interface EntityNode {
  id: number;
  name: string;              // original Vietnamese name with diacritics
  slug: string;
  type: EntityType;
  parent?: string;           // parent province slug (e.g. "ninh-binh")
  aliases: string[];         // all stripped-diacritics forms for matching
  meta: {
    hasTicket: boolean;
    hasOpeningHours: boolean;
    hasTour: boolean;        // place appears in tour_stops
    tourIds: number[];       // linked tour IDs (for places)
    province?: string;       // raw province name
  };
}

export interface EntityMatch {
  node: EntityNode;
  matchedTokens: string[];   // the tokens that matched
  startIdx: number;          // start position in token array
  endIdx: number;            // end position (exclusive)
}

export interface EntityMatchResult {
  entities: EntityMatch[];
  consumedIndices: Set<number>;
}

// ── Module state ──

/** alias (stripped diacritics) → EntityNode */
const entityIndex = new Map<string, EntityNode>();

/** id → EntityNode (places only, for FK lookups) */
const placeById = new Map<number, EntityNode>();

/** province (stripped) → EntityNode[] */
const provinceIndex = new Map<string, EntityNode[]>();

/** tour id → EntityNode */
const tourById = new Map<number, EntityNode>();

/** Max alias token length (for N-gram window) */
let maxAliasTokens = 1;

// ── Startup loader ──

export async function loadEntityGraph(): Promise<void> {
  entityIndex.clear();
  placeById.clear();
  provinceIndex.clear();
  tourById.clear();
  maxAliasTokens = 1;

  // 1. Load attractions (was: places)
  const placesRes = await query(
    `SELECT id, name_vi, slug, province, place_type FROM attractions WHERE status = 'active'`,
  );

  for (const row of placesRes.rows) {
    const node: EntityNode = {
      id: row.id,
      name: row.name_vi,
      slug: row.slug,
      type: 'place',
      parent: row.province ? normalize(row.province) : undefined,
      aliases: [],
      meta: {
        hasTicket: false,
        hasOpeningHours: false,
        hasTour: false,
        tourIds: [],
        province: row.province || undefined,
      },
    };

    // Generate aliases: original name stripped, slug-form
    const nameStripped = normalize(row.name_vi);
    node.aliases.push(nameStripped);
    if (row.slug !== nameStripped) {
      // slug uses dashes: "den-thai-vi" → also add as alias with spaces: "den thai vi"
      const slugSpaced = row.slug.replace(/-/g, ' ');
      if (slugSpaced !== nameStripped) node.aliases.push(slugSpaced);
    }

    placeById.set(row.id, node);
    registerNode(node);

    // Province index
    if (row.province) {
      const provKey = normalize(row.province);
      if (!provinceIndex.has(provKey)) provinceIndex.set(provKey, []);
      provinceIndex.get(provKey)!.push(node);
    }
  }

  // 2. Load location_aliases → attach to existing place nodes
  const aliasRes = await query(
    `SELECT alias, attraction_id FROM location_aliases`,
  );

  for (const row of aliasRes.rows) {
    const node = placeById.get(row.attraction_id);
    if (!node) continue;
    const alias = row.alias.toLowerCase().trim();
    if (!node.aliases.includes(alias)) {
      node.aliases.push(alias);
    }
    // Register alias → node mapping
    if (!entityIndex.has(alias)) {
      entityIndex.set(alias, node);
      updateMaxTokens(alias);
    }
  }

  // 3. Mark meta flags: hasTicket
  const ticketRes = await query(
    `SELECT DISTINCT attraction_id FROM tickets`,
  );
  for (const row of ticketRes.rows) {
    const node = placeById.get(row.attraction_id);
    if (node) node.meta.hasTicket = true;
  }

  // 4. Mark meta flags: hasOpeningHours
  const hoursRes = await query(
    `SELECT DISTINCT attraction_id FROM opening_hours`,
  );
  for (const row of hoursRes.rows) {
    const node = placeById.get(row.attraction_id);
    if (node) node.meta.hasOpeningHours = true;
  }

  // 5. Load tours + tour_stops (was: tour_destinations)
  const tourRes = await query(
    `SELECT t.id, t.name_vi, t.duration_days, t.price,
            array_agg(ts.attraction_id ORDER BY ts.stop_order) AS attraction_ids
     FROM tours t
     LEFT JOIN tour_stops ts ON ts.tour_id = t.id
     WHERE t.is_active = true
     GROUP BY t.id`,
  );

  for (const row of tourRes.rows) {
    const attractionIds: number[] = (row.attraction_ids || []).filter((id: any) => id != null);

    const tourNode: EntityNode = {
      id: row.id,
      name: row.name_vi,
      slug: `tour-${row.id}`,
      type: 'tour',
      aliases: [],
      meta: {
        hasTicket: false,
        hasOpeningHours: false,
        hasTour: true,
        tourIds: [row.id],
        province: undefined,
      },
    };

    // Tour aliases: stripped name
    const tourNameStripped = normalize(row.name_vi);
    tourNode.aliases.push(tourNameStripped);

    tourById.set(row.id, tourNode);
    registerNode(tourNode);

    // Mark linked attractions as hasTour
    for (const aid of attractionIds) {
      const placeNode = placeById.get(aid);
      if (placeNode) {
        placeNode.meta.hasTour = true;
        if (!placeNode.meta.tourIds.includes(row.id)) {
          placeNode.meta.tourIds.push(row.id);
        }
      }
    }
  }

  // 6. Register province entries as entities
  for (const [provKey, places] of provinceIndex) {
    if (entityIndex.has(provKey)) continue; // already a place name
    const first = places[0];
    if (!first) continue;
    const provNode: EntityNode = {
      id: 0, // synthetic
      name: first.meta.province || provKey,
      slug: provKey.replace(/\s+/g, '-'),
      type: 'province',
      aliases: [provKey],
      meta: {
        hasTicket: false,
        hasOpeningHours: false,
        hasTour: places.some(p => p.meta.hasTour),
        tourIds: [],
        province: first.meta.province,
      },
    };
    registerNode(provNode);
  }

  logger.info(
    `[EntityGraph] Loaded ${placeById.size} attractions, ${tourById.size} tours, ` +
    `${provinceIndex.size} provinces, ${entityIndex.size} total index entries, ` +
    `maxAliasTokens=${maxAliasTokens}`,
  );
}

// ── Registration helpers ──

function registerNode(node: EntityNode): void {
  for (const alias of node.aliases) {
    const key = alias.toLowerCase().trim();
    if (!key) continue;
    // First registration wins (place > tour > province for same alias)
    if (!entityIndex.has(key)) {
      entityIndex.set(key, node);
    }
    updateMaxTokens(key);
  }
}

function updateMaxTokens(alias: string): void {
  const tokenCount = alias.split(/\s+/).length;
  if (tokenCount > maxAliasTokens) maxAliasTokens = tokenCount;
}

// ── Entity matching ──

/**
 * Match entities in tokenized text using longest-first N-gram search.
 *
 * Input tokens must be normalized (stripped diacritics, lowercased).
 * Returns all non-overlapping entity matches + consumed indices.
 *
 * Example:
 *   tokens = ["tour", "tam", "coc", "3", "ngay"]
 *   → entities: [{ node: TamCốcNode, matchedTokens: ["tam","coc"], startIdx:1, endIdx:3 }]
 *   → consumedIndices: {1, 2}
 */
export function matchEntities(tokens: string[]): EntityMatchResult {
  const matches: EntityMatch[] = [];
  const used = new Set<number>(); // token positions already matched

  // Try longest N-grams first, then shorter
  for (let n = Math.min(maxAliasTokens, tokens.length); n >= 1; n--) {
    for (let i = 0; i <= tokens.length - n; i++) {
      // Skip if any token in this window is already matched
      let overlap = false;
      for (let j = i; j < i + n; j++) {
        if (used.has(j)) { overlap = true; break; }
      }
      if (overlap) continue;

      const candidate = tokens.slice(i, i + n).join(' ');
      const node = entityIndex.get(candidate);
      if (node) {
        matches.push({
          node,
          matchedTokens: tokens.slice(i, i + n),
          startIdx: i,
          endIdx: i + n,
        });
        for (let j = i; j < i + n; j++) used.add(j);
      }
    }
  }

  return { entities: matches, consumedIndices: used };
}

/**
 * Get entity node by attraction ID (for FK lookups from tour_stops etc.)
 */
export function getPlaceById(id: number): EntityNode | undefined {
  return placeById.get(id);
}

/**
 * Get all places in a province.
 */
export function getPlacesByProvince(province: string): EntityNode[] {
  const key = normalize(province);
  return provinceIndex.get(key) || [];
}

/**
 * Lookup a single entity by alias string (exact match).
 */
export function lookupEntity(alias: string): EntityNode | undefined {
  return entityIndex.get(normalize(alias));
}

/**
 * Get entity graph stats (for logging/debugging).
 */
export function getGraphStats(): { places: number; tours: number; provinces: number; totalAliases: number } {
  return {
    places: placeById.size,
    tours: tourById.size,
    provinces: provinceIndex.size,
    totalAliases: entityIndex.size,
  };
}
