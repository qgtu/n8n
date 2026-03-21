import { searchTours } from '../services/tour';
import { resolveLocation } from '../services/locationResolver';
import { discover } from '../services/here';
import { buildFallback } from '../core/fallbackEngine';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult, TourInfo, DiscoverResult } from '../types';

/**
 * SEARCH_TOUR handler.
 * Flow: exact search → relax duration (keep place!) → HERE Discover fallback → clarify/fallback.
 *
 * Relax rule: NEVER drop place if user specified it.
 * Only relax duration — suggest closest available durations.
 *
 * Discover fallback: When DB has no tours at all for a location,
 * use HERE Discover to find nearby attractions and present a dynamic suggestion.
 */
export async function handleTour(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  try {
    const entity = ctx.entity;
    const placeSlug = ctx.slug || undefined;

    logger.debug(`[Tour] ▶ entity="${entity}" slug="${placeSlug}" duration=${ctx.duration_days}`);

    // Step 1: Exact search (place + duration)
    let tours = (await searchTours(ctx.duration_days, placeSlug)) || [];

    // Step 2: Relax ONLY duration — keep place filter
    // If user asked for "tour 3 ngày Hồ Tây" and no exact match, show all durations at Hồ Tây
    if (tours.length === 0 && ctx.duration_days && placeSlug) {
      logger.debug(`[Tour]   relaxing: drop duration filter (keeping place="${placeSlug}")`);
      tours = (await searchTours(undefined, placeSlug)) || [];

      if (tours.length > 0) {
        // Found tours at same place with different duration — tell user
        const cityLabel = entity || placeSlug;
        const availableDurations = [...new Set(tours.map(t => t.duration_days))].sort((a, b) => a - b);
        let msg = `📋 Không có tour ${ctx.duration_days} ngày tại <b>${escapeHtml(cityLabel)}</b>.\n`;
        msg += `Hiện có tour ${availableDurations.map(d => `${d} ngày`).join(', ')}:\n\n`;
        msg += formatTourList(tours, cityLabel);
        return { type: 'text', message: msg, data: tours };
      }
    }

    // Step 3: No place match at all — try without place only if user didn't specify one
    if (tours.length === 0 && !placeSlug && ctx.duration_days) {
      logger.debug(`[Tour]   no place specified, searching by duration only`);
      tours = (await searchTours(ctx.duration_days, undefined)) || [];
    }

    // Step 4: DB has no tours — try HERE Discover for nearby attractions
    if (tours.length === 0 && entity) {
      logger.debug(`[Tour]   DB empty — trying HERE Discover for "${entity}"`);
      const discoverResult = await discoverTourAttractions(entity, ctx.duration_days);
      if (discoverResult) return discoverResult;
    }

    // Step 5: Still nothing
    if (tours.length === 0) {
      // If duration is missing, ask for it (triggers multi-turn)
      if (!ctx.duration_days) {
        return {
          type: 'clarify',
          message: 'Bạn muốn đi tour mấy ngày ạ?',
        };
      }
      return buildFallback('NO_RESULT', ctx.intent, entity);
    }

    const cityLabel = entity || 'Ninh Bình';
    return { type: 'text', message: formatTourList(tours, cityLabel), data: tours };
  } catch (err: any) {
    logger.error(`[Tour] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

/**
 * HERE Discover fallback: find nearby attractions for a dynamic tour suggestion.
 * Uses resolveLocation → Discover(category) → format as itinerary.
 */
async function discoverTourAttractions(
  entity: string,
  durationDays?: number,
): Promise<InternalResponse | null> {
  try {
    // Resolve entity to lat/lng
    const loc = await resolveLocation(entity);
    if (!loc) {
      logger.debug(`[Tour] Discover fallback: resolveLocation("${entity}") returned null`);
      return null;
    }

    logger.debug(
      `[Tour] Discover fallback: "${entity}" → ${loc.name} (${loc.lat},${loc.lng}) source=${loc.source}`,
    );

    // Search for tourist attractions near the resolved location
    const center = { lat: loc.lat, lng: loc.lng };
    const isGlobal = loc.source !== 'db';
    const attractions = await discover(
      `du lịch ${entity}`,
      center,
      10,
      isGlobal,
    );

    if (!attractions || attractions.length === 0) {
      logger.debug(`[Tour] Discover fallback: no attractions found near "${entity}"`);
      return null;
    }

    // Filter: only keep results with coordinates
    const valid = attractions.filter(a => a.lat && a.lng && a.name);
    if (valid.length === 0) return null;

    // Format as a dynamic tour suggestion
    const cityLabel = loc.name || entity;
    const daysLabel = durationDays ? `${durationDays} ngày` : '';
    return {
      type: 'text',
      message: formatDiscoverTour(valid, cityLabel, daysLabel),
      data: { source: 'discover', location: loc, attractions: valid },
    };
  } catch (err: any) {
    logger.debug(`[Tour] Discover fallback error: ${err.message}`);
    return null;
  }
}

/**
 * Format Discover attractions as a dynamic tour suggestion.
 */
function formatDiscoverTour(
  attractions: DiscoverResult[],
  cityLabel: string,
  daysLabel: string,
): string {
  const title = daysLabel
    ? `🗺 <b>Gợi ý tour ${daysLabel} tại ${escapeHtml(cityLabel)}</b>`
    : `🗺 <b>Gợi ý tour tại ${escapeHtml(cityLabel)}</b>`;

  let msg = `${title}\n`;
  msg += `<i>Dựa trên các điểm du lịch nổi bật trong khu vực:</i>\n\n`;

  const shown = attractions.slice(0, 8);
  shown.forEach((a, i) => {
    msg += `${i + 1}. <b>${escapeHtml(a.name)}</b>`;
    if (a.category) msg += ` (${escapeHtml(a.category)})`;
    msg += '\n';
    if (a.address) msg += `   📍 ${escapeHtml(a.address)}\n`;
  });

  if (attractions.length > 8) {
    msg += `\n...và ${attractions.length - 8} điểm khác.`;
  }

  msg += `\n\n💡 Bạn có thể hỏi thêm về từng địa điểm hoặc xem chỉ đường.`;
  return msg.trim();
}

function formatTourList(tours: TourInfo[], cityLabel: string): string {
  let msg = `🗓 <b>Tour du lịch ${escapeHtml(cityLabel)}</b>\n\n`;

  tours.forEach((t, i) => {
    msg += `${i + 1}️⃣ <b>${escapeHtml(t.name)}</b>\n`;
    msg += `   ⏱ ${t.duration_days} ngày`;
    if (t.price) msg += ` — ${t.price.toLocaleString('vi-VN')}đ`;
    msg += '\n';
    if (t.destinations?.length > 0) {
      msg += `   📍 ${t.destinations.map(d => escapeHtml(d)).join(', ')}\n`;
    }
    if (t.description) msg += `   ${escapeHtml(t.description)}\n`;
    msg += '\n';
  });

  return msg.trim();
}
