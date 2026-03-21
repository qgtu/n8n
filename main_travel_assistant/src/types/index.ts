// ── Express augmentation ──

declare global {
  namespace Express {
    interface Request {
      reqId?: string;
    }
  }
}

// ── All type definitions ──

export type IntentName =
  | 'GET_PLACE_INFO'
  | 'GET_OPENING_HOURS'
  | 'GET_TICKET_PRICE'
  | 'GET_WEATHER'
  | 'SEARCH_NEARBY'
  | 'GET_DIRECTIONS'
  | 'SEARCH_TOUR'
  | 'DISCOVER_LOCATION'
  | 'UNKNOWN';

export interface ClassifyResult {
  intent: IntentName;
  entity: string;
  slug?: string;               // resolved slug for DB lookups
  entity_origin?: string;      // DIRECTIONS: điểm đi
  entity_destination?: string; // DIRECTIONS: điểm đến
  _routeMode?: string;         // driving-car | cycling-regular | foot-walking
  _nearbyCategory?: string;    // NEARBY: detected category (e.g., "restaurant", "tourist attraction")
  _weatherMode?: 'current' | 'forecast'; // WEATHER: current or forecast
  _forecastDays?: number;      // WEATHER: number of forecast days
  _forecastOffset?: number;    // WEATHER: day offset (0=today, 1=tomorrow, 2=ngày mốt)
  duration_days?: number;      // TOUR: số ngày
  confidence: number;          // 0–1
  source: 'rule' | 'llm' | 'context' | 'graph';
}

// ── Platform-agnostic message contracts ──

export interface InternalMessage {
  platform: 'telegram' | 'web' | 'facebook' | 'api';
  userId: string;
  sessionId: string;
  chatId: string;
  text: string;
  timestamp: number;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface InternalResponse {
  type: 'text' | 'error' | 'clarify' | 'not_found' | 'temp_error';
  message: string;
  data?: any;
}

// ── Handler function signature ──

export type HandlerFn = (
  message: InternalMessage,
  ctx: ClassifyResult,
) => Promise<InternalResponse>;

// ── Domain types ──

export interface PlaceTicket {
  id: number;
  name: string;
  slug: string;
  price_adult: number;
  price_child: number;
  currency: string;
  description?: string;
}

export interface PlaceInfo {
  name: string;
  slug?: string;
  description?: string;
  address?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  image_url?: string;
  map_url?: string;
  rating?: number;
}

export interface OpenHour {
  day_of_week: number;
  open_time: string;
  close_time: string;
  note?: string;
  place_name?: string;
}

export interface WeatherData {
  temp_c: number;
  condition: string;
  humidity: number;
  wind_kph: number;
  feelslike_c: number;
  icon?: string;
}

export interface ForecastDay {
  date: string;           // "2026-03-06"
  maxtemp_c: number;
  mintemp_c: number;
  condition: string;
  humidity: number;
  rain_chance: number;    // percentage
}

export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
  confidence?: number;  // 0–1, only present on geocodeGlobal results
  ambiguous?: boolean;  // true = multiple high-score candidates (ask for disambiguation)
  isCountry?: boolean;  // true = result is a country (ask for city)
}

export interface DiscoverResult {
  name: string;
  address?: string;
  distance?: number;
  lat?: number;
  lng?: number;
  category?: string;
  openingHours?: string[];
}

export interface TourInfo {
  name: string;
  duration_days: number;
  price?: number;
  description?: string;
  destinations: string[];
}

export interface DirectionsData {
  distance_km: number;
  duration_minutes: number;
  mode: string;
  origin_label: string;
  destination_label: string;
}

export interface BotSession {
  session_id: string;
  context_data: {
    last_intent?: string;
    last_entity?: string;
    last_slug?: string;
    last_geo?: { lat: number; lng: number; label: string }; // last known location
    turn_count: number;
    awaiting_entity?: boolean;          // V3: multi-turn waiting for entity (kept for compat)
    awaiting_intent?: string;           // V3: the intent that needs an entity
    clarify_count?: number;             // number of clarify rounds (max 3)
    last_interaction?: number;          // timestamp ms for session TTL
    // V4 generic multi-turn slot filling
    pending_intent?: string;            // intent being slot-filled
    filled_slots?: Record<string, any>; // gathered slot values so far
    awaiting_slot?: string;             // current slot we're asking for
    [key: string]: any;
  };
}
