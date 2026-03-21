import { resolveLocation } from '../services/locationResolver';
import { getWeather, getWeatherByName, getForecast, getForecastByName } from '../services/weather';
import { buildFallback } from '../core/fallbackEngine';
import { escapeHtml } from '../utils/normalize';
import { logger } from '../utils/logger';
import type { InternalMessage, InternalResponse, ClassifyResult, WeatherData, ForecastDay } from '../types';

/**
 * GET_WEATHER handler.
 * Routes between current weather and forecast based on ctx._weatherMode.
 *
 * Flow: resolveLocation → (forecast|current) API(lat/lng) → name fallback → fallbackEngine.
 */
export async function handleWeather(
  _message: InternalMessage,
  ctx: ClassifyResult,
): Promise<InternalResponse> {
  try {
    const mode = ctx._weatherMode || 'current';
    const forecastDays = ctx._forecastDays || 3;
    const startOffset = ctx._forecastOffset ?? 0;
    logger.debug(`[Weather] ▶ entity="${ctx.entity}" mode=${mode} days=${forecastDays} offset=${startOffset}`);

    const loc = await resolveLocation(ctx.entity);
    logger.debug(`[Weather]   resolveLocation → ${loc ? `source=${loc.source} confidence=${loc.confidence.toFixed(2)} ambiguous=${loc.ambiguous} label="${loc.name}"` : 'null'}`);

    // Ambiguous location: ask user to be more specific
    if (loc?.ambiguous) {
      return buildFallback('AMBIGUOUS_ENTITY', ctx.intent, ctx.entity);
    }
    // Country-level: too vague for weather, ask for a city
    if (loc?.isCountry) {
      return buildFallback('COUNTRY_LEVEL_ENTITY', ctx.intent, ctx.entity);
    }

    // ── Forecast mode ──
    if (mode === 'forecast') {
      logger.debug(`[Weather]   FORECAST path: loc=${loc ? 'resolved' : 'null'} entity="${ctx.entity}" days=${forecastDays} offset=${startOffset}`);
      if (loc) {
        const forecast = await getForecast(loc.lat, loc.lng, forecastDays, startOffset);
        logger.debug(`[Weather]   getForecast(${loc.lat},${loc.lng},${forecastDays},offset=${startOffset}) → ${forecast ? `${forecast.length} days [${forecast.map(f => f.date).join(',')}]` : 'null'}`);
        if (forecast && forecast.length > 0) return formatForecast(loc.name, forecast);
      }
      // Fallback: name-based forecast
      const forecastByName = await getForecastByName(ctx.entity, forecastDays, startOffset);
      logger.debug(`[Weather]   getForecastByName("${ctx.entity}",offset=${startOffset}) → ${forecastByName ? `${forecastByName.length} days` : 'null'}`);
      if (forecastByName && forecastByName.length > 0) return formatForecast(ctx.entity, forecastByName);

      // Forecast explicitly requested but unavailable — tell user, don't silently degrade
      logger.warn(`[Weather] Forecast unavailable for "${ctx.entity}" — NOT falling back to current`);
      return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
    }

    // ── Current mode (or forecast fallthrough) ──
    if (loc) {
      const weather = await getWeather(loc.lat, loc.lng);
      logger.debug(`[Weather]   OWM(lat/lng) → ${weather ? `${weather.temp_c}°C ${weather.condition}` : 'null'}`);
      if (weather) return formatWeather(loc.name, weather);
    }

    // Fallback: OWM name-based (supports cities globally when geocode misses)
    logger.debug(`[Weather]   falling back to name-based query: "${ctx.entity}"`);
    const weatherByName = await getWeatherByName(ctx.entity);
    logger.debug(`[Weather]   getWeatherByName → ${weatherByName ? `${weatherByName.temp_c}°C ${weatherByName.condition}` : 'null'}`);

    if (weatherByName) return formatWeather(ctx.entity, weatherByName);

    logger.debug(`[Weather]   ✗ no result for "${ctx.entity}"`);
    return buildFallback('ENTITY_NOT_FOUND', ctx.intent, ctx.entity);
  } catch (err: any) {
    logger.error(`[Weather] Error: ${err.message}`);
    return buildFallback('API_UNAVAILABLE', ctx.intent, ctx.entity);
  }
}

// ── Vietnamese day name mapping ──
const DAY_NAMES: Record<string, string> = {
  'Mon': 'Thứ 2', 'Tue': 'Thứ 3', 'Wed': 'Thứ 4',
  'Thu': 'Thứ 5', 'Fri': 'Thứ 6', 'Sat': 'Thứ 7', 'Sun': 'CN',
};

function formatDateVi(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const dayEn = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayVi = DAY_NAMES[dayEn] || dayEn;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dayVi} ${dd}/${mm}`;
  } catch {
    return dateStr;
  }
}

function formatForecast(locationLabel: string, days: ForecastDay[]): InternalResponse {
  let msg = `📅 <b>Dự báo thời tiết ${escapeHtml(locationLabel)}</b>\n\n`;

  for (const d of days) {
    const dateLabel = formatDateVi(d.date);
    msg += `<b>${dateLabel}</b>: ${d.mintemp_c}°C – ${d.maxtemp_c}°C\n`;
    msg += `  ☁️ ${escapeHtml(d.condition)}`;
    if (d.rain_chance > 0) msg += ` | 🌧 ${d.rain_chance}%`;
    msg += ` | 💧 ${d.humidity}%\n`;
  }

  return { type: 'text', message: msg, data: { forecast: days } };
}

function formatWeather(locationLabel: string, weather: WeatherData): InternalResponse {
  const msg =
    `🌤 <b>Thời tiết ${escapeHtml(locationLabel)}</b>\n\n` +
    `🌡 Nhiệt độ: ${weather.temp_c}°C\n` +
    `🤔 Cảm giác: ${weather.feelslike_c}°C\n` +
    `☁️ ${escapeHtml(weather.condition)}\n` +
    `💧 Độ ẩm: ${weather.humidity}%\n` +
    `💨 Gió: ${weather.wind_kph} km/h`;

  return { type: 'text', message: msg, data: weather };
}
