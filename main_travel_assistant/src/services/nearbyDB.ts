import { query } from '../config/db';
import { logger } from '../utils/logger';
import type { DiscoverResult } from '../types';

/**
 * Search nearby attractions from DB using PostGIS ST_DWithin + ST_Distance.
 *
 * Uses spatial index on attractions.location for fast radius queries.
 * Called before HERE Discover as "DB-first" approach.
 */
export async function searchNearbyFromDB(
  lat: number,
  lng: number,
  radiusKm = 10,
  limit = 5,
): Promise<DiscoverResult[]> {
  try {
    const res = await query(
      `SELECT name_vi AS name,
              ST_Y(location) AS latitude,
              ST_X(location) AS longitude,
              place_type AS category,
              ST_Distance(
                location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) / 1000.0 AS distance_km
       FROM attractions
       WHERE location IS NOT NULL
         AND status = 'active'
         AND ST_DWithin(
               location::geography,
               ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
               $3 * 1000
             )
       ORDER BY distance_km
       LIMIT $4`,
      [lat, lng, radiusKm, limit],
    );

    return (res.rows || []).map((r: any) => ({
      name: r.name,
      lat: parseFloat(r.latitude),
      lng: parseFloat(r.longitude),
      distance: Math.round(r.distance_km * 1000), // convert to meters for DiscoverResult
      category: r.category,
    }));
  } catch (err: any) {
    logger.error(`[NearbyDB] PostGIS query failed: ${err.message}`);
    return [];
  }
}
