import { discover } from '../services/here';
import { resolveLocation } from '../services/locationResolver';
import { searchNearbyFromDB } from '../services/nearbyDB';
import { buildFallback } from '../core/fallbackEngine';
import { cacheGet, cacheSet, TTL, makeCacheKey } from '../services/cache';
import { escapeHtml, normalize as stripDiacritics } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult, DiscoverResult } from '../types';

/**
 * DISCOVER_LOCATION handler.
 * "Đà Nẵng có gì hay?", "nên đi đâu ở Hội An"
 *
 * Flow: resolveLocation → DB haversine (30km) → HERE tourist attractions → format top 5.
 */
export async function handleDiscover(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  try {
    const city = ctx.entity;
    logger.debug(`[Discover] ▶ entity="${city}"`);

    const loc = await resolveLocation(city);
    logger.debug(`[Discover]   resolveLocation → ${loc ? `source=${loc.source} confidence=${loc.confidence.toFixed(2)}` : 'null'}`);

    if (!loc) return buildFallback('ENTITY_NOT_FOUND', ctx.intent, city);
    if (loc.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, city);
    if (loc.isCountry) return buildFallback('COUNTRY_LEVEL_ENTITY', ctx.intent, city);

    const cacheKey = makeCacheKey('discover', `${loc.lat},${loc.lng}`);
    const cached = cacheGet<DiscoverResult[]>(cacheKey);
    if (cached) {
      logger.debug(`[Discover]   cache HIT → ${cached.length} results`);
      return formatDiscover(cached, loc.name);
    }

    // DB: places within 30km radius
    const dbResults = await searchNearbyFromDB(loc.lat, loc.lng, 30, 5);
    logger.debug(`[Discover]   DB haversine (30km) → ${dbResults.length} results`);

    if (dbResults.length >= 3) {
      cacheSet(cacheKey, dbResults, TTL.NEARBY);
      return formatDiscover(dbResults, loc.name);
    }

    // HERE fallback: tourist attractions near resolved location
    const isGlobal = loc.source === 'geocode';
    const apiResults = await discover('tourist attraction', { lat: loc.lat, lng: loc.lng }, 5, isGlobal);
    logger.debug(`[Discover]   HERE attractions → ${apiResults.length} results`);

    const merged = mergeUnique([...dbResults, ...apiResults]);
    if (merged.length > 0) {
      cacheSet(cacheKey, merged, TTL.NEARBY);
      return formatDiscover(merged, loc.name);
    }

    return buildFallback('NO_RESULT', ctx.intent, city);
  } catch (err: any) {
    logger.error(`[Discover] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

function mergeUnique(results: DiscoverResult[]): DiscoverResult[] {
  const seen = new Set<string>();
  const out: DiscoverResult[] = [];
  for (const r of results) {
    const key = stripDiacritics(r.name);
    if (!seen.has(key) && out.length < 5) { seen.add(key); out.push(r); }
  }
  return out;
}

function formatDiscover(results: DiscoverResult[], cityName: string): InternalResponse {
  let msg = `🗺 <b>Địa điểm nổi bật tại ${escapeHtml(cityName)}</b>\n\n`;
  results.slice(0, 5).forEach((r, i) => {
    msg += `${i + 1}️⃣ <b>${escapeHtml(r.name)}</b>\n`;
    if (r.address) msg += `   📍 ${escapeHtml(r.address)}\n`;
    if (r.category) msg += `   📂 ${escapeHtml(r.category)}\n`;
    msg += '\n';
  });
  msg += `<i>Bạn muốn biết thêm về địa điểm nào không?</i>`;
  return { type: 'text', message: msg.trim(), data: results };
}
