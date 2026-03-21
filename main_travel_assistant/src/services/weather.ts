import { env } from '../config/env';
import { http } from '../utils/http';
import { cacheGet, cacheSet, TTL, makeCacheKey } from './cache';
import { isCircuitClosed, recordSuccess, recordFailure } from '../utils/circuitBreaker';
import { logger } from '../utils/logger';
import type { WeatherData, ForecastDay } from '../types';

const CB_NAME = 'weather';
const BASE = 'https://api.openweathermap.org/data/2.5';

// ── helpers ──

/** OpenWeatherMap wind speed is m/s → convert to km/h */
function msToKph(ms: number): number {
  return Math.round(ms * 3.6 * 10) / 10;
}

function mapCondition(weather: any[]): string {
  if (!weather || weather.length === 0) return '';
  return weather[0].description || weather[0].main || '';
}

function mapIcon(weather: any[]): string | undefined {
  if (!weather || weather.length === 0) return undefined;
  const code = weather[0].icon;
  return code ? `https://openweathermap.org/img/wn/${code}@2x.png` : undefined;
}

/**
 * Convert UNIX timestamp (UTC) to local date string "YYYY-MM-DD" using city timezone.
 *
 * OWM returns: dt (UNIX UTC seconds), city.timezone (offset in seconds, e.g. 25200 for +7)
 * MUST add timezone offset before extracting date — otherwise VN dates shift by 1 day.
 *
 * Example: dt=1709701200 (UTC 2024-03-06 03:00) + tz=25200 → local 2024-03-06 10:00 → "2024-03-06"
 *          dt=1709676000 (UTC 2024-03-05 21:00) + tz=25200 → local 2024-03-06 04:00 → "2024-03-06"
 *          Without tz: "2024-03-05" ← WRONG for Vietnam
 */
