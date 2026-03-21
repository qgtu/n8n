import { Router } from 'express';
import { telegramController } from '../controllers/telegram.controller';

const router = Router();

router.post('/api/webhook/telegram', telegramController);

export default router;
