import { SessionRepository, BotSession } from './session.repository.js';
import { Intent } from '../../shared/types/common.js';

/**
 * Service managing user conversation state.
 */
export class SessionService {
  /**
   * Load user session from DB.
   */
  static async load(userId: string): Promise<BotSession> {
    const sessionId = `u_${userId}`;
    return await SessionRepository.getSession(sessionId);
  }

  /**
   * Update session after a successful interaction.
   */
  static async updateAfterResponse(
    userId: string, 
    intent: Intent, 
    entity?: string | null, 
    slug?: string | null
  ): Promise<void> {
    const session = await this.load(userId);
    
    // Update context
    session.context_data.turn_count += 1;
    session.context_data.last_intent = intent;
    
    if (entity) {
      session.context_data.last_entity = entity;
    }
    if (slug) {
      session.context_data.last_place_slug = slug;
    }

    await SessionRepository.saveSession(session);
  }
}
