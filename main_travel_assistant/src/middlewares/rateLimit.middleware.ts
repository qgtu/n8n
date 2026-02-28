import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database.js';

/**
 * Basic DB-based rate limit middleware.
 * Limits users to 10 requests per 30 second window.
 */
export async function rateLimitGuard(req: Request, res: Response, next: NextFunction) {
  const userId = req.body?.message?.from?.id?.toString() || 'unknown';
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 30000) * 30000); // 30s window

  try {
    const resLimit = await query(
      `INSERT INTO rate_limits (user_id, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [userId, windowStart]
    );

    const count = resLimit.rows[0].count;

    if (count > 10) {
      console.log(`[RateLimit] Blocking user ${userId}: ${count} requests in 30s window`);
      return res.status(200).send('Rate limit exceeded'); // 200 to Telegram to stop retries
    }

    next();
  } catch (error) {
    console.error('[RateLimit] Error guard:', error);
    next();
  }
}
