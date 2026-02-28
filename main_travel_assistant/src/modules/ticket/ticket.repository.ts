import { query } from '../../config/database.js';

export interface TicketRow {
  name: string;
  province?: string;
  ticket_type: string;
  adult_price: number;
  child_price: number;
  notes?: string;
  open_time?: string;
  close_time?: string;
  is_closed?: boolean;
}

/**
 * Repository for ticket data. Pure DB queries.
 */
export async function findTicketsBySlug(slug: string): Promise<TicketRow[]> {
  const sql = `
    SELECT p.name, p.province, t.ticket_type, t.adult_price, t.child_price, t.notes,
      oh.open_time, oh.close_time, oh.is_closed
    FROM tickets t
    JOIN places p ON p.id = t.place_id
    LEFT JOIN opening_hours oh ON oh.place_id = p.id
      AND oh.day_of_week = EXTRACT(DOW FROM NOW())
    WHERE p.slug = $1 AND p.is_active = true
  `;
  
  const res = await query(sql, [slug]);
  return res.rows;
}
