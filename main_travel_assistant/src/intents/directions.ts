import { resolveLocation } from '../services/locationResolver';
import { getDirections } from '../services/directions';
import { buildFallback } from '../core/fallbackEngine';
import { slugify } from '../utils/slugResolver';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult } from '../types';
const MODE_LABELS: Record<string, string> = {
  'driving-car': '🚗 Ô tô',
  'cycling-regular': '🚲 Xe đạp',
  'foot-walking': '🚶 Đi bộ',
};

/**
 * GET_DIRECTIONS handler.
 * Flow: resolveLocation (DB → geocodeGlobal) both endpoints → ORS route → format.
 */
export async function handleDirections(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  const origin = ctx.entity_origin;
  const destination = ctx.entity_destination;

  if (!origin || !destination) {
    return {
      type: 'clarify',
      message: 'Bạn muốn đi từ đâu đến đâu?\n(Ví dụ: từ Tam Cốc đến Tràng An)',
    };
  }

  // Origin = Destination guard
  const originSlug = slugify(origin);
  const destSlug = slugify(destination);
  if (originSlug && destSlug && originSlug === destSlug) {
    return { type: 'text', message: '📍 Hai địa điểm trùng nhau. Bạn muốn đi từ đâu đến đâu?' };
  }

  try {
    // Resolve both endpoints in parallel (DB → geocodeGlobal, with confidence + ambiguity)
    const [locOrigin, locDest] = await Promise.all([
      resolveLocation(origin),
      resolveLocation(destination),
    ]);

    logger.debug(`[Directions] origin="${origin}" → ${locOrigin ? `source=${locOrigin.source} ambiguous=${locOrigin.ambiguous}` : 'null'}`);
    logger.debug(`[Directions] dest="${destination}" → ${locDest ? `source=${locDest.source} ambiguous=${locDest.ambiguous}` : 'null'}`);

    if (!locOrigin) return buildFallback('ENTITY_NOT_FOUND', ctx.intent, origin);
    if (locOrigin.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, origin);
    if (!locDest) return buildFallback('ENTITY_NOT_FOUND', ctx.intent, destination);
    if (locDest.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, destination);

    const rawMode = (ctx._routeMode as string) || 'driving-car';
    const mode = MODE_LABELS[rawMode] ? rawMode : 'driving-car';
    const dirs = await getDirections(
      { lat: locOrigin.lat, lng: locOrigin.lng, label: locOrigin.name },
      { lat: locDest.lat, lng: locDest.lng, label: locDest.name },
      mode,
    );

    if (!dirs || isNaN(dirs.distance_km) || isNaN(dirs.duration_minutes)) {
      return buildFallback('API_UNAVAILABLE', ctx.intent);
    }

    // Distance-only mode (triggered by "bao xa", "khoảng cách" keywords)
    if (ctx._routeMode === 'distance_only') {
      return {
        type: 'text',
        message:
          `📏 <b>Khoảng cách</b>\n\n` +
          `📍 ${escapeHtml(locOrigin.name)} → ${escapeHtml(locDest.name)}\n` +
          `📏 ${dirs.distance_km} km — ${formatDuration(dirs.duration_minutes)}`,
        data: dirs,
      };
    }

    // Full directions with Google Maps link
    const modeLabel = MODE_LABELS[mode] || mode;
    const gmMode = mode === 'driving-car' ? 'driving' : mode === 'foot-walking' ? 'walking' : 'bicycling';
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${locOrigin.lat},${locOrigin.lng}&destination=${locDest.lat},${locDest.lng}&travelmode=${gmMode}`;
    const msg =
      `🗺 <b>Chỉ đường</b>\n\n` +
      `📍 Từ: ${escapeHtml(locOrigin.name)}\n` +
      `📍 Đến: ${escapeHtml(locDest.name)}\n\n` +
      `📏 Quãng đường: ${dirs.distance_km} km\n` +
      `⏱ Thời gian: ${formatDuration(dirs.duration_minutes)}\n` +
      `${modeLabel}\n\n` +
      `🔗 <a href="${mapsUrl}">Xem trên Google Maps</a>`;

    return { type: 'text', message: msg, data: { ...dirs, maps_link: mapsUrl } };
  } catch (err: any) {
    logger.error(`[Directions] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent);
  }
}

/** Format minutes into human-readable Vietnamese duration (e.g. 492 → "8 giờ 12 phút") */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} phút`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours} giờ`;
  return `${hours} giờ ${mins} phút`;
}
