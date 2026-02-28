import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../shared/utils/logger.js';

export interface AuthenticatedRequest extends Request {
  reqId?: string;
  startTime?: number;
}

/**
 * Request Context: Injects a unique reqId and startTime for tracing/logging.
 */
export function requestContextMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  req.reqId = uuidv4();
  req.startTime = Date.now();
  
  // Attach reqId to logger for the scope
  const childLogger = logger.child({ reqId: req.reqId });
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime!;
    childLogger.info(`Request completed`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration
    });
  });

  next();
}
