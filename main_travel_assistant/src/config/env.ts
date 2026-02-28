import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export const env = {
  NODE_ENV: process.env.NODE_ENV || ,
  PORT: parseInt(process.env.PORT ||  10),
  
  // Database (Postgres)
  DB: {
    HOST: process.env.DB_POSTGRESDB_HOST,
    PORT: parseInt(process.env.DB_POSTGRESDB_PORT || 10),
    USER: process.env.DB_POSTGRESDB_USER ,
    PASSWORD: process.env.DB_POSTGRESDB_PASSWORD ,
    NAME: process.env.DB_POSTGRESDB_DATABASE ,
  },
  
  // Telegram
  TELEGRAM: {
    TOKEN: process.env.TELEGRAM_BOT_TOKEN || '', // Cần add vào .env
    WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || '',
    SECRET_TOKEN: process.env.TELEGRAM_SECRET_TOKEN || '', // Webhook protection
  },
  
  // External APIs
  API: {
    HERE_KEY: process.env.HERE_API_KEY || '',
    OPENROUTER_KEY: process.env.OPENROUTER_API_KEY || '',
    WEATHER_KEY: process.env.WEATHER_API_KEY || '',
    ORS_KEY: process.env.ORS_API_KEY || '',
  }
};

if (!env.TELEGRAM.TOKEN) {
  console.warn('⚠️ Warning: TELEGRAM_BOT_TOKEN is missing in .env');
}
