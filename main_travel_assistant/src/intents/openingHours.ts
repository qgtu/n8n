import { query } from '../config/db';
import { discover, isDiscoverMatch } from '../services/here';
import { resolveLocation } from '../services/locationResolver';
import { buildFallback } from '../core/fallbackEngine';
import { cacheGet, cacheSet, TTL, makeCacheKey } from '../services/cache';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult, OpenHour } from '../types';

const DAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/**
 * GET_OPENING_HOURS handler.
 * Flow: Cache → DB → resolveLocation → HERE Discover (global if geocode) → fallbackEngine.
 */
export async function handleOpeningHours(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  const slug = ctx.slug || ctx.entity;
  if (!slug) {
    return { type: 'clarify', message: 'Bạn muốn hỏi giờ mở cửa địa điểm nào?' };
  }

  try {
    // Cache
    const ck = makeCacheKey('hours', slug);
    const cached = cacheGet<{ placeName: string; hours: OpenHour[] }>(ck);
    if (cached) return formatHours(cached.placeName, cached.hours);

    // DB
    const result = await query(
      `SELECT p.name_vi as place_name, oh.day_of_week, oh.open_time, oh.close_time, oh.is_closed
       FROM opening_hours oh
       JOIN attractions p ON p.id = oh.attraction_id
       LEFT JOIN location_aliases la ON la.attraction_id = p.id
       WHERE p.slug = $1 OR la.alias = $1
       ORDER BY oh.day_of_week`,
      [slug],
    );

    if (result.rowCount && result.rowCount > 0) {
      const placeName = result.rows[0].place_name;
      const hours: OpenHour[] = result.rows.map((r: any) => ({
        day_of_week: r.day_of_week,
        open_time: r.open_time,
        close_time: r.close_time,
        note: r.is_closed ? 'Đóng cửa' : undefined,
      }));
      cacheSet(ck, { placeName, hours }, TTL.OPENING_HOURS);
      return formatHours(placeName, hours);
    }

    // DB miss — resolve location then discover
    const loc = await resolveLocation(ctx.entity);
    if (loc?.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, ctx.entity);
    if (loc?.isCountry) return buildFallback('COUNTRY_LEVEL_ENTITY', ctx.intent, ctx.entity);

    const isGlobal = loc?.source === 'geocode';
    const center = loc ? { lat: loc.lat, lng: loc.lng } : undefined;
    const hereResults = await discover(ctx.entity, center, 3, isGlobal);

    if (hereResults.length > 0 && hereResults[0] && isDiscoverMatch(hereResults[0].name, ctx.entity)) {
      const h = hereResults[0];
      if (h.openingHours && h.openingHours.length > 0) {
        let msg = `🕐 <b>Giờ mở cửa ${escapeHtml(h.name)}</b>\n\n`;
        for (const line of h.openingHours) msg += `${escapeHtml(line)}\n`;
        msg += `\n<i>Lưu ý: Từ nguồn bên ngoài, có thể không chính xác.\nNguồn: HERE Maps</i>`;
        return { type: 'text', message: msg, data: { placeName: h.name, openingHours: h.openingHours } };
      }
      return {
        type: 'text',
        message: `📍 Mình tìm thấy <b>${escapeHtml(h.name)}</b> nhưng chưa có thông tin giờ mở cửa.`,
        data: { placeName: h.name },
      };
    }

    return buildFallback('NO_RESULT', ctx.intent, ctx.entity);
  } catch (err: any) {
    logger.error(`[OpenHours] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

function formatHours(placeName: string, hours: OpenHour[]): InternalResponse {
  let msg = `🕐 <b>Giờ mở cửa ${escapeHtml(placeName)}</b>\n\n`;

  for (const h of hours) {
    const day = DAY_NAMES[h.day_of_week] || `Ngày ${h.day_of_week}`;
    msg += `${day}: ${h.open_time} – ${h.close_time}`;
    if (h.note) msg += ` (${escapeHtml(h.note)})`;
    msg += '\n';
  }

  return { type: 'text', message: msg, data: { placeName, hours } };
}
