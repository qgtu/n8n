import { Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { runPipeline } from '../core/pipeline';
import { sendTelegramMessage } from '../telegram/sender';
import { logger } from '../utils/logger';
import type { InternalMessage } from '../types';

/**
 * Telegram webhook controller.
 *
 * 1. Verify secret token
 * 2. Parse update → InternalMessage
 * 3. ACK 200 immediately (never block Telegram)
 * 4. Process async: pipeline → send response
 */
export function telegramController(req: Request, res: Response): void {
  // Auth check
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== env.TELEGRAM.SECRET_TOKEN) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const update = req.body;
  const message = update.message || update.edited_message;

  if (!message?.text) {
    logger.debug(`[Controller] Skipping non-text update_id=${update.update_id}`);
    res.status(200).send('OK');
    return;
  }

  const chatId = String(message.chat.id);
  const userId = String(message.from.id);
  const updateId = String(update.update_id);
  const reqId = req.reqId ?? crypto.randomUUID();

  logger.debug(
    `[Controller] ▶ Incoming update_id=${updateId} reqId=${reqId} userId=${userId} chatId=${chatId} text="${message.text}"`,
  );

  // ACK 200 immediately — never block Telegram
  res.status(200).send('OK');

  const internalMessage: InternalMessage = {
    platform: 'telegram',
    userId,
    sessionId: `u_${userId}`,
    chatId,
    text: message.text,
    timestamp: Date.now(),
    locale: message.from.language_code || 'vi',
    metadata: { reqId, updateId },
  };

  // Process async
  processAsync(internalMessage, reqId).catch((err) => {
    logger.error(`[Controller] Unhandled error reqId=${reqId}`, err);
  });
}

async function processAsync(message: InternalMessage, reqId: string): Promise<void> {
  try {
    logger.debug(`[Controller] ⚙ Processing reqId=${reqId} text="${message.text}"`);
    const response = await runPipeline(message);

    // Silent OK = idempotency duplicate, don't send to user
    if (response.type === 'text' && response.message === 'OK') {
      logger.debug(`[Controller] Idempotency duplicate — skipping send reqId=${reqId}`);
      return;
    }

    logger.debug(`[Controller] ✉ Sending response type=${response.type} reqId=${reqId}`);
    await sendTelegramMessage(message.chatId, response);
    logger.debug(`[Controller] ✓ Sent to chatId=${message.chatId} reqId=${reqId}`);
  } catch (error: any) {
    logger.error(`[Controller] Error reqId=${reqId}: ${error.message}`);
    try {
      await sendTelegramMessage(message.chatId, {
        type: 'error',
        message: '⚠️ Hệ thống đang bận. Bạn vui lòng thử lại sau giây lát nhé.',
      });
    } catch {
      logger.error('[Controller] Failed to send error message');
    }
  }
}
