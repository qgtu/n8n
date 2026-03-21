/**
 * Slot Extractor — Structured NLU layer that separates entity from modifier phrases.
 *
 * Currently handles:
 * - Weather: splits "huế tuần sau" → location="huế", time="tuần sau", mode=forecast
 *
 * Design: regex-based extraction (fast, deterministic), runs BEFORE resolveLocation.
 * Lives in /core because it's orchestration logic, not a utility.
 */

// ── Vietnamese time expressions (ordered longest-first for greedy match) ──
//
// startOffset controls which day to START from:
//   0 = include today   (hôm nay, dự báo)
//   1 = skip today      (ngày mai, 3 ngày tới, tuần sau)
//   2 = skip today+tomorrow (ngày mốt)
const TIME_PATTERNS: { pattern: RegExp; days: number; startOffset: number; label: string }[] = [
  // Multi-day ranges — always start from tomorrow
  { pattern: /(\d+)\s*ngày\s*tới/i,        days: 0, startOffset: 1, label: 'n_days' },  // "3 ngày tới" → days from capture
  { pattern: /(\d+)\s*ngày\s*nữa/i,        days: 0, startOffset: 1, label: 'n_days' },
  { pattern: /tuần\s*sau/i,                 days: 5, startOffset: 1, label: 'tuần sau' },   // OWM free max 5 days
  { pattern: /tuần\s*này/i,                 days: 5, startOffset: 0, label: 'tuần này' },
  { pattern: /tuần\s*tới/i,                 days: 5, startOffset: 1, label: 'tuần tới' },
  { pattern: /cuối\s*tuần\s*sau/i,          days: 3, startOffset: 1, label: 'cuối tuần sau' },
  { pattern: /cuối\s*tuần(\s*này)?/i,       days: 3, startOffset: 0, label: 'cuối tuần' },
  // Single-day
  { pattern: /ngày\s*mai/i,                 days: 1, startOffset: 1, label: 'ngày mai' },
  { pattern: /ngày\s*mốt|ngày\s*kia/i,     days: 1, startOffset: 2, label: 'ngày mốt' },
  { pattern: /hôm\s*nay/i,                  days: 1, startOffset: 0, label: 'hôm nay' },
  { pattern: /bây\s*giờ|hiện\s*tại|lúc\s*này/i, days: 0, startOffset: 0, label: 'current' },
  // Forecast keyword — include today
  { pattern: /dự\s*báo/i,                   days: 3, startOffset: 0, label: 'dự báo' },
];

export type WeatherMode = 'current' | 'forecast';

export interface WeatherSlots {
  /** Clean location phrase (time expression removed) */
  location: string;
  /** Extracted time phrase (e.g. "tuần sau") or null */
  timePrase: string | null;
  /** Number of forecast days to return (0 = current) */
  forecastDays: number;
  /** Day offset: 0 = include today, 1 = start from tomorrow, 2 = start from day after tomorrow */
  startOffset: number;
  /** Whether to call forecast API or current API */
  mode: WeatherMode;
}

/**
 * Extract weather-specific slots from entity text.
 *
 * Input:  "huế ngày mai"
 * Output: { location: "huế", forecastDays: 1, startOffset: 1, mode: "forecast" }
 *
 * Input:  "huế hôm nay"
 * Output: { location: "huế", forecastDays: 1, startOffset: 0, mode: "forecast" }
 *
 * Input:  "đà nẵng"
 * Output: { location: "đà nẵng", forecastDays: 0, startOffset: 0, mode: "current" }
 */
export function extractWeatherSlots(entityRaw: string): WeatherSlots {
  if (!entityRaw) {
    return { location: '', timePrase: null, forecastDays: 0, startOffset: 0, mode: 'current' };
  }

  let text = entityRaw.trim();
  let matchedTime: string | null = null;
  let forecastDays = 0;
  let startOffset = 0;

  for (const tp of TIME_PATTERNS) {
    const m = tp.pattern.exec(text);
    if (m) {
      matchedTime = m[0];
      startOffset = tp.startOffset;
      // "N ngày tới" — extract N from capture group
      if (tp.days === 0 && tp.label === 'n_days' && m[1]) {
        forecastDays = Math.min(parseInt(m[1], 10), 5); // OWM free tier max 5 days
      } else {
        forecastDays = tp.days;
      }
      // Remove time expression from entity text
      text = text.replace(m[0], '').trim();
      break; // first match wins (patterns are ordered longest-first)
    }
  }

  // Strip leading/trailing filler prepositions left behind ("ở", "tại", "trong")
  text = text.replace(/^(ở|tại|trong|vào)\s+/i, '').replace(/\s+(ở|tại|trong|vào)$/i, '').trim();

  const mode: WeatherMode = forecastDays > 0 ? 'forecast' : 'current';

  return {
    location: text,
    timePrase: matchedTime,
    forecastDays,
    startOffset,
    mode,
  };
}
