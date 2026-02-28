import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * Webhook Security: Verifies the X-Telegram-Bot-Api-Secret-Token header.
 * Rejects any request that doesn't have the correct secret token.
 */
export function telegramAuthGuard(req: Request, res: Response, next: NextFunction) {
  // If no secret token is configured, warn but allow (for dev fallback)
  if (!env.TELEGRAM.SECRET_TOKEN) {
    console.warn('[Security] TELEGRAM_SECRET_TOKEN is not configured. Webhook is unprotected.');
    return next();
  }

  const token = req.header('X-Telegram-Bot-Api-Secret-Token');
  
  if (token !== env.TELEGRAM.SECRET_TOKEN) {
    console.warn(`[Security] Unauthorized webhook attempt. Token: ${token}`);
    return res.status(401).send('Unauthorized');
  }

  next();
}
