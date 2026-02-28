import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';
import { logger } from './shared/utils/logger.js';
import http from 'http';

/**
 * Server entry point.
 */
async function startServer() {
  let server: http.Server;

  try {
    // 1. Check Database connection
    await pool.query('SELECT 1');
    logger.info('✅ Connected to PostgreSQL');

    // 2. Start Express listener
    server = app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${env.PORT}`);
      logger.info(`Ready for Telegram webhooks at /api/telegram`);
    });

    // 3. Graceful Shutdown definitions
    const gracefulShutdown = async (signal: string) => {
      logger.info(`\n[GracefulShutdown] Received ${signal}. Starting shutdown...`);
      
      // Close HTTP server
      server.close(async () => {
        logger.info('[GracefulShutdown] HTTP server closed.');
        try {
          // Close DB Pool
          await pool.end();
          logger.info('[GracefulShutdown] Database connections closed.');
          process.exit(0);
        } catch (err) {
          logger.error('[GracefulShutdown] Error closing DB pool', err);
          process.exit(1);
        }
      });

      // Force exit after 10s if hung
      setTimeout(() => {
        logger.error('[GracefulShutdown] Forcefully terminating after 10s timeout');
        process.exit(1);
      }, 10000);
    };

    // Attach listeners
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
