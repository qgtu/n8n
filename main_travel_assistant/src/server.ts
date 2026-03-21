import app from './app';
import { env } from './config/env';
import { pool } from './config/db';
import { logger } from './utils/logger';
import { loadIntentKeywords } from './core/intent.engine';
import { loadEntityGraph } from './core/entityGraph';

async function startServer() {
  try {
    await pool.query('SELECT NOW()');
    logger.info('[Server] Database connected.');

    // Load intent keywords from DB into memory (must complete before accepting requests)
    await loadIntentKeywords();

    // Load entity graph from DB into memory (must complete before accepting requests)
    await loadEntityGraph();

    app.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`[Server] Travel Assistant running on http://localhost:${env.PORT}`);
      logger.info(`[Server] Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error('[Server] Critical failure during startup:', error);
    process.exit(1);
  }
}

const shutdown = async (signal: string) => {
  logger.info(`[Server] ${signal} received. Closing pool...`);
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