function dtToLocalDate(dt: number, timezoneOffset: number): string {
  const localMs = (dt + timezoneOffset) * 1000;
  const d = new Date(localMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Get today's date string in a given timezone offset.
 */
function todayLocal(timezoneOffset: number): string {
  const nowUtcSec = Math.floor(Date.now() / 1000);
  return dtToLocalDate(nowUtcSec, timezoneOffset);
}

// ────────────────────────────────────────────────
// Current Weather
// ────────────────────────────────────────────────

/**
 * Get current weather for a lat/lng coordinate via OpenWeatherMap.
 * Endpoint: GET /data/2.5/weather
 */
export async function getWeather(lat: number, lng: number): Promise<WeatherData | null> {
  if (!env.API.WEATHER_KEY) return null;

  const cacheKey = makeCacheKey('weather', `${lat.toFixed(2)},${lng.toFixed(2)}`);
  const cached = cacheGet<WeatherData>(cacheKey);
  if (cached) return cached;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn('[Weather] Circuit OPEN — skipping');
    return null;
  }

  try {
    const res = await http.get(`${BASE}/weather`, {
      params: {
        lat,
        lon: lng,
        appid: env.API.WEATHER_KEY,
        units: 'metric',
        lang: 'vi',
      },
      timeout: 5000,
    });

    const d = res.data;
    if (!d || !d.main) return null;

    const result: WeatherData = {
      temp_c: d.main.temp,
      condition: mapCondition(d.weather),
      humidity: d.main.humidity,
      wind_kph: msToKph(d.wind?.speed ?? 0),
      feelslike_c: d.main.feels_like,
      icon: mapIcon(d.weather),
    };

    cacheSet(cacheKey, result, TTL.WEATHER);
    recordSuccess(CB_NAME);
    logger.debug(`[Weather] OWM current: ${result.temp_c}°C "${result.condition}" for (${lat},${lng})`);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[Weather] OWM current API failed: ${err.message}`);
    return null;
  }
}

/**
 * Get current weather by place name (global fallback).
 * Uses deprecated `q` param — still works and useful when geocode misses.
 */
export async function getWeatherByName(placeName: string): Promise<WeatherData | null> {
  if (!env.API.WEATHER_KEY || !placeName) return null;

  const cacheKey = makeCacheKey('weather_name', placeName);
  const cached = cacheGet<WeatherData>(cacheKey);
  if (cached) return cached;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn('[Weather] Circuit OPEN — skipping name query');
    return null;
  }

  try {
    const res = await http.get(`${BASE}/weather`, {
      params: {
        q: placeName,
        appid: env.API.WEATHER_KEY,
        units: 'metric',
        lang: 'vi',
      },
      timeout: 5000,
    });

    const d = res.data;
    if (!d || !d.main) return null;

    const result: WeatherData = {
      temp_c: d.main.temp,
      condition: mapCondition(d.weather),
      humidity: d.main.humidity,
      wind_kph: msToKph(d.wind?.speed ?? 0),
      feelslike_c: d.main.feels_like,
      icon: mapIcon(d.weather),
    };

    cacheSet(cacheKey, result, TTL.WEATHER);
    recordSuccess(CB_NAME);
    logger.debug(`[Weather] OWM name current: ${result.temp_c}°C "${result.condition}" for "${placeName}"`);
    return result;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[Weather] OWM name query failed for "${placeName}": ${err.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────
// Forecast (5-day / 3-hour → aggregated to daily)
// ────────────────────────────────────────────────

interface DayBucket {
  temps: number[];
  humidity: number[];
  pop: number[];
  conditions: Map<string, number>;
}

/**
 * Aggregate 3-hour forecast entries into daily summaries.
 *
 * CRITICAL: Groups by LOCAL date (dt + city.timezone), NOT UTC dt_txt.
 * Without timezone correction, VN dates shift by 1 day (UTC 21:00 Mar 5 = VN 04:00 Mar 6).
 *
 * @param list       OWM forecast list entries
 * @param tzOffset   city.timezone from OWM response (seconds, e.g. 25200 for +7)
 * @param maxDays    max number of daily summaries to return
 * @param startOffset  skip this many days from today (0=include today, 1=start tomorrow)
 */
function aggregateToDays(
  list: any[],
  tzOffset: number,
  maxDays: number,
  startOffset: number,
): ForecastDay[] {
  const dayMap = new Map<string, DayBucket>();

  for (const entry of list) {
    const date = dtToLocalDate(entry.dt, tzOffset);

    if (!dayMap.has(date)) {
      dayMap.set(date, {
        temps: [],
        humidity: [],
        pop: [],
        conditions: new Map(),
      });
    }

    const day = dayMap.get(date)!;
    day.temps.push(entry.main.temp);
    day.humidity.push(entry.main.humidity);
    day.pop.push(entry.pop ?? 0);

    const cond = mapCondition(entry.weather);
    if (cond) {
      day.conditions.set(cond, (day.conditions.get(cond) || 0) + 1);
    }
  }

  // Convert to sorted array of dates
  const sortedDates = [...dayMap.keys()].sort();

  // Determine today's local date to apply startOffset
  const todayStr = todayLocal(tzOffset);
  const todayIdx = sortedDates.indexOf(todayStr);

  // Calculate which index to start from
  // If today is found, skip startOffset days from today
  // If today not in list (API starts from next interval), offset=1 becomes 0 since today is already skipped
  let skipCount = startOffset;
  if (todayIdx < 0 && startOffset > 0) {
    // Today not in forecast data — API already starts from later today or tomorrow
    // Reduce offset by 1 since "today" is already implicitly skipped
    skipCount = Math.max(0, startOffset - 1);
  }

  logger.debug(
    `[Weather] aggregateToDays: ${sortedDates.length} unique dates [${sortedDates.join(',')}] ` +
    `today=${todayStr} todayIdx=${todayIdx} startOffset=${startOffset} skipCount=${skipCount} maxDays=${maxDays}`,
  );

  const result: ForecastDay[] = [];
  let skipped = 0;

  for (const date of sortedDates) {
    if (skipped < skipCount) {
      skipped++;
      continue;
    }
    if (result.length >= maxDays) break;

    const day = dayMap.get(date)!;

    // Dominant condition = most frequently occurring
    let dominant = '';
    let maxCount = 0;
    for (const [cond, count] of day.conditions) {
      if (count > maxCount) {
        maxCount = count;
        dominant = cond;
      }
    }

    const avgHumidity = Math.round(day.humidity.reduce((a, b) => a + b, 0) / day.humidity.length);
    const maxPop = Math.round(Math.max(...day.pop) * 100); // 0-1 → percentage

    result.push({
      date,
      maxtemp_c: Math.round(Math.max(...day.temps) * 10) / 10,
      mintemp_c: Math.round(Math.min(...day.temps) * 10) / 10,
      condition: dominant,
      humidity: avgHumidity,
      rain_chance: maxPop,
    });
  }

  return result;
}

/**
 * Get weather forecast for a lat/lng coordinate via OpenWeatherMap.
 *
 * Always fetches full 40 entries (5 days), then applies timezone-aware grouping
 * and startOffset to return the correct date range.
 *
 * @param startOffset  0=include today, 1=start from tomorrow, 2=start from day after tomorrow
 */
export async function getForecast(
  lat: number,
  lng: number,
  days: number,
  startOffset: number = 0,
): Promise<ForecastDay[] | null> {
  if (!env.API.WEATHER_KEY) return null;

  const forecastDays = Math.min(Math.max(days, 1), 5);

  const cacheKey = makeCacheKey('forecast', `${lat.toFixed(2)},${lng.toFixed(2)},d${forecastDays},o${startOffset}`);
  const cached = cacheGet<ForecastDay[]>(cacheKey);
  if (cached) return cached;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn('[Weather] Circuit OPEN — skipping forecast');
    return null;
  }

  try {
    // Always fetch max (40 entries = 5 days) to have full data for offset + grouping
    const res = await http.get(`${BASE}/forecast`, {
      params: {
        lat,
        lon: lng,
        appid: env.API.WEATHER_KEY,
        units: 'metric',
        lang: 'vi',
        cnt: 40,
      },
      timeout: 5000,
    });

    const data = res.data;
    const list = data?.list;
    if (!list || !Array.isArray(list) || list.length === 0) return null;

    // Use city.timezone for timezone-aware grouping (e.g. 25200 for VN +7)
    const tzOffset = data?.city?.timezone ?? 25200; // default to VN +7 if missing

    const result = aggregateToDays(list, tzOffset, forecastDays, startOffset);

    if (result.length > 0) {
      cacheSet(cacheKey, result, TTL.WEATHER);
      recordSuccess(CB_NAME);
      logger.debug(
        `[Weather] OWM forecast: ${result.length} days (offset=${startOffset}) for (${lat},${lng}) tz=${tzOffset} dates=[${result.map(r => r.date).join(',')}]`,
      );
    }
    return result.length > 0 ? result : null;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[Weather] OWM forecast API failed: ${err.message}`);
    return null;
  }
}

