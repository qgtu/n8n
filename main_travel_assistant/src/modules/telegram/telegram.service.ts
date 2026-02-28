import { classifyIntent } from '../intent/intent.classifier.js';
import { TelegramClient } from './telegram.client.js';
import { TicketService } from '../ticket/ticket.service.js';
import { Intent, ServiceResponse } from '../../shared/types/common.js';
import { SessionService } from '../session/session.service.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../config/database.js';

const ticketService = new TicketService();

/**
 * Main orchestrator for Telegram updates.
 * Equivalent to the "Workflow" in n8n.
 */
export class TelegramService {
  /**
   * Handle an incoming Telegram update.
   */
  public async handleUpdate(update: any): Promise<void> {
    const updateId = update.update_id;
    const message = update.message || update.edited_message;
    if (!message || !message.text) return;

    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text;

    try {
      logger.info(`[TelegramService] Processing update_id: ${updateId} from user_id: ${userId}`);

      // 1. Load Session Context
      const session = await SessionService.load(userId);
      logger.info(`[TelegramService] Loaded session. current turn_count: ${session.context_data.turn_count}`);

      // 2. Classify Intent
      const { intent, entity } = classifyIntent(text);
      logger.info(`[TelegramService] Classified intent: ${intent}, entity: ${entity || 'none'}`);

      // 3. Dispatch to Sub-Service
      let response: ServiceResponse;
      let slugToSave: string | undefined;

      switch (intent) {
        case Intent.GET_TICKET_PRICE:
          response = await ticketService.getPrice(entity || '');
          if (response.success && response.data && response.data.length > 0) {
            // For DB responses, save the actual place slug/name for future context
            slugToSave = response.data[0].slug || entity;
          }
          break;
        
        // Future cases...
        default:
          response = {
            success: false,
            type: 'unknown',
            data: null,
            message: 'Xin lỗi, mình chưa hiểu ý bạn. Bạn có thể hỏi về giá vé, thời tiết hoặc địa điểm du lịch nhé!'
          };
      }

      // 4. Reply to User
      await TelegramClient.sendMessage(chatId, response.message);
      
      // 5. Update Session State
      await SessionService.updateAfterResponse(userId, intent, entity, slugToSave);
      logger.info(`[TelegramService] Successfully processed and replied to update_id: ${updateId}`);

    } catch (error: any) {
      logger.error(`[TelegramService] Critical failure processing update_id: ${updateId}`, error.stack || error.message);
      
      // Idempotency Rollback: Remove the lock so Telegram can retry
      if (updateId) {
        try {
          await query('DELETE FROM update_logs WHERE update_id = $1', [updateId]);
          logger.info(`[TelegramService] Rolled back idempotency lock for update_id: ${updateId}`);
        } catch (dbError) {
          logger.error(`[TelegramService] Failed to rollback idempotency lock for update_id: ${updateId}`, dbError);
        }
      }
    }
  }
}
