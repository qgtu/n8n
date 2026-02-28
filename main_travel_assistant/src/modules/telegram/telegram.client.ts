import axios from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Minimal Telegram Bot API client.
 */
export class TelegramClient {
  private static readonly BASE_URL = `https://api.telegram.org/bot${env.TELEGRAM.TOKEN}`;

  /**
   * Send a text message to a specific chat, with retry logic.
   */
  static async sendMessage(chatId: number | string, text: string, options?: any, retries = 2): Promise<any> {
    const url = `${this.BASE_URL}/sendMessage`;
    const payload = { chat_id: chatId, text, parse_mode: 'HTML', ...options };
    
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await axios.post(url, payload);
        return response.data;
      } catch (error: any) {
        const isLastAttempt = i === retries;
        const status = error.response?.status;
        
        // Don't retry client errors (e.g., 400 Bad Request)
        if (status && status >= 400 && status < 500 && status !== 429) {
          logger.error(`[TelegramClient] Unrecoverable error ${status}`, error.response?.data);
          throw error;
        }

        logger.warn(`[TelegramClient] Error sending message (attempt ${i + 1}/${retries + 1}): ${error.message}`);
        
        if (isLastAttempt) {
          logger.error('[TelegramClient] Max retries reached.');
          throw error; // Let orchestrator handle final failure
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
      }
    }
  }

  /**
   * Set the webhook URL for the bot.
   */
  static async setWebhook(url: string): Promise<any> {
    const webhookUrl = `${this.BASE_URL}/setWebhook`;
    try {
      const response = await axios.post(webhookUrl, { url });
      return response.data;
    } catch (error: any) {
      console.error('Telegram setWebhook error', error?.response?.data || error.message);
      throw error;
    }
  }
}
