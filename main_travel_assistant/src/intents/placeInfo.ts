import { query } from '../config/db';
import { discover, isDiscoverMatch } from '../services/here';
import { resolveLocation } from '../services/locationResolver';
import { buildFallback } from '../core/fallbackEngine';
import { cacheGet, cacheSet, TTL, makeCacheKey } from '../services/cache';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult, PlaceInfo } from '../types';

/**
 * GET_PLACE_INFO handler.
 * Flow: Cache → DB → resolveLocation → HERE Discover (global if geocode) → fallback.
 */
export async function handlePlaceInfo(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  const slug = ctx.slug || ctx.entity;
  if (!slug) {
    return { type: 'clarify', message: 'Bạn muốn hỏi về địa điểm nào ạ?' };
  }

  try {
    // Cache check
    const ck = makeCacheKey('place', slug);
    const cached = cacheGet<PlaceInfo>(ck);
    if (cached) return formatPlace(cached);

    // DB lookup
    const result = await query(
      `SELECT p.name_vi AS name, p.slug, p.description_vi AS description, p.place_type AS category,
              ST_Y(p.location) AS latitude, ST_X(p.location) AS longitude
       FROM attractions p
       LEFT JOIN location_aliases la ON la.attraction_id = p.id
       WHERE p.slug = $1 OR la.alias = $1
       LIMIT 1`,
      [slug],
    );

    if (result.rowCount && result.rowCount > 0) {
      const place = result.rows[0] as PlaceInfo;
      cacheSet(ck, place, TTL.PLACE_INFO);
      return formatPlace(place);
    }

    // DB miss — resolve location then discover nearby with correct global flag
    const loc = await resolveLocation(ctx.entity);
    if (loc?.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, ctx.entity);
    if (loc?.isCountry) return buildFallback('COUNTRY_LEVEL_ENTITY', ctx.intent, ctx.entity);

    // When loc=null: use VNM-scoped discover — avoids HERE 400 (requires at OR in)
    const isGlobal = loc?.source === 'geocode';
    const center = loc ? { lat: loc.lat, lng: loc.lng } : undefined;
    const hereResults = await discover(ctx.entity, center, 5, isGlobal);

    if (hereResults.length > 0 && hereResults[0] && isDiscoverMatch(hereResults[0].name, ctx.entity)) {
      const h = hereResults[0];
      logger.debug(`[PlaceInfo] HERE fallback hit: "${h.name}"`);
      return {
        type: 'text',
        message:
          `📍 <b>${escapeHtml(h.name)}</b>\n\n` +
          (h.address ? `🏠 ${escapeHtml(h.address)}\n` : '') +
          (h.category ? `📂 ${escapeHtml(h.category)}\n` : '') +
          `\n<i>Nguồn: HERE Maps</i>`,
        data: h,
      };
    }

    return buildFallback('NO_RESULT', ctx.intent, ctx.entity);
  } catch (err: any) {
    logger.error(`[PlaceInfo] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

function formatPlace(p: PlaceInfo): InternalResponse {
  let msg = `📍 <b>${escapeHtml(p.name)}</b>\n\n`;
  if (p.description) msg += `${escapeHtml(p.description)}\n\n`;
  if (p.category) msg += `📂 ${escapeHtml(p.category)}\n`;

  return { type: 'text', message: msg, data: p };
}
