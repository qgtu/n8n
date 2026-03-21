import { query } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Atomically check-and-lock an update_id.
 * Uses INSERT ON CONFLICT to avoid race conditions under concurrent requests.
 * Returns true when the message is a duplicate and should be skipped.
 */
export async function isDuplicate(updateId: string): Promise<boolean> {
  if (!updateId) return false;

  const result = await query(
    'INSERT INTO update_logs (update_id, created_at) VALUES ($1, NOW()) ON CONFLICT (update_id) DO NOTHING',
    [updateId],
  );

  if ((result.rowCount ?? 0) === 0) {
    logger.info(`[Idempotency] Duplicate update skipped: ${updateId}`);
    return true;
  }

  return false;
}

/**
 * Rollback the idempotency lock on processing failure so the message can be retried.
 */
export async function rollbackIdempotency(updateId: string): Promise<void> {
  await query('DELETE FROM update_logs WHERE update_id = $1', [updateId]);
}
