import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Global error handler — never leaks stack traces to the client.
 */
export function errorMiddleware(err: any, req: Request, res: Response, _next: NextFunction): void {
  const reqId = req.reqId ?? 'N/A';
  logger.error(`[GlobalError] reqId=${reqId}`, err.stack || err.message);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
}
