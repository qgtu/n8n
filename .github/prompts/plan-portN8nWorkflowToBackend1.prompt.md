# Plan: Port n8n Workflow Logic → Node.js Backend

## Goal

Tách toàn bộ logic từ `rule_first_travel_bot.json` (n8n workflow) sang `main_travel_assistant/` (Node.js TypeScript backend). Kết quả: backend xử lý 7 intents + FALLBACK, production-grade, không phụ thuộc n8n.

## Architecture Decisions (User-confirmed)

| Decision | Choice |
|----------|--------|
| LLM Fallback | **Port luôn** — OpenRouter Gemini 2.0 Flash |
| HERE API Fallback | **Port luôn** — DB → HERE Discover chain |
| LLM Response Composer | **Skip** — dùng template text |

---

## Phase 0 — Fix Bugs + Infrastructure (4 files)

### Step 0.1: Fix `normalizeForEntity()` — `src/shared/normalize.ts`

**Bug**: `normalizeForEntity("giá vé đền thái vi")` returns `"giá vé đền thái vi"` instead of `"đền thái vi"`. Regex doesn't handle NFC-normalized Vietnamese.

**Fix**: Align with n8n's `Fn_PrepTicketPrice` comprehensive filler stripping — strip all intent keywords (giá vé, vé vào cửa, giờ mở cửa, thời tiết, tìm, gần đây, chỉ đường, từ, đến, tour, etc.) BEFORE returning entity.

### Step 0.2: Extend `ClassifyResult` type — `src/shared/types.ts`

Add:
```ts
interface ClassifyResult {
  intent: string;
  entity: string;           // primary entity (place name)
  entity_origin?: string;   // for DIRECTIONS: điểm đi
  entity_destination?: string; // for DIRECTIONS: điểm đến
  _routeMode?: string;      // driving-car | cycling-regular | foot-walking
  duration_days?: number;   // for TOUR: số ngày
}
```

Update `HandlerFn` signature:
```ts
type HandlerFn = (message: InternalMessage, ctx: ClassifyResult) => Promise<InternalResponse>;
```

### Step 0.3: Extend `classifyIntent()` — `src/intent/classifier.ts`

- Return full `ClassifyResult` instead of `{ intent, entity }`
- Parse `từ X đến Y` pattern for DIRECTIONS → extract `entity_origin`, `entity_destination`
- Parse `\d+ ngày` for TOUR → extract `duration_days`
- Detect route mode keywords: xe máy/ô tô → driving-car, xe đạp → cycling-regular, đi bộ → foot-walking

### Step 0.4: Add validate-context gate — `src/handleMessage.ts`

Per-intent required field checking before routing:
- `GET_PLACE_INFO` → needs `entity`
- `GET_OPENING_HOURS` → needs `entity`
- `GET_TICKET_PRICE` → needs `entity`
- `GET_WEATHER` → needs `entity`
- `SEARCH_NEARBY` → needs `entity`
- `GET_DIRECTIONS` → needs `entity_origin` + `entity_destination`
- `SEARCH_TOUR` → needs `entity` or `duration_days`

If missing → prompt user for clarification instead of crashing.

---

## Phase 1 — LLM Fallback (2 files)

### Step 1.1: Create `src/intent/llmClassifier.ts`

- Call OpenRouter (`google/gemini-2.0-flash-001`)
- System prompt: "Bạn là travel assistant cho Ninh Bình. Phân loại intent và trích xuất entity."
- Return same `ClassifyResult` format
- Timeout: 8s, temperature: 0.1 (deterministic)
- Fallback to UNKNOWN if LLM fails

### Step 1.2: Update orchestrator — `src/handleMessage.ts`

Flow change:
```
classifyIntent(text)
  → if intent === UNKNOWN → llmClassify(text)
    → if still UNKNOWN → fallbackHandler()
  → validateContext(result)
  → route(result)
```

---

## Phase 2 — Shared Utilities (2 files)

### Step 2.1: Create `src/services/geocode.ts`

HERE Geocode API wrapper:
```ts
async function geocode(placeName: string): Promise<{ lat: number; lng: number; label: string } | null>
```
- URL: `https://geocode.search.hereapi.com/v1/geocode`
- Params: `q=${placeName}, Ninh Bình, Vietnam`, `apiKey`, `limit=1`
- Cache results in-memory (simple Map with TTL)

### Step 2.2: Create `src/services/hereDiscover.ts`

HERE Discover API wrapper:
```ts
async function discoverNearby(lat: number, lng: number, category: string, radius?: number): Promise<DiscoverResult[]>
```
- URL: `https://discover.search.hereapi.com/v1/discover`
- Params: `at=${lat},${lng}`, `q=${category}`, `limit=10`, `apiKey`
- Used by SEARCH_NEARBY handler as HERE fallback

---

## Phase 3 — Port 6 Handlers (6 new files)

### Step 3.1: `src/handlers/placeInfo.handler.ts` — GET_PLACE_INFO

SQL flow (from n8n):
```sql
SELECT p.name, p.description, p.address, p.category, p.latitude, p.longitude,
       p.image_url, p.map_url, p.rating
FROM places p
LEFT JOIN location_aliases la ON la.canonical_name = p.slug
WHERE p.slug = $1 OR la.alias = $1
LIMIT 1;
```
Fallback: HERE Discover if DB miss.

### Step 3.2: `src/handlers/openHours.handler.ts` — GET_OPENING_HOURS

