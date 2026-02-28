import { Request, Response } from 'express';
import { TelegramService } from './telegram.service.js';

const telegramService = new TelegramService();

/**
 * REST controller for the /api/telegram webhook endpoint.
 */
export class TelegramController {
  /**
   * Main entry point for Telegram bot updates.
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const update = req.body;
      
      // Async handling to keep Telegram happy with fast 200 OK
      telegramService.handleUpdate(update).catch(err => {
        console.error('[Webhook] Dispatch error:', err);
      });

      res.status(200).send('OK');
    } catch (error) {
      console.error('[Webhook] Controller error:', error);
      res.status(500).send('Internal Server Error');
    }
  }
}
