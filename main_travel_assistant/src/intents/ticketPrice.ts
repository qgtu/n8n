import { query } from '../config/db';
import { discover, isDiscoverMatch } from '../services/here';
import { resolveLocation } from '../services/locationResolver';
import { buildFallback } from '../core/fallbackEngine';
import { cacheGet, cacheSet, TTL, makeCacheKey } from '../services/cache';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult } from '../types';

/**
 * GET_TICKET_PRICE handler.
 * Flow: Cache → DB → resolveLocation → HERE Discover (global if needed) → fallback.
 */
export async function handleTicketPrice(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  const slug = ctx.slug || ctx.entity;
  if (!slug) {
    return { type: 'clarify', message: 'Bạn muốn xem giá vé ở địa điểm nào ạ?' };
  }

  try {
    // Cache
    const ck = makeCacheKey('ticket', slug);
    const cached = cacheGet<TicketRow[]>(ck);
    if (cached && cached.length > 0) return formatTickets(cached, ctx.entity);

    // DB lookup
    const result = await query(
      `SELECT p.name_vi AS name, p.slug, tk.ticket_type, tk.adult_price, tk.child_price, tk.notes
       FROM tickets tk
       JOIN attractions p ON p.id = tk.attraction_id
       LEFT JOIN location_aliases la ON la.attraction_id = p.id
       WHERE p.slug = $1 OR la.alias = $1`,
      [slug],
    );

    if (result.rowCount && result.rowCount > 0) {
      const tickets = result.rows as TicketRow[];
      cacheSet(ck, tickets, TTL.TICKET_PRICE);
      return formatTickets(tickets, ctx.entity);
    }

    // DB miss — check if place exists via resolveLocation + HERE Discover
    const loc = await resolveLocation(ctx.entity);
    if (loc?.ambiguous) return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, ctx.entity);
    if (loc?.isCountry) return buildFallback('COUNTRY_LEVEL_ENTITY', ctx.intent, ctx.entity);

    // When loc=null (no coords found): use VNM-scoped discover — avoids HERE 400
    // (HERE Discover requires either `at` OR `in`, cannot omit both)
    const isGlobal = loc?.source === 'geocode';
    const center = loc ? { lat: loc.lat, lng: loc.lng } : undefined;
    const hereResults = await discover(ctx.entity, center, 3, isGlobal);

    if (hereResults.length > 0 && hereResults[0] && isDiscoverMatch(hereResults[0].name, ctx.entity)) {
      logger.debug(`[TicketPrice] HERE found place "${hereResults[0].name}" but no ticket data`);
      return {
        type: 'text',
        message:
          `📍 Mình tìm thấy <b>${escapeHtml(hereResults[0].name)}</b> nhưng chưa có thông tin giá vé.\n` +
          `Bạn nên liên hệ trực tiếp địa điểm để hỏi giá vé nhé.`,
        data: { place: hereResults[0] },
      };
    }

    return buildFallback('NO_RESULT', ctx.intent, ctx.entity);
  } catch (err: any) {
    logger.error(`[TicketPrice] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

interface TicketRow {
  name: string;
  slug: string;
  ticket_type: string;
  adult_price: number;
  child_price: number;
  notes: string | null;
}

function formatTickets(tickets: TicketRow[], entityName: string): InternalResponse {
  const t = tickets[0]!;
  const priceAdult =
    t.adult_price === 0 ? '🆓 Miễn phí' : `${t.adult_price.toLocaleString('vi-VN')}đ`;
  const priceChild =
    t.child_price === 0 ? '🆓 Miễn phí' : `${t.child_price.toLocaleString('vi-VN')}đ`;

  let msg =
    `🎫 <b>Giá vé ${escapeHtml(t.name)}</b>\n\n` +
    `💰 Người lớn: ${priceAdult}\n` +
    `👶 Trẻ em: ${priceChild}\n`;

  if (t.notes) msg += `\n📝 ${escapeHtml(t.notes)}\n`;
  msg += `\n📍 <i>Giá có thể thay đổi tùy thời điểm.</i>`;

  return { type: 'text', message: msg, data: tickets };
}
