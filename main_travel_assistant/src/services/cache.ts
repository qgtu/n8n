import { logger } from '../utils/logger';

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}, 5 * 60_000).unref();

export function cacheGet<T = any>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: any, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Build a normalized cache key.
 * Strips diacritics, lowercases, replaces spaces with hyphens.
 * E.g. makeCacheKey('place', 'Tràng An') → 'place:trang-an'
 */
export function makeCacheKey(prefix: string, ...parts: string[]): string {
  return (
    prefix +
    ':' +
    parts
      .map((p) =>
        p
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/Đ/g, 'D')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\-.,→]/g, ''),
      )
      .join(':')
  );
}

/** Cache stats for observability */
export function cacheStats(): { size: number; entries: string[] } {
  return { size: store.size, entries: [...store.keys()] };
}

/** TTL constants (seconds) */
export const TTL = {
  WEATHER: 10 * 60,
  NEARBY: 30 * 60,
  DIRECTIONS: 15 * 60,
  PLACE_INFO: 24 * 3600,
  OPENING_HOURS: 24 * 3600,
  TICKET_PRICE: 24 * 3600,
  TOUR: 24 * 3600,
  GEOCODE: 24 * 3600,
} as const;
