import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { InternalResponse } from '../types';

const BASE_URL = `https://api.telegram.org/bot${env.TELEGRAM.TOKEN}`;

/**
 * Send a message via the Telegram Bot API, with exponential-backoff retry.
 */
async function sendRaw(chatId: string, text: string, retries = 2): Promise<void> {
  const url = `${BASE_URL}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };

  for (let i = 0; i <= retries; i++) {
    try {
      await axios.post(url, payload);
      return;
    } catch (error: any) {
      const status = error.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        logger.error(`[TelegramSender] Unrecoverable ${status}`, error.response?.data);
        throw error;
      }
      if (i === retries) {
        logger.error('[TelegramSender] Max retries reached');
        throw error;
      }
      logger.warn(`[TelegramSender] Retry ${i + 1} for chatId ${chatId}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

/**
 * Send an InternalResponse to a Telegram chat.
 */
export async function sendTelegramMessage(chatId: string, response: InternalResponse): Promise<void> {
  await sendRaw(chatId, response.message);
}
