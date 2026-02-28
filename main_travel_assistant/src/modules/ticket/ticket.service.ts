import axios from 'axios';
import { env } from '../../config/env.js';
import { ServiceResponse } from '../../shared/types/common.js';
import { normalizeText } from '../../shared/utils/normalize.js';
import { findTicketsBySlug, TicketRow } from './ticket.repository.js';
import { resolveAlias } from '../../shared/utils/aliases.js';
import { slugify } from '../../shared/utils/slugify.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Business logic for tickets. Coordinates repository and API fallback.
 */
export class TicketService {
  /**
   * Get ticket price for a place.
   */
  public async getPrice(entityName: string): Promise<ServiceResponse> {
    if (!entityName) {
      return {
        success: false,
        type: 'clarify',
        data: null,
        message: 'Bạn muốn xem giá vé địa điểm nào? Ví dụ: "Giá vé Tràng An bao nhiêu?"'
      };
    }

    // 1. Normalize and resolve alias
    const normalized = normalizeText(entityName);
    const canonical = await resolveAlias(normalized) || normalized;
    const slug = slugify(canonical);

    // 2. Query Database
    const rows = await findTicketsBySlug(slug);
    
    if (rows.length > 0) {
      return this.formatDBResponse(rows, canonical);
    }

    // 3. Fallback to HERE API
    return this.fallbackToAPI(canonical);
  }

  private formatDBResponse(rows: TicketRow[], name: string): ServiceResponse {
    const province = rows[0].province;
    const openTime = rows[0].open_time;
    const closeTime = rows[0].close_time;
    const isClosed = rows[0].is_closed;

    let msg = `🎫 <b>Giá vé ${rows[0].name || name}</b>\n\n`;

    rows.forEach(t => {
      const adult = t.adult_price > 0 
        ? t.adult_price.toLocaleString('vi-VN') + 'đ' 
        : 'Miễn phí 🆓';
      const child = t.child_price > 0 
        ? t.child_price.toLocaleString('vi-VN') + 'đ' 
        : 'Miễn phí 🆓';

      msg += `• <b>${t.ticket_type}</b>:\n`;
      msg += `  💰 Người lớn: ${adult}\n`;
      msg += `  👶 Trẻ em: ${child}\n`;
      if (t.notes && t.notes !== 'Miễn phí') {
        msg += `  📝 ${t.notes}\n`;
      }
      msg += '\n';
    });

    if (openTime && closeTime && !isClosed) {
      msg += `⏰ Giờ mở cửa hôm nay: ${openTime.substring(0, 5)} – ${closeTime.substring(0, 5)}\n`;
    } else if (isClosed) {
      msg += `⏰ Hôm nay: Đóng cửa\n`;
    }

    if (province) {
      msg += `📍 ${province}\n`;
    }

    return {
      success: true,
      type: 'ticket_price',
      data: rows,
      message: msg.trim()
    };
  }

  private async fallbackToAPI(name: string): Promise<ServiceResponse> {
    try {
      const url = `https://discover.search.hereapi.com/v1/discover?at=20.25,105.97&q=${encodeURIComponent(name)}&apiKey=${env.API.HERE_KEY}&limit=1`;
      // strict 1.5s timeout circuit breaker
      const res = await axios.get(url, { timeout: 1500 });
      const items = res.data?.items;

      if (!items || items.length === 0) {
        return {
          success: false,
          type: 'not_found',
          data: null,
          message: `❌ Không tìm thấy thông tin giá vé của <b>${name}</b>.`
        };
      }

      const place = items[0];
      const estimate = '30.000 – 150.000 VNĐ'; // Ước tính chung
      
      let msg = `🎫 <b>Giá vé ${place.title}</b>\n\n`;
      msg += `⚠️ Thông tin chưa có trong hệ thống — đây là ước tính tham khảo:\n\n`;
      msg += `💰 Giá vé ước tính: ${estimate}\n`;
      if (place.address?.label) msg += `📍 Khu vực: ${place.address.label}\n`;
      msg += `\n💡 Để có giá chính xác, vui lòng gọi điện hoặc truy cập website của địa điểm.`;

      return {
        success: true,
        type: 'ticket_price',
        data: place,
        message: msg
      };
    } catch (error: any) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        logger.warn(`[TicketService] HERE API Timeout (1.5s) for entity: ${name}`);
      } else {
        logger.error(`[TicketService] HERE API Error for entity: ${name}`, error.message);
      }
      return {
        success: false,
        type: 'error',
        data: null,
        message: `⚠️ Hệ thống tra cứu đang bận. Vui lòng thử lại sau nhé.`
      };
    }
  }
}