/**
 * Get weather forecast by place name (global fallback).
 * Uses deprecated `q` param. Aggregates 3h → daily with timezone-aware grouping.
 */
export async function getForecastByName(
  placeName: string,
  days: number,
  startOffset: number = 0,
): Promise<ForecastDay[] | null> {
  if (!env.API.WEATHER_KEY || !placeName) return null;

  const forecastDays = Math.min(Math.max(days, 1), 5);

  const cacheKey = makeCacheKey('forecast_name', `${placeName},d${forecastDays},o${startOffset}`);
  const cached = cacheGet<ForecastDay[]>(cacheKey);
  if (cached) return cached;

  if (!isCircuitClosed(CB_NAME)) {
    logger.warn('[Weather] Circuit OPEN — skipping forecast name query');
    return null;
  }

  try {
    const res = await http.get(`${BASE}/forecast`, {
      params: {
        q: placeName,
        appid: env.API.WEATHER_KEY,
        units: 'metric',
        lang: 'vi',
        cnt: 40,
      },
      timeout: 5000,
    });

    const data = res.data;
    const list = data?.list;
    if (!list || !Array.isArray(list) || list.length === 0) return null;

    const tzOffset = data?.city?.timezone ?? 25200;

    const result = aggregateToDays(list, tzOffset, forecastDays, startOffset);

    if (result.length > 0) {
      cacheSet(cacheKey, result, TTL.WEATHER);
      recordSuccess(CB_NAME);
      logger.debug(
        `[Weather] OWM forecast name: ${result.length} days (offset=${startOffset}) for "${placeName}" dates=[${result.map(r => r.date).join(',')}]`,
      );
    }
    return result.length > 0 ? result : null;
  } catch (err: any) {
    recordFailure(CB_NAME);
    logger.error(`[Weather] OWM forecast name query failed for "${placeName}": ${err.message}`);
    return null;
  }
}
