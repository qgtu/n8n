import { env } from '../config/env';
import { http } from '../utils/http';
import { cacheGet, cacheSet, TTL, makeCacheKey } from './cache';
import { isCircuitClosed, recordSuccess, recordFailure } from '../utils/circuitBreaker';
import { logger } from '../utils/logger';
import { haversineDistance, estimateDuration } from '../utils/distance';
import type { GeoResult, DirectionsData } from '../types';

const CB_NAME = 'ors';

/** Distance threshold (km) — above this, skip ORS and use haversine directly */
const HAVERSINE_ONLY_THRESHOLD = 200;

/** ORS timeout — keep short, haversine fallback handles failures */
const ORS_TIMEOUT_MS = 5_000;

/**
 * Get directions between two points.
 *
 * Strategy:
 *   1. Calculate haversine distance (instant, always available)
 *   2. If distance > 200km → return haversine result (ORS too slow for long routes)
 *   3. If distance ≤ 200km → try ORS for accurate road distance, fall back to haversine on failure
 */
export async function getDirections(
  origin: GeoResult,
  destination: GeoResult,
  mode = 'driving-car',
): Promise<DirectionsData | null> {
  const cacheKey = makeCacheKey('dir', `${origin.lat},${origin.lng}→${destination.lat},${destination.lng}`, mode);
  const cached = cacheGet<DirectionsData>(cacheKey);
  if (cached) return cached;

  // Always compute haversine as baseline
  const straightKm = haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
  const estMinutes = estimateDuration(straightKm, mode);

  logger.debug(`[Directions] Haversine: ${straightKm}km, est ${estMinutes}min (${mode})`);

  // Long distance → haversine only (ORS times out on 200km+ routes)
  if (straightKm > HAVERSINE_ONLY_THRESHOLD) {
    logger.info(`[Directions] ${straightKm}km > ${HAVERSINE_ONLY_THRESHOLD}km threshold → haversine only`);
    const result: DirectionsData = {
      distance_km: straightKm,
      duration_minutes: estMinutes,
      mode,
      origin_label: origin.label,
      destination_label: destination.label,
    };
    cacheSet(cacheKey, result, TTL.DIRECTIONS);
    return result;
  }

  // Short distance → try ORS for accurate road distance
  if (!env.API.ORS_KEY || !isCircuitClosed(CB_NAME)) {
    if (!env.API.ORS_KEY) {
      logger.debug('[Directions] No ORS key — using haversine');
    } else {
      logger.warn('[Directions] Circuit OPEN — using haversine fallback');
    }
    const result: DirectionsData = {
      distance_km: straightKm,
      duration_minutes: estMinutes,
      mode,
      origin_label: origin.label,
      destination_label: destination.label,
    };
    cacheSet(cacheKey, result, TTL.DIRECTIONS);
    return result;
  }

  try {
    const res = await http.post(
      `https://api.openrouteservice.org/v2/directions/${mode}`,
      {
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
      },
      {
        headers: {
          Authorization: env.API.ORS_KEY,
          'Content-Type': 'application/json',
        },
        timeout: ORS_TIMEOUT_MS,
      },
    );

    // POST returns JSON format: routes[0].summary (not GeoJSON features[])
    const route = res.data?.routes?.[0];
    const summary = route?.summary;
    if (!summary) {
      logger.warn(`[Directions] ORS returned empty route — using haversine fallback`);
      const result: DirectionsData = {
        distance_km: straightKm,
        duration_minutes: estMinutes,
        mode,
        origin_label: origin.label,
        destination_label: destination.label,
      };
      cacheSet(cacheKey, result, TTL.DIRECTIONS);
      return result;
    }

    const result: DirectionsData = {
      distance_km: Math.round((summary.distance / 1000) * 10) / 10,
      duration_minutes: Math.round(summary.duration / 60),
      mode,
      origin_label: origin.label,
      destination_label: destination.label,
    };

    cacheSet(cacheKey, result, TTL.DIRECTIONS);
    recordSuccess(CB_NAME);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.warn(`[Directions] ORS failed (${err.message}) — using haversine fallback`);

    const result: DirectionsData = {
      distance_km: straightKm,
      duration_minutes: estMinutes,
      mode,
      origin_label: origin.label,
      destination_label: destination.label,
    };
    cacheSet(cacheKey, result, TTL.DIRECTIONS);
    return result;
  }
}
