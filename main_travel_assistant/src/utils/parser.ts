/**
 * Specialized parsers for multi-entity intents.
 */

export interface DirectionsParsed {
  entity_origin: string;
  entity_destination: string;
  _routeMode: string;
}

export interface TourParsed {
  duration_days?: number;
  entity?: string;
}

/**
 * Parse "từ X đến Y" pattern for DIRECTIONS.
 */
export function parseDirections(text: string): DirectionsParsed | null {
  const normalized = text.normalize('NFC').toLowerCase();

  // Pattern: từ X đến/tới Y
  const match = normalized.match(
    /từ\s+(.+?)\s+(?:đến|tới|den|toi)\s+(.+)/,
  );
  if (!match || !match[1] || !match[2]) return null;

  const origin = cleanDirectionEntity(match[1].trim());
  // Strip trailing transport words from destination
  let destination = match[2].trim();
  destination = destination
    .replace(/\s*(?:bằng|đi|bằng xe|xe máy|ô tô|xe đạp|đi bộ).*$/, '')
    .trim();
  // Strip distance-query noise trailing destination
  destination = destination
    .replace(/\s*(?:là\s+)?(?:bao xa|khoảng cách|khoang cach|bao nhiêu km|mấy km|may km)[\s?]*$/gi, '')
    .trim();
  // Strip leftover trailing filler words
  destination = destination
    .replace(/\s+(?:là|la|thì|thi|có|co|được|duoc|không|khong)$/gi, '')
    .trim();
  destination = cleanDirectionEntity(destination);

  return {
    entity_origin: origin,
    entity_destination: destination,
    _routeMode: parseRouteMode(text),
  };
}

/**
 * Detect route mode from text.
 */
export function parseRouteMode(text: string): string {
  const t = text.normalize('NFC').toLowerCase();
  if (/xe đạp|xe dap|cycling|đạp xe|dap xe/.test(t)) return 'cycling-regular';
  if (/đi bộ|di bo|walk|cuốc bộ|cuoc bo/.test(t)) return 'foot-walking';
  // Default: driving (covers ô tô, xe máy, or unspecified)
  return 'driving-car';
}

/**
 * Parse tour params: duration + optional location.
 *
 * Supports:
 *   "tour 5 ngày" → 5
 *   "tour 2 ngày 1 đêm" → 2
 *   "tour 3N2Đ" or "3n2d" → 3
 *   "2n1đ ninh bình" → 2
 */
export function parseTour(text: string): TourParsed {
  const normalized = text.normalize('NFC').toLowerCase();

  let duration_days: number | undefined;

  // Pattern 1: "3N2Đ", "3n2d", "3n2đ"
  const shortMatch = normalized.match(/(\d+)\s*n\s*\d*\s*[dđ]/);
  if (shortMatch && shortMatch[1]) {
    duration_days = parseInt(shortMatch[1], 10);
  }

  // Pattern 2: "2 ngày 1 đêm", "5 ngày"
  if (!duration_days) {
    const longMatch = normalized.match(/(\d+)\s*(?:ngày|ngay|days?)/);
    if (longMatch && longMatch[1]) {
      duration_days = parseInt(longMatch[1], 10);
    }
  }

  // Entity: strip tour keywords + duration patterns
  let entity = normalized
    .replace(/\btour\b/gi, '')
    .replace(/lịch trình|lich trinh|hành trình|hanh trinh|chuyến đi|chuyen di|du lịch|du lich/gi, '')
    .replace(/\d+\s*n\s*\d*\s*[dđ]/gi, '')         // "3n2đ"
    .replace(/\d+\s*(?:ngày|ngay|days?)/gi, '')      // "5 ngày"
    .replace(/\d+\s*(?:đêm|dem|nights?)/gi, '')      // "1 đêm"
    .replace(/\b(?:tìm|xem|cho|tôi|mình)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { duration_days, entity: entity || undefined };
}

/**
 * Extract nearby count from text: "3 điểm gần đây" → 3.
 */
export function parseNearbyCount(text: string): number {
  const match = text.match(/(\d+)\s*(?:điểm|chỗ|nơi|place)/);
  return match && match[1] ? Math.min(parseInt(match[1], 10), 10) : 5;
}

/** Strip conversational filler from direction origin/destination */
function cleanDirectionEntity(text: string): string {
  return text
    .replace(/\b(?:bạn ơi|ban oi|giúp mình|giup minh|giúp tôi|giup toi|cho mình|cho minh|cho tôi|cho toi|ơi|oi|nhé|nhe|nhá|nha|ạ|nè|ne|luôn|luon)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
