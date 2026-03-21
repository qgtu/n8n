import { query } from '../config/db';
import { logger } from './logger';
import type { GeoResult } from '../types';

/**
 * Strip diacritics from Vietnamese text (private — use normalize() for general use).
 */
function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

/**
 * URL-friendly slug: remove accents, special chars, spaces → dashes.
 */
export function slugify(text: string): string {
  if (!text) return '';
  return stripDiacritics(text)
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Full resolution: entity text → alias FK lookup → attraction slug.
 * Falls back to slugify() if no alias match.
 */
export async function resolveSlug(entity: string): Promise<string> {
  if (!entity) return '';
  const stripped = stripDiacritics(entity);

  // Try alias → attraction slug via FK join
  const res = await query(
    `SELECT p.slug FROM location_aliases la
     JOIN attractions p ON p.id = la.attraction_id
     WHERE la.alias = $1 LIMIT 1`,
    [stripped],
  );
  if (res.rowCount && res.rowCount > 0) return res.rows[0].slug;

  // Fallback: slugify the entity directly
  return slugify(entity);
}

/**
 * Resolve entity text → lat/lng from DB attractions table (PostGIS).
 *
 * Pipeline (all free, no API calls):
 *   1. Exact alias match → attraction slug → coords (PostGIS ST_Y/ST_X)
 *   2. Exact slug match (slugified entity) → coords
 *   3. Fuzzy alias match (LIKE %token%) → coords (catches "ho guom" → "ho hoan kiem")
 *   4. Direct attractions.name_vi match (stripped diacritics) → coords
 *   5. null → caller falls through to geocode
 */
export async function resolveCoords(entityName: string): Promise<GeoResult | null> {
  if (!entityName) return null;

  const stripped = stripDiacritics(entityName);

  // Step 1: Exact alias → slug → coords (PostGIS)
  const aliasRes = await query(
    `SELECT p.name_vi AS name, ST_Y(p.location) AS latitude, ST_X(p.location) AS longitude
     FROM location_aliases la
     JOIN attractions p ON p.id = la.attraction_id
     WHERE la.alias = $1 AND p.location IS NOT NULL
     LIMIT 1`,
    [stripped],
  );
  if (aliasRes.rowCount && aliasRes.rowCount > 0) {
    return extractGeo(aliasRes.rows[0]);
  }

  // Step 2: Exact slug match (slugified entity)
  const slug = slugify(entityName);
  if (slug) {
    const slugRes = await query(
      `SELECT name_vi AS name, ST_Y(location) AS latitude, ST_X(location) AS longitude
       FROM attractions
       WHERE slug = $1 AND location IS NOT NULL
       LIMIT 1`,
      [slug],
    );
    if (slugRes.rowCount && slugRes.rowCount > 0) {
      return extractGeo(slugRes.rows[0]);
    }
  }

  // Step 3: Fuzzy alias match — only for meaningful-length queries (≥5 chars stripped)
  if (stripped.length >= 5) {
    const fuzzyRes = await query(
      `SELECT p.name_vi AS name, ST_Y(p.location) AS latitude, ST_X(p.location) AS longitude, la.attraction_id
       FROM location_aliases la
       JOIN attractions p ON p.id = la.attraction_id
       WHERE la.alias LIKE $1 AND p.location IS NOT NULL
       ORDER BY LENGTH(la.alias) ASC
       LIMIT 5`,
      [`%${stripped}%`],
    );
    if (fuzzyRes.rowCount && fuzzyRes.rowCount > 0) {
      const placeIds = new Set(fuzzyRes.rows.map((r: any) => r.attraction_id));
      if (placeIds.size === 1) {
        return extractGeo(fuzzyRes.rows[0]);
      }
      logger.debug(`[SlugResolver] Fuzzy LIKE ambiguous: "${stripped}" matched ${placeIds.size} different places — skipping`);
    }
  }

  // Step 4: Direct name match (stripped diacritics comparison)
  if (stripped.length >= 5) {
    const nameRes = await query(
      `SELECT name_vi AS name, ST_Y(location) AS latitude, ST_X(location) AS longitude
       FROM attractions
       WHERE LOWER(REGEXP_REPLACE(TRANSLATE(name_vi, 'đĐ', 'dD'), '[^\x20-\x7E]', '', 'g')) LIKE $1
       AND location IS NOT NULL
       LIMIT 1`,
      [`%${stripped}%`],
    );
    if (nameRes.rowCount && nameRes.rowCount > 0) {
      return extractGeo(nameRes.rows[0]);
    }
  }

  return null;
}

/** Safely extract GeoResult from a DB row, handling string lat/lng. */
function extractGeo(row: any): GeoResult | null {
  const lat = typeof row.latitude === 'string' ? parseFloat(row.latitude) : row.latitude;
  const lng = typeof row.longitude === 'string' ? parseFloat(row.longitude) : row.longitude;
  if (isNaN(lat) || isNaN(lng) || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) return null;
  return { lat, lng, label: row.name };
}
