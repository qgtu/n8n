import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Inject a unique reqId into every request for log tracing.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = crypto.randomUUID();
  req.reqId = reqId;
  logger.info(`[HTTP] ${req.method} ${req.path} reqId=${reqId}`);
  next();
}
