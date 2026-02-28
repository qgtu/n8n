import { Request, Response, NextFunction } from 'express';

/**
 * Global error handler: catches all unhandled exceptions.
 * Returns a friendly message to the user while logging details internally.
 */
export function errorMiddleware(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('[GlobalError]', err.stack || err);

  // If this was during a webhook request, we must send 200 OK so Telegram doesn't retry
  if (req.path.includes('/api/telegram')) {
    return res.status(200).send('Internal Error Handled');
  }

  res.status(500).json({
    success: false,
    message: '⚠️ Có lỗi hệ thống xảy ra. Vui lòng thử lại sau.'
  });
}
