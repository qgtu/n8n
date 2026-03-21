import { discover } from '../services/here';
import { resolveLocation } from '../services/locationResolver';
import { searchNearbyFromDB } from '../services/nearbyDB';
import { buildFallback } from '../core/fallbackEngine';
import { cacheGet, cacheSet, TTL, makeCacheKey } from '../services/cache';
import { escapeHtml, normalize as stripDiacritics } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult, DiscoverResult } from '../types';

/** Map Vietnamese category words → search query */
const CATEGORY_MAP: Record<string, string> = {
  'quán ăn': 'restaurant',
  'nhà hàng': 'restaurant',
  'ăn': 'restaurant',
  'ăn uống': 'restaurant',
  'cà phê': 'cafe',
  'cafe': 'cafe',
  'khách sạn': 'hotel',
  'nhà nghỉ': 'hotel',
  'hotel': 'hotel',
  'atm': 'ATM',
  'ngân hàng': 'bank',
  'bệnh viện': 'hospital',
  'trạm xăng': 'gas station',
  'siêu thị': 'supermarket',
  'chợ': 'market',
  'du lịch': 'tourist attraction',
  'điểm du lịch': 'tourist attraction',
  'chơi': 'tourist attraction',
};

/**
 * SEARCH_NEARBY handler.
 * Flow: resolveLocation → DB haversine → (if <3) merge HERE Discover → format.
 * Uses global discover when location source is geocode (international).
 */
export async function handleNearby(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  try {
    const searchEntity = ctx.entity || 'Ninh Bình';
    logger.debug(`[Nearby] ▶ entity="${ctx.entity}" searchEntity="${searchEntity}" _nearbyCategory="${ctx._nearbyCategory}"`);

    const loc = await resolveLocation(searchEntity);
    logger.debug(`[Nearby]   resolveLocation → ${loc ? `source=${loc.source} confidence=${loc.confidence.toFixed(2)} ambiguous=${loc.ambiguous}` : 'null'}`);

    if (!loc) return buildFallback('ENTITY_NOT_FOUND', ctx.intent, searchEntity);
    if (loc.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, searchEntity);
    if (loc.isCountry) return buildFallback('COUNTRY_LEVEL_ENTITY', ctx.intent, searchEntity);

    const category = ctx._nearbyCategory || resolveCategory(ctx.entity || 'du lịch');
    logger.debug(`[Nearby]   category="${category}"`);

    const cacheKey = makeCacheKey('nearby', `${loc.lat},${loc.lng}`, category);
    const cached = cacheGet<DiscoverResult[]>(cacheKey);
    if (cached) {
      logger.debug(`[Nearby]   cache HIT → ${cached.length} results`);
      return formatNearby(cached, loc.name, category);
    }

    const dbResults = await searchNearbyFromDB(loc.lat, loc.lng, 10, 5);
    logger.debug(`[Nearby]   DB haversine → ${dbResults.length} results`);

    if (dbResults.length >= 3) {
      logger.debug(`[Nearby]   DB sufficient (${dbResults.length}≥3) — skipping API`);
      cacheSet(cacheKey, dbResults, TTL.NEARBY);
      return formatNearby(dbResults, loc.name, category);
    }

    // Use global discover when location came from geocode (international location)
    const isGlobal = loc.source === 'geocode';
    logger.debug(`[Nearby]   DB insufficient — calling HERE Discover global=${isGlobal} category="${category}"`);
    const apiResults = await discover(category, { lat: loc.lat, lng: loc.lng }, 5, isGlobal);
    logger.debug(`[Nearby]   HERE Discover → ${apiResults?.length ?? 0} results`);

    const merged = mergeResults(dbResults, apiResults || []);
    logger.debug(`[Nearby]   merged total=${merged.length}`);

    if (merged.length > 0) {
      cacheSet(cacheKey, merged, TTL.NEARBY);
      return formatNearby(merged, loc.name, category);
    }

    return buildFallback('NO_RESULT', ctx.intent, searchEntity);
  } catch (err: any) {
    logger.error(`[Nearby] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

function resolveCategory(entity: string): string {
  const lower = entity.toLowerCase();
  for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return cat;
  }
  return entity;
}

/** Merge DB + API results, deduplicate by normalized name */
function mergeResults(dbResults: DiscoverResult[], apiResults: DiscoverResult[]): DiscoverResult[] {
  const seen = new Set<string>();
  const merged: DiscoverResult[] = [];

  for (const r of dbResults) {
    const key = stripDiacritics(r.name);
    if (!seen.has(key)) { seen.add(key); merged.push(r); }
  }

  for (const r of apiResults) {
    if (merged.length >= 5) break;
    const key = stripDiacritics(r.name);
    if (!seen.has(key)) { seen.add(key); merged.push(r); }
  }

  return merged;
}

function formatNearby(
  results: DiscoverResult[],
  locationLabel: string,
  category: string,
): InternalResponse {
  let msg = `📍 <b>Kết quả gần ${escapeHtml(locationLabel)}</b>\n\n`;

  results.forEach((r, i) => {
    const dist = r.distance ? ` – ${(r.distance / 1000).toFixed(1)}km` : '';
    msg += `${i + 1}️⃣ <b>${escapeHtml(r.name)}</b>${dist}\n`;
    if (r.address) msg += `   ${escapeHtml(r.address)}\n`;
    msg += '\n';
  });

  return { type: 'text', message: msg.trim(), data: results };
}
