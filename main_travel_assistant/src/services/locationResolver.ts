import { resolveCoords } from '../utils/slugResolver';
import { geocodeGlobal, discover, isDiscoverMatch } from './here';
import { cacheGet, cacheSet, TTL, makeCacheKey } from './cache';
import { normalize } from '../utils/normalize';
import { query } from '../config/db';
import { logger } from '../utils/logger';

export interface ResolvedLocation {
  name: string;
  slug?: string;
  lat: number;
  lng: number;
  source: 'db' | 'discover' | 'geocode';
  confidence: number;  // 0–1 (DB exact match = 1.0, discover/geocode uses scoring)
  ambiguous: boolean;  // true = multiple high-score candidates (ask disambiguation)
  isCountry: boolean;  // true = matched a country, not a city/POI (ask for specific city)
}

// Handlers should reject locations below this confidence
export const MIN_LOCATION_CONFIDENCE = 0.45;

/**
 * Unified location resolver.
 *
 * Pipeline (ordered by cost and precision):
 *   1. DB: resolveCoords(entityName)          → confidence=1.0 (exact alias/slug/fuzzy/name)
 *   2. HERE Discover: POI/landmark search     → confidence=0.85 (name-matched Discover hit)
 *   3. HERE Geocode: admin/city search        → confidence from HERE scoring
 *   4. null                                   → ENTITY_NOT_FOUND
 *
 * Why Discover before Geocode:
 *   - Geocode is designed for admin areas (city, street, address)
 *   - Discover is designed for POIs/landmarks (hồ gươm, chùa một cột, bệnh viện, cầu rồng)
 *   - Most travel bot queries are POI queries, not address lookups
 *   - Running Discover first catches POIs that geocode would misroute
 *     (e.g. "hồ gươm" → geocode returns "Đường Lò Gốm" street, but Discover returns "Hồ Hoàn Kiếm")
 *
 * Results are cached for 1 hour.
 */
export async function resolveLocation(entityName: string): Promise<ResolvedLocation | null> {
  if (!entityName || entityName.length < 2) return null;

  const cacheKey = makeCacheKey('resolved_loc', normalize(entityName));
  const cached = cacheGet<ResolvedLocation>(cacheKey);
  if (cached) {
    logger.debug(
      `[LocationResolver] cache HIT: "${entityName}" → source=${cached.source} ` +
      `confidence=${cached.confidence.toFixed(2)} ambiguous=${cached.ambiguous}`,
    );
    return cached;
  }

  // ── Step 1: DB coords (free, fast, exact match) ──
  const dbResult = await resolveCoords(entityName);
  if (dbResult) {
    logger.debug(
      `[LocationResolver] DB hit: "${entityName}" → lat=${dbResult.lat} lng=${dbResult.lng}`,
    );
    const resolved: ResolvedLocation = {
      name: dbResult.label,
      lat: dbResult.lat,
      lng: dbResult.lng,
      source: 'db',
      confidence: 1.0,
      ambiguous: false,
      isCountry: false,
    };
    cacheSet(cacheKey, resolved, TTL.GEOCODE);
    return resolved;
  }

  // ── Step 2: HERE Discover — POI/landmark search ──
  // Catches "hồ gươm", "chùa một cột", "cầu rồng", etc. that geocode misroutes
  const discoverResult = await tryDiscoverPoi(entityName);
  if (discoverResult) {
    logger.debug(
      `[LocationResolver] Discover hit: "${entityName}" → "${discoverResult.name}" ` +
      `lat=${discoverResult.lat} lng=${discoverResult.lng}`,
    );
    cacheSet(cacheKey, discoverResult, TTL.GEOCODE);
    return discoverResult;
  }

  // ── Step 3: HERE global geocode — admin/city search ──
  const geoResult = await geocodeGlobal(entityName);
  if (!geoResult) {
    logger.warn(`[LocationResolver] MISS: "${entityName}" — DB, Discover, and Geocode all returned null`);
    logAliasMiss(entityName, 'all_miss');
    return null;
  }

  const confidence = geoResult.confidence ?? 1.0;
  if (confidence < MIN_LOCATION_CONFIDENCE) {
    logger.warn(
      `[LocationResolver] MISS: geocode too low confidence (${confidence.toFixed(2)}) for "${entityName}"`,
    );
    logAliasMiss(entityName, 'low_confidence');
    return null;
  }

  logger.debug(
    `[LocationResolver] geocode hit: "${entityName}" → "${geoResult.label}" ` +
    `confidence=${confidence.toFixed(2)} ambiguous=${geoResult.ambiguous} isCountry=${geoResult.isCountry}`,
  );

  const resolved: ResolvedLocation = {
    name: geoResult.label,
    lat: geoResult.lat,
    lng: geoResult.lng,
    source: 'geocode',
    confidence,
    ambiguous: geoResult.ambiguous ?? false,
    isCountry: geoResult.isCountry ?? false,
  };
  cacheSet(cacheKey, resolved, TTL.GEOCODE);
  return resolved;
}

/**
 * Try HERE Discover API for POI/landmark resolution.
 * Returns a ResolvedLocation if a name-matched result is found with valid coords.
 * Returns null if no confident match (caller should try geocode next).
 *
 * Match criteria:
 *   - Top result name must pass isDiscoverMatch (bidirectional substring check)
 *   - Must have valid lat/lng coordinates
 */
async function tryDiscoverPoi(entityName: string): Promise<ResolvedLocation | null> {
  try {
    // VNM-scoped first (most travel queries are Vietnam locations)
    const results = await discover(entityName, undefined, 3, false);

    // Check top result for name match
    for (const item of results) {
      if (!item.lat || !item.lng) continue;
      if (!isDiscoverMatch(item.name, entityName)) continue;

      return {
        name: item.name,
        lat: item.lat,
        lng: item.lng,
        source: 'discover',
        confidence: 0.85,
        ambiguous: false,
        isCountry: false,
      };
    }

    // No VNM match → try global Discover
    const globalResults = await discover(entityName, undefined, 3, true);
    for (const item of globalResults) {
      if (!item.lat || !item.lng) continue;
      if (!isDiscoverMatch(item.name, entityName)) continue;

      return {
        name: item.name,
        lat: item.lat,
        lng: item.lng,
        source: 'discover',
        confidence: 0.80, // slightly lower confidence for global results
        ambiguous: false,
        isCountry: false,
      };
    }

    return null;
  } catch (err: any) {
    logger.debug(`[LocationResolver] Discover POI search failed for "${entityName}": ${err.message}`);
    return null;
  }
}

/**
 * Fire-and-forget: log entity names that fail resolution.
 * Stored in alias_misses table for analysis — identifies which aliases need to be added.
 * Uses upsert: increments hit_count on repeated misses for the same entity.
 */
function logAliasMiss(entityName: string, reason: string): void {
  const normalized = normalize(entityName);
  query(
    `INSERT INTO alias_misses (entity_normalized, entity_raw, reason, hit_count, last_seen)
     VALUES ($1, $2, $3, 1, NOW())
     ON CONFLICT (entity_normalized) DO UPDATE SET
       hit_count = alias_misses.hit_count + 1,
       last_seen = NOW()`,
    [normalized, entityName, reason],
  ).catch((err) => {
    // Table may not exist yet — that's OK, just log debug
    logger.debug(`[LocationResolver] alias_misses log failed: ${err.message}`);
  });
}
