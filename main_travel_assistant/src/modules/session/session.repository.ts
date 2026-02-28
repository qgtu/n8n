import { query } from '../../config/database.js';

export interface BotSession {
  session_id: string; // Typically same as userId for 1-1 chats
  context_data: {
    last_intent?: string;
    last_place_slug?: string;
    last_entity?: string;
    turn_count: number;
    [key: string]: any;
  };
}

/**
 * Repository for bot session DB interaction.
 */
export class SessionRepository {
  /**
   * Load or initialize a session for a user.
   */
  static async getSession(sessionId: string): Promise<BotSession> {
    const res = await query('SELECT context_data FROM bot_sessions WHERE session_id = $1', [sessionId]);
    if (res.rowCount && res.rowCount > 0) {
      return { session_id: sessionId, context_data: res.rows[0].context_data };
    }
    
    // Default context
    return {
      session_id: sessionId,
      context_data: { turn_count: 0 }
    };
  }

  /**
   * Save session state to the DB (Upsert).
   */
  static async saveSession(session: BotSession): Promise<void> {
    await query(
      `INSERT INTO bot_sessions (session_id, context_data, updated_at, expires_at) 
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '7 days')
       ON CONFLICT (session_id) DO UPDATE 
       SET context_data = $2, updated_at = NOW(), expires_at = NOW() + INTERVAL '7 days'`,
      [session.session_id, session.context_data]
    );
  }
}
