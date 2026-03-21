import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Robust .env loading: try CWD first, then parent (covers both repo-root and sub-project CWDs)
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
];
for (const p of candidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Database (Postgres)
  DB: {
    HOST: process.env.DB_POSTGRESDB_HOST || 'localhost',
    PORT: parseInt(process.env.DB_POSTGRESDB_PORT || '5432', 10),
    USER: process.env.DB_POSTGRESDB_USER || 'postgres',
    PASSWORD: process.env.DB_POSTGRESDB_PASSWORD || '123456',
    NAME: process.env.DB_POSTGRESDB_DATABASE || 'disciplined_travel',
  },

  // Telegram
  TELEGRAM: {
    TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || '',
    SECRET_TOKEN: process.env.TELEGRAM_SECRET_TOKEN || '',
    MODE: (process.env.TELEGRAM_MODE || 'polling') as 'polling' | 'webhook',
  },

  // External APIs
  API: {
    HERE_KEY: process.env.HERE_API_KEY || '',
    OPENROUTER_KEY: process.env.OPENROUTER_API_KEY || '',
    WEATHER_KEY: process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY || '',
    ORS_KEY: process.env.ORS_API_KEY || '',
  },
};

if (!env.TELEGRAM.TOKEN) {
  console.warn('Warning: TELEGRAM_BOT_TOKEN is missing in .env');
}