SQL flow:
```sql
SELECT p.name, oh.day_of_week, oh.open_time, oh.close_time, oh.note
FROM opening_hours oh
JOIN places p ON p.id = oh.place_id
LEFT JOIN location_aliases la ON la.canonical_name = p.slug
WHERE p.slug = $1 OR la.alias = $1
ORDER BY oh.day_of_week;
```

### Step 3.3: `src/handlers/weather.handler.ts` — GET_WEATHER

Flow: geocode(entity) → WeatherAPI call
```
GET https://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${lat},${lng}&lang=vi
```
Format: temp_c, condition, humidity, wind_kph, feelslike_c

### Step 3.4: `src/handlers/nearby.handler.ts` — SEARCH_NEARBY

Flow: geocode(entity) → HERE Discover (category from entity) → format results
- Category mapping: quán ăn → restaurant, khách sạn → hotel, ATM → atm, etc.
- Return top 5 results with name, address, distance

### Step 3.5: `src/handlers/directions.handler.ts` — GET_DIRECTIONS

Flow:
1. geocode(entity_origin) → `{lat1, lng1}`
2. geocode(entity_destination) → `{lat2, lng2}`
3. ORS Route API call:
```
GET https://api.openrouteservice.org/v2/directions/${_routeMode}?api_key=${ORS_API_KEY}&start=${lng1},${lat1}&end=${lng2},${lat2}
```
4. Extract: distance_km, duration_minutes
5. Format response

### Step 3.6: `src/handlers/tour.handler.ts` — SEARCH_TOUR

SQL flow:
```sql
SELECT t.name, t.duration_days, t.price, t.description,
       array_agg(p.name) as destinations
FROM tours t
JOIN tour_destinations td ON td.tour_id = t.id
JOIN places p ON p.id = td.place_id
WHERE ($1::int IS NULL OR t.duration_days = $1)
  AND ($2::text IS NULL OR p.slug = $2 OR EXISTS (
    SELECT 1 FROM location_aliases la WHERE la.canonical_name = p.slug AND la.alias = $2
  ))
GROUP BY t.id
ORDER BY t.price ASC
LIMIT 5;
```

---

## Phase 4 — Wire Everything (3 files)

### Step 4.1: Register all handlers — `src/app.ts`

```ts
registerHandler('GET_PLACE_INFO', placeInfoHandler);
registerHandler('GET_OPENING_HOURS', openHoursHandler);
registerHandler('GET_TICKET_PRICE', ticketPriceHandler);
registerHandler('GET_WEATHER', weatherHandler);
registerHandler('SEARCH_NEARBY', nearbyHandler);
registerHandler('GET_DIRECTIONS', directionsHandler);
registerHandler('SEARCH_TOUR', tourHandler);
registerHandler('UNKNOWN', fallbackHandler);
```

### Step 4.2: Update orchestrator flow — `src/handleMessage.ts`

Full flow:
```
1. idempotency check
2. loadSession
3. classifyIntent(text)
4. if UNKNOWN → llmClassify(text)
5. if still UNKNOWN → fallback
6. validateContext(result, session)
7. resolveAlias(result.entity) → update result
8. route(result.intent, message, result)
9. logSearch(chatId, text, result)
10. updateSession(chatId, result)
```

### Step 4.3: Fix ticketPrice handler — `src/handlers/ticketPrice.handler.ts`

- Update signature to accept `ClassifyResult`
- Add HERE Discover fallback when DB returns no results
- Entity now comes pre-cleaned from normalizeForEntity

---

## Phase 5 — Search Logging (1 file)

### Step 5.1: Create `src/services/searchLog.ts`

```ts
async function logSearch(chatId: number, rawText: string, result: ClassifyResult): Promise<void>
```
```sql
INSERT INTO search_logs (chat_id, raw_text, intent, entity, resolved_slug, created_at)
VALUES ($1, $2, $3, $4, $5, NOW());
```

---

## File Summary

| # | File | Action |
|---|------|--------|
| 1 | `src/shared/normalize.ts` | EDIT — fix normalizeForEntity |
| 2 | `src/shared/types.ts` | EDIT — add ClassifyResult, update HandlerFn |
| 3 | `src/intent/classifier.ts` | EDIT — return ClassifyResult |
| 4 | `src/handleMessage.ts` | EDIT — validate-context gate + full flow |
| 5 | `src/intent/llmClassifier.ts` | CREATE — OpenRouter LLM fallback |
| 6 | `src/services/geocode.ts` | CREATE — HERE Geocode wrapper |
| 7 | `src/services/hereDiscover.ts` | CREATE — HERE Discover wrapper |
| 8 | `src/handlers/placeInfo.handler.ts` | CREATE |
| 9 | `src/handlers/openHours.handler.ts` | CREATE |
| 10 | `src/handlers/weather.handler.ts` | CREATE |
| 11 | `src/handlers/nearby.handler.ts` | CREATE |
| 12 | `src/handlers/directions.handler.ts` | CREATE |
| 13 | `src/handlers/tour.handler.ts` | CREATE |
| 14 | `src/app.ts` | EDIT — register all handlers |
| 15 | `src/handlers/ticketPrice.handler.ts` | EDIT — new signature + HERE fallback |
| 16 | `src/intent/router.ts` | EDIT — updated route signature |
| 17 | `src/services/searchLog.ts` | CREATE |

**Total: 17 files (7 CREATE + 10 EDIT)**

---

## Execution Order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
  (fix)    (LLM)    (utils)   (handlers)  (wire)    (logging)
```

Each phase is testable independently. After Phase 0, the existing ticketPrice handler should work correctly. After Phase 4, all 7 intents + fallback are live.
