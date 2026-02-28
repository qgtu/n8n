import express from 'express';
import { TelegramController } from './modules/telegram/telegram.controller.js';
import { telegramAuthGuard } from './middlewares/auth.middleware.js';
import { requestContextMiddleware } from './middlewares/requestContext.middleware.js';
import { idempotencyGuard } from './middlewares/idempotency.middleware.js';
import { rateLimitGuard } from './middlewares/rateLimit.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';

const app = express();
const telegramController = new TelegramController();

// 1. Core Middlewares
app.use(express.json());

// 2. Monitoring / Health
app.get('/health', (req, res) => res.send('OK'));

// 3. Webhook Entry Point
// Chain: Auth -> Context(Logger) -> RateLimit -> Idempotency -> Action
app.post('/api/telegram', 
  telegramAuthGuard,
  requestContextMiddleware as any, // Cast to avoid Express extended Request typing issues here
  rateLimitGuard,
  idempotencyGuard,
  (req, res) => telegramController.handleWebhook(req, res)
);

// 4. Global Error Handler
app.use(errorMiddleware);

export default app;
