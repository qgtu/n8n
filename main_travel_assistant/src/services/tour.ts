import { query } from '../config/db';
import { cacheGet, cacheSet, TTL, makeCacheKey } from './cache';
import { logger } from '../utils/logger';
import type { TourInfo } from '../types';

/**
 * Search tours by duration and/or destination slug.
 */
export async function searchTours(
  durationDays?: number,
  placeSlug?: string,
): Promise<TourInfo[]> {
  const cacheKey = makeCacheKey('tour', String(durationDays || 'any'), placeSlug || 'any');
  const cached = cacheGet<TourInfo[]>(cacheKey);
  if (cached) return cached;

  try {
    const result = await query(
      `SELECT t.name_vi AS name, t.duration_days, t.price, t.description_vi AS description,
              array_agg(p.name_vi) as destinations
       FROM tours t
       JOIN tour_stops ts ON ts.tour_id = t.id
       JOIN attractions p ON p.id = ts.attraction_id
       WHERE ($1::int IS NULL OR t.duration_days = $1)
         AND ($2::text IS NULL OR p.slug = $2 OR EXISTS (
           SELECT 1 FROM location_aliases la
           WHERE la.attraction_id = p.id AND la.alias = $2
         ))
       GROUP BY t.id
       ORDER BY t.price ASC
       LIMIT 5`,
      [durationDays || null, placeSlug || null],
    );

    const tours: TourInfo[] = result.rows.map((r: any) => ({
      name: r.name,
      duration_days: r.duration_days,
      price: r.price,
      description: r.description,
      destinations: r.destinations || [],
    }));

    if (tours.length > 0) cacheSet(cacheKey, tours, TTL.TOUR);
    return tours;
  } catch (err: any) {
    logger.error(`[Tour] DB query failed: ${err.message}`);
    return [];
  }
}
