import { query } from '../config/db';
import { logger } from '../utils/logger';
import type { ClassifyResult } from '../types';

export interface SearchLogMeta {
  is_unknown?: boolean;
  is_missing_entity?: boolean;
  is_fallback?: boolean;
  latency_ms?: number;
}

/**
 * Log search event for analytics. Fire-and-forget — never crashes pipeline.
 */
export async function logSearch(
  chatId: string,
  rawText: string,
  result: ClassifyResult,
  resolvedSlug?: string,
  meta?: SearchLogMeta,
): Promise<void> {
  try {
    await query(
      `INSERT INTO search_logs
       (session_id, intent, entity, source, is_unknown, is_missing_entity, is_fallback, latency_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        chatId,
        result.intent,
        result.entity,
        result.source,
        meta?.is_unknown ?? false,
        meta?.is_missing_entity ?? false,
        meta?.is_fallback ?? false,
        meta?.latency_ms ?? null,
      ],
    );
  } catch (err: any) {
    logger.warn(`[SearchLog] Failed: ${err.message}`);
  }
}
