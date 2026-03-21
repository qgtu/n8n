import { query } from '../config/db';
import { logger } from '../utils/logger';
import type { BotSession } from '../types';

/**
 * Load or create a session for the given sessionId.
 */
export async function loadSession(sessionId: string): Promise<BotSession> {
  const result = await query(
    'SELECT context_data FROM bot_sessions WHERE session_id = $1',
    [sessionId],
  );

  if (result.rowCount === 0) {
    logger.debug(`[Session] Creating new session: ${sessionId}`);
    const fresh: BotSession = {
      session_id: sessionId,
      context_data: { turn_count: 0 },
    };
    await saveSession(fresh);
    return fresh;
  }

  const contextData = result.rows[0].context_data;
  const session: BotSession = { session_id: sessionId, context_data: contextData };

  // Update last_interaction timestamp for session TTL
  session.context_data.last_interaction = Date.now();

  logger.debug(
    `[Session] Loaded session=${sessionId} turn=${session.context_data.turn_count} ` +
    `last_intent=${session.context_data.last_intent ?? 'none'} pending=${session.context_data.pending_intent ?? 'none'} ` +
    `awaiting=${session.context_data.awaiting_slot ?? 'none'} last_entity="${session.context_data.last_entity ?? ''}"`,
  );

  return session;
}

/**
 * Upsert session state.
 */
export async function saveSession(session: BotSession): Promise<void> {
  logger.debug(
    `[Session] Saving session=${session.session_id} pending=${session.context_data.pending_intent ?? 'none'} ` +
    `awaiting=${session.context_data.awaiting_slot ?? 'none'} filled=${JSON.stringify(session.context_data.filled_slots ?? {})}`,
  );
  await query(
    `INSERT INTO bot_sessions (session_id, context_data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (session_id)
     DO UPDATE SET context_data = EXCLUDED.context_data, updated_at = NOW()`,
    [session.session_id, JSON.stringify(session.context_data)],
  );
}

/**
 * Update session context after a successful response turn.
 */
export async function updateSessionAfterResponse(
  sessionId: string,
  intent: string,
  entity?: string,
  slug?: string,
): Promise<void> {
  const session = await loadSession(sessionId);

  session.context_data = {
    ...session.context_data,
    turn_count: (session.context_data.turn_count || 0) + 1,
    last_intent: intent,
    last_entity: entity || session.context_data.last_entity,
    last_slug: slug || session.context_data.last_slug,
    // Clear V3 multi-turn state
    awaiting_entity: false,
    awaiting_intent: undefined,
    clarify_count: 0,
    // Clear V4 slot-filling state
    pending_intent: undefined,
    filled_slots: undefined,
    awaiting_slot: undefined,
  };

  logger.debug(
    `[Session] updateAfterResponse: session=${sessionId} intent=${intent} entity="${entity ?? ''}" slug="${slug ?? ''}" turn=${session.context_data.turn_count}`,
  );
  await saveSession(session);
}
