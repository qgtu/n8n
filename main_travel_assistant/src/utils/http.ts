import axios from 'axios';
import { logger } from './logger';

/**
 * Pre-configured axios instance.
 * Timeout: 3s. Auto-retry once on 5xx / network error.
 */
export const http = axios.create({
  timeout: 3000,
  headers: { 'User-Agent': 'TravelBot/1.0' },
});

http.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  if (!config || (config as any).__retried) throw error;

  const status = error.response?.status;
  // Only retry on 5xx or network errors, never 4xx
  if (status && status < 500 && status !== 429) throw error;

  (config as any).__retried = true;
  logger.warn(`[HTTP] Retry ${config.method?.toUpperCase()} ${config.url}`);
  await new Promise((r) => setTimeout(r, 500));
  return http.request(config);
});
