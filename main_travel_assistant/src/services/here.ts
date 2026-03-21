import { env } from '../config/env';
import { http } from '../utils/http';
import { cacheGet, cacheSet, TTL, makeCacheKey } from './cache';
import { isCircuitClosed, recordSuccess, recordFailure } from '../utils/circuitBreaker';
import { normalize } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { GeoResult, DiscoverResult } from '../types';

const CB_NAME = 'here';

const API_KEY = env.API.HERE_KEY;

/**
 * Geocode a place name → lat/lng. Scoped to Ninh Bình, Vietnam.
 */
export async function geocode(placeName: string): Promise<GeoResult | null> {
  if (!placeName || !API_KEY) return null;

  const cacheKey = makeCacheKey('geo', placeName);
  const cached = cacheGet<GeoResult>(cacheKey);
  if (cached) return cached;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn(`[HERE] Circuit OPEN — skipping geocode for "${placeName}"`);
    return null;
  }

  try {
    const res = await http.get('https://geocode.search.hereapi.com/v1/geocode', {
      params: {
        q: `${placeName}, Ninh Bình, Vietnam`,
        in: 'countryCode:VNM',
        apiKey: API_KEY,
        limit: 1,
      },
    });

    const item = res.data?.items?.[0];
    if (!item) { recordSuccess(CB_NAME); return null; }

    // Validate: geocode result label must plausibly match the query
    // Prevents "trung quốc" → "Quốc Lễ" false-match under countryCode:VNM
    const resultLabel = item.title || item.address?.label || '';
    if (!isGeoMatch(resultLabel, placeName)) {
      logger.warn(`[HERE] Geocode rejected: "${placeName}" → "${resultLabel}" (no match)`);
      recordSuccess(CB_NAME);
      return null;
    }

    const result: GeoResult = {
      lat: item.position.lat,
      lng: item.position.lng,
      label: resultLabel || placeName,
    };

    cacheSet(cacheKey, result, TTL.GEOCODE);
    recordSuccess(CB_NAME);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[HERE] Geocode failed for "${placeName}": ${err.message}`);
    return null;
  }
}

/**
 * Discover places nearby a location.
 * Pass global=true to remove the VNM country restriction (for international locations).
 */
export async function discover(
  queryText: string,
  at?: { lat: number; lng: number },
  limit = 5,
  global = false,
): Promise<DiscoverResult[]> {
  if (!API_KEY) return [];

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn(`[HERE] Circuit OPEN — skipping discover for "${queryText}"`);
    return [];
  }

  try {
    const params: Record<string, any> = {
      q: queryText,
      limit,
      apiKey: API_KEY,
    };
    if (!global) params['in'] = 'countryCode:VNM';

    // Provide location hint: required for VNM-scoped, optional for global
    const center = at || (global ? null : { lat: 20.2506, lng: 105.9745 });
    if (center) params['at'] = `${center.lat},${center.lng}`;

    const res = await http.get('https://discover.search.hereapi.com/v1/discover', { params });

    recordSuccess(CB_NAME);
    return (res.data?.items || []).map((item: any) => ({
      name: item.title,
      address: item.address?.label,
      distance: item.distance,
      lat: item.position?.lat,
      lng: item.position?.lng,
      category: item.categories?.[0]?.name,
      openingHours: item.openingHours?.[0]?.text
        ? [item.openingHours[0].text]
        : undefined,
    }));
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[HERE] Discover failed for "${queryText}": ${err.message}`);
    return [];
  }
}

/**
 * Result type confidence boosts.
 * Coarser-grained types (city, country) are more useful for travel queries.
 */
const RESULT_TYPE_BOOST: Record<string, number> = {
  locality: 0.15,           // city, town, village
  administrativeArea: 0.10, // country, state, province
  place: 0.10,              // named POI
  street: -0.10,            // just a street
  houseNumber: -0.20,       // specific address
  intersection: -0.20,
};

const MIN_GEO_CONFIDENCE = 0.45;   // below this → treat as not found
const AMBIGUOUS_SCORE_GATE = 0.70; // both top results above this AND different countries → ambiguous

function scoreGeoItem(item: any): number {
  const queryScore: number = typeof item.scoring?.queryScore === 'number'
    ? item.scoring.queryScore
    : 0.5;
  const boost = RESULT_TYPE_BOOST[item.resultType ?? ''] ?? 0;
  return Math.min(1, Math.max(0, queryScore + boost));
}

