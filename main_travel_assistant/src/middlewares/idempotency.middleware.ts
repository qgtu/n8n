import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database.js';

/**
 * Idempotency middleware: checks if current update_id has already been processed.
 * Uses the update_logs table.
 */
export async function idempotencyGuard(req: Request, res: Response, next: NextFunction) {
  const update = req.body;
  const updateId = update?.update_id;
  const userId = update?.message?.from?.id || 'unknown';

  if (!updateId) return next();

  try {
    // Check if exists
    const check = await query('SELECT 1 FROM update_logs WHERE update_id = $1', [updateId]);
    
    if (check.rowCount && check.rowCount > 0) {
      console.log(`[Idempotency] Skipping duplicate update_id: ${updateId}`);
      return res.status(200).send('Duplicate suppressed');
    }

    // Insert to mark as processed (Optimistic insert)
    await query(
      'INSERT INTO update_logs (update_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [updateId, userId.toString()]
    );

    next();
  } catch (error) {
    console.error('[Idempotency] Error guard:', error);
    next(); // Fail open for the guard
  }
}