/**
 * Geocode a place name → lat/lng. Global — no country restriction.
 * Includes confidence scoring and ambiguity detection.
 * Returns null if confidence < MIN_GEO_CONFIDENCE.
 * Returns result with ambiguous=true if two high-score candidates exist in different countries.
 */
export async function geocodeGlobal(placeName: string): Promise<GeoResult | null> {
  if (!placeName || !API_KEY) return null;

  const cacheKey = makeCacheKey('geo_global', placeName);
  const cached = cacheGet<GeoResult>(cacheKey);
  if (cached) return cached;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn(`[HERE] Circuit OPEN — skipping geocodeGlobal for "${placeName}"`);
    return null;
  }

  try {
    const res = await http.get('https://geocode.search.hereapi.com/v1/geocode', {
      params: {
        q: placeName,
        apiKey: API_KEY,
        limit: 2, // fetch 2 to detect ambiguity
      },
    });

    const items: any[] = res.data?.items ?? [];
    recordSuccess(CB_NAME);

    if (items.length === 0) return null;

    const top = items[0];
    const topLabel = top.title || top.address?.label || '';
    const topScore = scoreGeoItem(top);

    logger.debug(
      `[HERE] geocodeGlobal "${placeName}" → "${topLabel}" type=${top.resultType} ` +
      `queryScore=${top.scoring?.queryScore} finalScore=${topScore.toFixed(2)}`,
    );

    // Reject low-confidence results before isGeoMatch to avoid false positives
    if (topScore < MIN_GEO_CONFIDENCE) {
      logger.warn(`[HERE] geocodeGlobal low confidence (${topScore.toFixed(2)}) for "${placeName}" → rejected`);
      return null;
    }

    // Validate name overlap
    if (!isGeoMatch(topLabel, placeName)) {
      logger.warn(`[HERE] geocodeGlobal name mismatch: "${placeName}" → "${topLabel}" → rejected`);
      return null;
    }

    // Ambiguity detection: second result also high-score AND different country
    let ambiguous = false;
    if (items.length > 1) {
      const second = items[1];
      const secondScore = scoreGeoItem(second);
      const country0 = top.address?.countryCode;
      const country1 = second.address?.countryCode;
      if (
        secondScore >= AMBIGUOUS_SCORE_GATE &&
        topScore >= AMBIGUOUS_SCORE_GATE &&
        country0 && country1 && country0 !== country1
      ) {
        ambiguous = true;
        logger.debug(
          `[HERE] geocodeGlobal AMBIGUOUS for "${placeName}": ` +
          `"${topLabel}"(${country0}) vs "${second.title}"(${country1})`,
        );
      }
    }

    // Country detection: query matched the country itself, not a city/POI in it
    const isCountry =
      top.resultType === 'administrativeArea' &&
      !!top.address?.countryName &&
      normalize(topLabel) === normalize(top.address.countryName);

    if (isCountry) {
      logger.debug(`[HERE] geocodeGlobal COUNTRY-LEVEL result for "${placeName}": "${topLabel}"`);
    }

    const result: GeoResult = {
      lat: top.position.lat,
      lng: top.position.lng,
      label: topLabel || placeName,
      confidence: topScore,
      ambiguous,
      isCountry,
    };

    cacheSet(cacheKey, result, TTL.GEOCODE);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[HERE] geocodeGlobal failed for "${placeName}": ${err.message}`);
    return null;
  }
}

/**
 * Check if a HERE geocode result label is a plausible match for the query.
 * Prevents "trung quốc" → "Quốc Lễ" by checking word overlap.
 * Requires majority of significant query words to appear in the label.
 */
function isGeoMatch(label: string, queryName: string): boolean {
  if (!label || !queryName) return false;
  const a = normalize(label);
  const b = normalize(queryName);

  // Fast path: simple substring
  if (a.includes(b) || b.includes(a)) return true;

  // Word-level: majority of significant query words (≥2 chars) must appear in label
  const labelWords = a.split(/[\s,]+/).filter(w => w.length >= 2);
  const queryWords = b.split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return false;

  const hits = queryWords.filter(qw => labelWords.some(lw => lw === qw || lw.includes(qw)));
  return hits.length > queryWords.length / 2;
}

/**
 * Check if a HERE Discover result name is a plausible match for the user entity.
 * Prevents returning wrong places (e.g., querying "Tràng An" but getting "Hà Nội Airport").
 */
export function isDiscoverMatch(resultName: string, entity: string): boolean {
  if (!resultName || !entity) return false;
  const a = normalize(resultName);
  const b = normalize(entity);
  return a.includes(b) || b.includes(a);
}
