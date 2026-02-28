# Full Architecture Rebuild — Rule-First Travel Bot

**TL;DR**: Replace the current LLM-first, SerpAPI-enriched, flat-schema production_travel_bot.json with a rule-first intent detection architecture, normalized 8-table DB schema, and standardized `{success, type, data, message}` response format. SerpAPI removed entirely. DB-primary for place data. HERE for geocoding fallback only. ORS for routing. 8 intents (adding GET_TICKET_PRICE + FALLBACK). All Code nodes use correct typeVersion 2 mode rules. ~50 nodes total. Production-hardened with 38 audit fixes (14 architecture + 10 edge case + 8 deep review + 6 production stress-test) incorporated.

---

## Decisions (Confirmed)

- DB-primary for place details, HERE for geocoding fallback only
- DB PostGIS distance calc for nearby (no HERE Discover)
- ORS primary for routing, HERE geocoding for unresolved coordinates
- GET_PLACE_INFO includes ticket price in response
- SerpAPI removed entirely — no fallback web search
- Rule-first regex before LLM — LLM only when regex fails
- Response format standardized to `{success, type, data, message}` everywhere

---

## Production Hardening — Audit Fixes (14 + 10 + 8 + 6 Points)

All audit findings from the production architecture review are incorporated into the plan below. Summary of critical fixes:

| # | Issue | Severity | Fix Applied In |
|---|-------|----------|----------------|
| A1 | `_startTime` unreliable in retry/queue | Medium | Node 2, Node 43 — latency computed at final node from webhook timestamp |
| A2 | Regex `/từ.*đến/` greedy — matches incomplete directions | High | Node 5 — strict regex `/từ\s+.+\s+đến\s+.+/` |
| A3 | SEARCH_NEARBY no slug existence check → CTE fails | High | Node 27 — checks ref place exists before DB query |
| A4 | DB_LookupPlace duplicate rows from multi-join | High | Node 11 — subquery pattern for hours, separate ticket join |
| A5 | Euclidean distance formula inaccurate >50km | Low | Node 28 — accepted with documented risk, PostGIS upgrade path noted |
| A6 | ORS Matrix API wrong for 2-point routing | Medium | Node 36 — switched to `/v2/directions/driving-car` |
| A7 | HERE geocode `items[0]` crash on empty response | High | Node 24, 35 — defensive `items?.length` guard |
| A8 | GET_TICKET_PRICE 0-row returns undefined | Medium | Node 18 — explicit `{success: false, type: "not_found"}` |
| A9 | LLM timeout kills entire response | Critical | Node 43 — service `.message` used as LLM-independent fallback |
| A10 | Cross-branch candidate loop may pick wrong branch | Medium | Node 43 — type-based selection via `$json.type`, no name iteration |
| A11 | SEARCH_TOUR `{{duration_filter}}` SQL injection | High | Node 39 — parameterized `WHERE t.duration_days = $1` |
| A12 | No global error catch → raw 500 | High | NEW Node 46 — Error Trigger → Respond_SystemError |
| A13 | LLM returns `entity: null` → DB query fails | High | Node 8 — `if (!entity) intent = 'FALLBACK'` |
| A14 | FALLBACK `success: false` misleads UI | Low | Node 41 — changed to `{success: true, type: "help"}` |
| D1 | Intent correct but required entity missing | Critical | NEW Node 9 — `Fn_ValidateContext` entity guard before Switch |
| D2 | POI not canonical — HERE returns restaurant/street | Medium | Node 10,13,16,19 — slug-based DB-first, no HERE for place lookup |
| D3 | Optional chaining missing on API responses | High | All API parse nodes — defensive `?.` + null check |
| D4 | userLocation null for SEARCH_NEARBY | Medium | Node 9 — ValidateContext requires entity for NEARBY |
| D5 | API fail cascades through chain | Medium | All format nodes — try/catch with graceful error |
| D6 | AI fallback overrides rule-based match | Low | Already correct — IF_RuleMatched gates LLM path |
| D7 | No conversation state machine | Note | Out of scope for stateless webhook — documented as V2 feature |
| D8 | Tour duration parse failure | Medium | Node 38 — `parseInt()` + `isNaN()` guard |
| D9 | Inconsistent response schema across branches | Medium | All format nodes — enforced `{success, type, data, message}` |
| D10 | No API timeout | Low | Already configured — 4-5s on external, 20s on LLM |
| B1 | `Fn_BuildFinalResponse` uses node-name loop `safeFirst()` — fragile | High | Node 44 — rewritten to `$input.first()` direct input, service data embedded via `HTTP_ResponseComposer` user message |
| B2 | `Fn_ValidateContext` clarify messages are generic | Medium | Node 9 — per-intent specific Vietnamese clarification messages |
| B3 | Weather name fallback returns wrong province for POI-level entity | High | Node 25 — only use name fallback for city-level entities, POI + geocode fail = error |
| B4 | SEARCH_NEARBY CTE silent duplicates without UNIQUE(slug) | Medium | Phase 1 schema — `UNIQUE(slug)` constraint on `places` table |
| B5 | Slug normalization missing NFD diacritics removal | Critical | All Prep nodes — explicit `slugify()` with NFD + diacritics strip + `đ→d` |
| B6 | LLM hallucination — response doesn't contain source data | Medium | Node 44 — guard: if LLM text missing `source.data.name`, discard LLM, use `source.message` |
| B7 | `ErrorTrigger` doesn't catch `onError: continueRegularOutput` nodes | Note | Documented: all error handling in format nodes, ErrorTrigger is last-resort only |
| B8 | No rate limiting on webhook | Note | Documented as V2 feature — per-session throttle |
| C1 | Dual-wire `for` loop overwrites source non-deterministically | Critical | Node 44 — replaced `for` loop with `.find()`. No overwrite. No order dependency. |
| C2 | Weather lat/lng = 0,0 (bad seed) treated as valid coords | High | Node 22 — `abs(lat) < 0.0001` treated as invalid → `_needGeocode = true` |
| C3 | SEARCH_NEARBY ignores `userLocation` GPS when available | Medium | Node 28/29 — GPS bypass: if `userLocation.lat/lng` present, use as ref coords directly |
| C4 | Regex intent conflict: "tour 3 ngày thời tiết" matches SEARCH_TOUR | Low | Accepted risk — weather keyword priority noted, multi-intent is V2 |
| C5 | LLM hallucination guard too strict — discards valid paraphrases | Medium | Node 44 — fuzzy check: first word of `source.data.name`, not exact match |
| C6 | Tour SQL duration filter uses dynamic string concat — injection surface | High | Node 40 — split into IF + 2 separate DB nodes, no dynamic SQL |

---

## Phase 1: New Database Schema

Create `main_travel_assistant/normalized_schema.sql` with 8 normalized tables:

- **`categories`** (id, name, slug) — temple, lake, cave, mountain, etc.
- **`places`** (id, category_id FK, name, slug UNIQUE, description, latitude, longitude, place_type, is_active) — foreign key to categories. **Audit fix B4**: `UNIQUE(slug)` constraint prevents duplicate slugs that cause silent duplicate rows in SEARCH_NEARBY CTE cross joins.
- **`tickets`** (id, place_id FK, ticket_type, adult_price, child_price, notes) — separate from places
- **`opening_hours`** (id, place_id FK, day_of_week 0-6, open_time TIME, close_time TIME, is_closed BOOLEAN) — per-day granularity
- **`tours`** (id, name, duration_days, price, description, highlights, is_active)
- **`tour_destinations`** (id, tour_id FK, place_id FK, visit_order, stay_duration_hours)
- **`users`** (id, session_id UNIQUE, first_seen, last_seen)
- **`search_logs`** (id, session_id, intent, entity, source, latency_ms, cache_hit, fallback_triggered, error_type, created_at) — replaces `request_log`

Indexes: `idx_places_slug`, `idx_tickets_place_id`, `idx_hours_place_id_day`, `idx_tours_duration`, `idx_logs_session`, `idx_logs_created`

Seed with Ninh Bình data from existing `poi_override_postgres.sql`: Đền Thái Vi, Chùa Bái Đính, Tràng An, Tam Cốc, Chùa Bái Đính Cổ + ticket prices, opening hours per day, and 2-3 sample tours with destinations.

### Shared `slugify()` Function (Audit fix B5)

**CRITICAL**: All `Fn_Prep*` nodes MUST use the same slug normalization logic. Simple `toLowerCase().replace(/\s+/g,'-')` will NOT match DB slugs because Vietnamese diacritics are preserved.

**Canonical `slugify()` implementation** (copy into EVERY Prep node, or define once in first Prep and reference):

```javascript
function slugify(text) {
  if (!text) return '';
  return text
    .normalize('NFD')                   // decompose diacritics: "ề" → "e" + combining accent
    .replace(/[\u0300-\u036f]/g, '')    // strip combining diacritical marks
    .replace(/đ/g, 'd')                // Vietnamese đ → d
    .replace(/Đ/g, 'd')                // Vietnamese Đ → d
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')      // remove non-alphanumeric except spaces and hyphens
    .replace(/\s+/g, '-')              // spaces → hyphens
    .replace(/-+/g, '-')              // collapse multiple hyphens
    .replace(/^-|-$/g, '');           // trim leading/trailing hyphens
}
// Examples:
// slugify("Đền Thái Vi")     → "den-thai-vi"
// slugify("Chùa Bái Đính")   → "chua-bai-dinh"
// slugify("Tràng An")         → "trang-an"
// slugify("Tam Cốc - Bích Động") → "tam-coc-bich-dong"
```

**DB seed slugs MUST match this output**. If seed data has `slug = 'den-thai-vi'`, the `slugify("Đền Thái Vi")` must produce exactly `'den-thai-vi'`. Verify during seed creation.

**Nodes that MUST include `slugify()`**: `Fn_PrepPlaceInfo` (11), `Fn_PrepOpenHours` (14), `Fn_PrepTicketPrice` (17), `Fn_PrepWeather` (20), `Fn_PrepNearby` (28), `Fn_PrepDirections` (31), `Fn_PrepTour` (39).

---

## Phase 2: Entry Layer (4 nodes)

### Node 1: `Webhook_Receive`
- POST `/travel-bot`, `responseMode: "responseNode"`, typeVersion 1.1

### Node 2: `Fn_ValidateInput`
- Code node, `runOnceForEachItem`
- Extract `$json.body.message`, normalize to root level
- Output: `{_valid, sessionId, message, messageLower, userLocation, _webhookTime}`
- `_webhookTime = Date.now()` — used ONLY as reference; actual latency computed in `Fn_BuildFinalResponse` via `Date.now() - _webhookTime` (audit fix A1: unreliable in retry/queue)
- Return `{_valid: false, error}` if missing/invalid
- **userLocation extraction**: `$json.body.user_location` parsed, validated as `{lat: number, lng: number}` or null

### Node 3: `IF_InputValid`
- IF node, check `$json._valid === true`

### Node 4: `Respond_InvalidInput`
- respondToWebhook with `{success: false, type: "validation_error", data: null, message: error}`

---

## Phase 3: Intent Detection — Rule-First (4 nodes)

### Node 5: `Fn_DetectIntentRule`
- Code node, `runOnceForEachItem`
- **Core change** — regex-first intent classification with strict patterns:
  - `/thời tiết|thoi tiet|nhiệt độ|nhiet do|weather/` → `GET_WEATHER`
  - `/giá vé|gia ve|bao nhiêu tiền|bao nhieu tien|ticket price/` → `GET_TICKET_PRICE`
  - `/giờ mở cửa|gio mo cua|mấy giờ mở|may gio mo|opening hour/` → `GET_OPENING_HOURS`
  - `/chỉ đường|chi duong|đường đi|duong di|directions/` → `GET_DIRECTIONS` (keyword match)
  - `/từ\s+(.+?)\s+đến\s+(.+)/` → `GET_DIRECTIONS` + capture origin (group 1) and destination (group 2) — **audit fix A2: strict regex, NOT greedy `/từ.*đến/`**
  - `/gần đây|gan day|xung quanh|địa điểm gần|dia diem gan|nearby/` → `SEARCH_NEARBY`
  - `/tour\s+\d+\s*ngày|tour.*ngay|du lịch.*ngày/` → `SEARCH_TOUR` + capture `duration_days` via `/(\d+)\s*ngày/`
  - **Audit fix C4 — regex priority order**: Weather, directions, opening hours are checked BEFORE tour. This prevents "tour 3 ngày thời tiết" from matching SEARCH_TOUR when the user meant GET_WEATHER. First-match-wins design. Multi-intent is V2.
  - Entity extraction: remaining text after keyword removal → `entity` field
  - If no regex match: `{intent: null, _ruleMatched: false}`
  - If regex match: `{intent: "GET_X", _ruleMatched: true, entity, entity_origin, entity_destination, duration_days}`
  - **Note**: regex `/từ\s+.+\s+đến\s+.+/` requires BOTH origin and destination text to be present. "Đi từ Tràng An" alone will NOT match → falls through to LLM

### Node 6: `IF_RuleMatched`
- IF node, check `$json._ruleMatched === true`
  - TRUE → `Switch_Intent` (skip LLM entirely — fast path)
  - FALSE → `HTTP_LLMClassify` (LLM fallback — slow path)

### Node 7: `HTTP_LLMClassify`
- HTTP Request to OpenRouter (`google/gemini-2.0-flash-001`)
- System prompt lists 8 intents (adds `GET_TICKET_PRICE` and `FALLBACK`)
- Temperature 0, max_tokens 300, timeout 20s
- Only called when regex fails
- API key: `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`

### Node 8: `Fn_NormalizeLLM`
- Code node, `runOnceForEachItem`
- Parse LLM JSON, validate intent is in enum, extract entities
- **Audit fix A13**: If LLM returns valid intent but `entity === null` for intents that REQUIRE an entity (GET_PLACE_INFO, GET_OPENING_HOURS, GET_TICKET_PRICE, GET_WEATHER, SEARCH_NEARBY, GET_DIRECTIONS) → force `intent = 'FALLBACK'`
- Falls back to `FALLBACK` if LLM output is unparseable JSON
- Output feeds into `Fn_ValidateContext`

---

## Phase 3b: Entity Guard Gate (1 node) — CRITICAL NEW LAYER

### Node 9: `Fn_ValidateContext`
- Code node, `runOnceForEachItem`
- **Why this exists (audit fix D1)**: Intent classification can succeed with high confidence but missing required entities. Without this gate, downstream nodes receive null slugs and crash or return wrong data.
- Required entity map:

| Intent | Required Fields | Fallback if Missing |
|--------|----------------|---------------------|
| `GET_PLACE_INFO` | `entity` | FALLBACK + "Bạn muốn biết về địa điểm nào?" |
| `GET_OPENING_HOURS` | `entity` | FALLBACK + "Bạn muốn xem giờ mở cửa của đâu?" |
| `GET_TICKET_PRICE` | `entity` | FALLBACK + "Bạn muốn xem giá vé địa điểm nào?" |
| `GET_WEATHER` | `entity` | FALLBACK + "Địa điểm nào bạn muốn xem thời tiết?" |
| `SEARCH_NEARBY` | `entity` (reference place) OR `userLocation` GPS | FALLBACK + "Gần địa điểm nào?" |
| `GET_DIRECTIONS` | `entity_origin` AND `entity_destination` | FALLBACK + "Bạn muốn đi từ đâu đến đâu?" |
| `SEARCH_TOUR` | (none required, duration optional) | Pass through |
| `FALLBACK` | (none) | Pass through |

- Logic:
```javascript
const REQUIRED = {
  GET_PLACE_INFO: ['entity'],
  GET_OPENING_HOURS: ['entity'],
  GET_TICKET_PRICE: ['entity'],
  GET_WEATHER: ['entity'],
  SEARCH_NEARBY: ['entity'],  // C3: bypassed if userLocation GPS present
  GET_DIRECTIONS: ['entity_origin', 'entity_destination'],
};

// B2 — Per-intent specific clarification messages (Vietnamese)
const CLARIFY_MSG = {
  GET_PLACE_INFO:    'Bạn muốn biết thông tin về địa điểm nào? Ví dụ: "Tràng An có gì hay?"',
  GET_OPENING_HOURS: 'Bạn muốn xem giờ mở cửa của đâu? Ví dụ: "Chùa Bái Đính mở cửa lúc mấy giờ?"',
  GET_TICKET_PRICE:  'Bạn muốn xem giá vé địa điểm nào? Ví dụ: "Giá vé Tràng An bao nhiêu?"',
  GET_WEATHER:       'Địa điểm nào bạn muốn xem thời tiết? Ví dụ: "Thời tiết Ninh Bình hôm nay"',
  SEARCH_NEARBY:     'Gần địa điểm nào? Ví dụ: "Địa điểm gần Tràng An" hoặc gửi vị trí GPS.',
  GET_DIRECTIONS:    'Bạn muốn đi từ đâu đến đâu? Ví dụ: "Chỉ đường từ Tràng An đến Bái Đính"',
};

const required = REQUIRED[$json.intent] || [];
const missing = required.filter(f => !$json[f] || !String($json[f]).trim());

// C3: SEARCH_NEARBY special case — if entity missing but GPS available, allow through
if ($json.intent === 'SEARCH_NEARBY' && missing.includes('entity')) {
  const gps = $json.userLocation;
  const hasGPS = gps && typeof gps.lat === 'number' && typeof gps.lng === 'number'
    && Math.abs(gps.lat) > 0.0001 && Math.abs(gps.lng) > 0.0001;
  if (hasGPS) {
    // GPS present — bypass entity requirement
    return $json;
  }
}

if (missing.length > 0) {
  return {
    ...$json,
    intent: 'FALLBACK',
    _originalIntent: $json.intent,
    _missingFields: missing,
    _clarifyMessage: CLARIFY_MSG[$json.intent] || 'Xin lỗi, bạn có thể nói rõ hơn được không?'
  };
}

return $json; // pass through unchanged
```
- **Audit fix B2**: Each intent has a tailored Vietnamese clarification with a concrete example. Users see "Bạn muốn đi từ đâu đến đâu?" instead of a generic "Thiếu trường entity_origin, entity_destination". The example helps users self-correct.
- **SEARCH_TOUR note**: `duration_days` is optional — if missing, query returns all tours. No guard needed.
- **SEARCH_NEARBY note (audit fix D4)**: For stateless webhook, `entity` (reference place) is the required field, NOT `userLocation`. User's GPS location is not used in DB-only nearby. If user says "gần tôi" without reference place, entity will be null → caught here.
- Connections: output → `Switch_Intent`

---

## Phase 4: Intent Router (1 node)

### Node 10: `Switch_Intent`
- Switch node, typeVersion 3, 8 outputs:
  - 0: `GET_PLACE_INFO`
  - 1: `GET_OPENING_HOURS`
  - 2: `GET_TICKET_PRICE`
  - 3: `GET_WEATHER`
  - 4: `SEARCH_NEARBY`
  - 5: `GET_DIRECTIONS`
  - 6: `SEARCH_TOUR`
  - fallbackOutput: `extra` → `FALLBACK`
- Each rule: `caseSensitive: false`, `typeValidation: "loose"`, `operator.name: "filter.operator.equals"`

---

## Phase 5: Service Branches

### Branch A: GET_PLACE_INFO (3 nodes)

#### Node 11: `Fn_PrepPlaceInfo`
- Code, `runOnceForEachItem`
- Normalize slug from entity
- **Audit fix D2**: Slug-based DB lookup is already canonical (no HERE ambiguity). DB is source of truth for place identity.
- **Audit fix D5**: If slug is empty after normalization → should not happen (caught by Fn_ValidateContext), but guard: `if (!slug) return {success: false, type: 'error', ...}`
- Output: `{...data, slug, entityDisplay}`

#### Node 12: `DB_LookupPlace`
- **Audit fix A4**: Subquery pattern to prevent duplicate rows from multi-table join
- Postgres query:
```sql
SELECT p.name, p.slug, p.description, p.latitude, p.longitude, p.place_type,
  t.ticket_type, t.adult_price, t.child_price, t.notes AS ticket_notes,
  oh.hours
FROM places p
LEFT JOIN tickets t ON t.place_id = p.id
LEFT JOIN (
  SELECT place_id,
    json_agg(json_build_object(
      'day', day_of_week, 'open', open_time,
      'close', close_time, 'closed', is_closed
    ) ORDER BY day_of_week) AS hours
  FROM opening_hours
  GROUP BY place_id
) oh ON oh.place_id = p.id
WHERE p.slug = '{{ $json.slug }}' AND p.is_active = true
LIMIT 1
```
- **Why subquery**: If place has 2 tickets × 7 hours, naive `LEFT JOIN + GROUP BY` produces 14 rows. Subquery pre-aggregates hours into 1 JSON array before join.
- **If multiple ticket types**: Query returns 1 row per ticket type — `Fn_FormatPlaceInfo` picks the first (primary). For full ticket listing, user should ask GET_TICKET_PRICE.
- `alwaysOutputData: true`, `onError: "continueRegularOutput"`, credential `wanVbO3iF1oBHLKq`

#### Node 13: `Fn_FormatPlaceInfo`
- Code, `runOnceForEachItem`
- Build `{success, type: "place_info", data: {name, description, ticket_price, opening_hours, coordinates}, message}`
- Uses `$json` for DB result, `$('Fn_PrepPlaceInfo').item.json` for upstream
- **Audit fix D5**: try/catch wrapping with graceful error:
```javascript
try {
  const db = $json;
  const prep = $('Fn_PrepPlaceInfo').item.json;
  if (!db || !db.name) {
    return { success: false, type: 'not_found', data: null,
      message: 'Không tìm thấy thông tin về ' + (prep.entityDisplay || 'địa điểm này') + '.' };
  }
  // ... format response
} catch(e) {
  return { success: false, type: 'error', data: null,
    message: 'Lỗi khi xử lý thông tin địa điểm.' };
}
```

---

### Branch B: GET_OPENING_HOURS (3 nodes)

#### Node 14: `Fn_PrepOpenHours`
- Code, `runOnceForEachItem`. Normalize slug.

#### Node 15: `DB_LookupOpenHours`
- Postgres query:
```sql
SELECT p.name, oh.day_of_week, oh.open_time, oh.close_time, oh.is_closed
FROM opening_hours oh JOIN places p ON p.id = oh.place_id
WHERE p.slug = '{{ $json.slug }}' AND p.is_active = true
ORDER BY oh.day_of_week
```
- `alwaysOutputData: true`

#### Node 16: `Fn_FormatOpenHours`
- Code, `runOnceForAllItems` (multi-row result)
- Build today's status (open/closed), format all 7 days
- **0-row handling**: If `items.length === 0` → `{success: false, type: "not_found", data: null, message: "Không tìm thấy giờ mở cửa..."}`
- Output `{success, type: "opening_hours", data, message}`

---

### Branch C: GET_TICKET_PRICE (3 nodes)

#### Node 17: `Fn_PrepTicketPrice`
- Code, `runOnceForEachItem`. Normalize slug.

#### Node 18: `DB_LookupTicket`
- Postgres query:
```sql
SELECT p.name, t.ticket_type, t.adult_price, t.child_price, t.notes
FROM tickets t JOIN places p ON p.id = t.place_id
WHERE p.slug = '{{ $json.slug }}' AND p.is_active = true
```
- `alwaysOutputData: true`

#### Node 19: `Fn_FormatTicketPrice`
- Code, `runOnceForAllItems` (may have multiple ticket types)
- **Audit fix A8 — explicit 0-row handling**:
```javascript
const items = $input.all();
const rows = items.map(i => i.json).filter(r => r && r.ticket_type);

if (rows.length === 0) {
  const prep = $('Fn_PrepTicketPrice').first()?.json ?? {};
  return {
    success: false,
    type: 'not_found',
    data: null,
    message: 'Không tìm thấy thông tin giá vé của ' + (prep.entityDisplay || 'địa điểm này') + '.'
  };
}
// ... format ticket data
```
- Output `{success, type: "ticket_price", data, message}`

---

### Branch D: GET_WEATHER (7 nodes)

#### Node 20: `Fn_PrepWeather`
- Code, `runOnceForEachItem`. Normalize slug.

#### Node 21: `DB_WeatherCoords`
- Postgres: `SELECT name, latitude, longitude FROM places WHERE slug = '{{ $json.slug }}' AND is_active = true LIMIT 1`
- `alwaysOutputData: true`

#### Node 22: `Fn_ResolveWeatherCoords`
- Code, `runOnceForEachItem`
- Check if DB row has lat/lng → set `_needGeocode`
- **Audit fix B3**: Set `_entityLevel` based on DB result:
  - If DB found the place (has name) → `_entityLevel = 'poi'` (it's a known POI in our DB)
  - If DB returned empty → `_entityLevel = 'city'` (likely a city/province name not in places table)
- **Audit fix C2 — 0,0 coord guard**: lat/lng = 0,0 (null cast, bad seed, or Postgres default) is Gulf of Guinea, NOT valid Vietnamese coords. All Vietnam coords are lat ~8-23, lng ~102-110.
```javascript
const db = $json;
const prep = $('Fn_PrepWeather').item.json;

// C2 — Validate coords are real, not 0,0 or null cast
const hasValidCoords = (
  typeof db.latitude === 'number' &&
  typeof db.longitude === 'number' &&
  Math.abs(db.latitude) > 0.0001 &&
  Math.abs(db.longitude) > 0.0001
);

const dbFound = !!db.name;

return {
  ...prep,
  weatherLocation: db.name || prep.entity,
  lat: hasValidCoords ? db.latitude : null,
  lng: hasValidCoords ? db.longitude : null,
  _needGeocode: !hasValidCoords,
  _entityLevel: dbFound ? 'poi' : 'city'
};
```
- Uses `$json` for DB result, `$('Fn_PrepWeather').item.json` for upstream

#### Node 23: `IF_NeedGeocode`
- IF node. TRUE → HERE geocode. FALSE → directly to WeatherAPI.

#### Node 24: `HTTP_HEREGeocode`
- GET `https://geocode.search.hereapi.com/v1/geocode?q={{location}}&limit=1&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0`
- Timeout 5s, `onError: "continueRegularOutput"`

#### Node 25: `Fn_ParseGeocode`
- Code, `runOnceForEachItem`
- **Audit fix A7 — defensive items check**:
- **Audit fix B3 — POI-level name fallback guard**:
```javascript
const intentData = $('Fn_ResolveWeatherCoords').item.json;
const items = $json?.items;

// Guard: HERE may return empty array or undefined
if (!items || !Array.isArray(items) || items.length === 0) {
  // Geocode failed — check entity level before name fallback
  // B3: Only use name fallback for CITY-LEVEL entities (e.g., "Ninh Bình", "Hà Nội")
  // POI-level entities (e.g., "Đền Thái Vi", "Chùa Bái Đính") will resolve to
  // wrong locations via WeatherAPI name search (e.g., "Thai Vi Village, Hanoi")
  const entityLevel = intentData._entityLevel || 'poi'; // default to poi (safer)
  
  if (entityLevel === 'city') {
    // City-level: safe to use name as WeatherAPI query
    return {
      ...intentData,
      lat: null, lng: null,
      coordSource: 'name_fallback',
      _needGeocode: false,
      _geocodeFailed: true
    };
  } else {
    // POI-level: name fallback is UNSAFE → return error
    return {
      ...intentData,
      lat: null, lng: null,
      coordSource: 'none',
      _needGeocode: false,
      _geocodeFailed: true,
      _poiLevelNoCoords: true
    };
  }
}

const pos = items[0]?.position;
if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') {
  return { ...intentData, lat: null, lng: null,
    coordSource: 'name_fallback', _needGeocode: false, _geocodeFailed: true };
}

return {
  ...intentData,
  lat: pos.lat, lng: pos.lng,
  resolvedName: items[0].title || intentData.weatherLocation,
  coordSource: 'geocode', _needGeocode: false
};
```
- **Never assume `items[0]` exists**. Never assume `.position` exists.
- **B3 entity level detection**: `_entityLevel` is set by `Fn_ResolveWeatherCoords` — if DB found the place (it's a known POI), `_entityLevel = 'poi'`. If DB didn't find it (likely a city/province name), `_entityLevel = 'city'`.

#### Node 26: `HTTP_WeatherAPI`
- GET `https://api.weatherapi.com/v1/current.json?q={{lat,lng or location}}&aqi=yes&lang=vi&key=52c2f536877444ec8a0165526260501`
- Both geocode path and direct path converge here
- Timeout 5s
- **Fallback**: If lat/lng null (geocode failed), WeatherAPI accepts city names: `q={{ encodeURIComponent($json.weatherLocation || $json.entity) }}`
- **Audit fix B3**: If `$json._poiLevelNoCoords === true`, SKIP this node entirely (use IF node or guard in `Fn_FormatWeather`). WeatherAPI name query for POI names returns wrong province data.

#### Node 27: `Fn_FormatWeather`
- Code, `runOnceForEachItem`
- **Audit fix D3 — defensive mapping**:
- **Audit fix B3 — POI-level error handling**:
```javascript
const w = $json;

// B3: If POI-level entity couldn't be geocoded, return clear error
if (w?._poiLevelNoCoords) {
  const prep = $('Fn_PrepWeather').item.json;
  return { success: false, type: 'not_found', data: null,
    message: 'Không tìm thấy tọa độ của ' + (prep.entityDisplay || 'địa điểm này') +
    '. Hãy thử hỏi thời tiết theo tên tỉnh/thành phố, ví dụ: "Thời tiết Ninh Bình".' };
}

if (!w?.current) {
  return { success: false, type: 'error', data: null,
    message: 'Không lấy được dữ liệu thời tiết.' };
}
```
- Output `{success, type: "weather", data: {temp_c, condition, humidity, wind, aqi}, message}`

---

### Branch E: SEARCH_NEARBY (3 nodes + GPS bypass)

#### Node 28: `Fn_PrepNearby`
- Code, `runOnceForEachItem`. Normalize slug.
- **Audit fix A3 — ref place existence check**: Before passing to DB, validate slug is non-empty (already enforced by Fn_ValidateContext). But additionally, this node should note that if CTE returns empty, `Fn_FormatNearby` must handle it gracefully.
- **Audit fix C3 — GPS bypass**: If `$json.userLocation` has valid `lat/lng`, use GPS coords directly instead of requiring a place name. This enables "gần tôi" queries when client sends GPS.
```javascript
const slug = slugify($json.entity || '');
const gps = $json.userLocation;

// C3: If user sent GPS coords AND no named entity, use GPS as reference
const hasGPS = (
  gps && typeof gps.lat === 'number' && typeof gps.lng === 'number' &&
  Math.abs(gps.lat) > 0.0001 && Math.abs(gps.lng) > 0.0001
);

return {
  ...$json,
  slug,
  entityDisplay: $json.entity || 'vị trí của bạn',
  _useGPS: hasGPS && !slug,  // GPS only when no named entity
  _gpsLat: hasGPS ? gps.lat : null,
  _gpsLng: hasGPS ? gps.lng : null
};
```

#### Node 28b: `IF_NearbyGPS` (NEW — audit fix C3)
- IF node, check `$json._useGPS === true`
- TRUE → `DB_NearbyByGPS` (Node 29b)
- FALSE → `DB_NearbyPlaces` (Node 29, slug-based CTE)

#### Node 29b: `DB_NearbyByGPS` (NEW — audit fix C3)
- Postgres query using GPS coords directly:
```sql
SELECT p.name, p.slug, p.description, p.place_type,
  ROUND(CAST(
    111.045 * SQRT(POWER(p.latitude - {{ $json._gpsLat }}, 2) +
    POWER((p.longitude - {{ $json._gpsLng }}) * COS(RADIANS({{ $json._gpsLat }})), 2))
  AS numeric), 2) AS distance_km,
  'GPS' AS ref_name
FROM places p
WHERE p.is_active = true
ORDER BY distance_km ASC LIMIT 5
```
- `alwaysOutputData: true`
- Output feeds into `Fn_FormatNearby`

#### Node 29: `DB_NearbyPlaces`
- Postgres with PostGIS-free distance calc (CTE with ref place, Euclidean approx):
```sql
WITH ref AS (
  SELECT latitude, longitude, name FROM places
  WHERE slug = '{{ $json.slug }}' AND is_active = true LIMIT 1
)
SELECT p.name, p.slug, p.description, p.place_type,
  ROUND(CAST(
    111.045 * SQRT(POWER(p.latitude - ref.latitude, 2) +
    POWER((p.longitude - ref.longitude) * COS(RADIANS(ref.latitude)), 2))
  AS numeric), 2) AS distance_km,
  ref.name AS ref_name
FROM places p, ref
WHERE p.is_active = true AND p.slug != '{{ $json.slug }}'
ORDER BY distance_km ASC LIMIT 5
```
- **Audit fix A3**: If ref slug doesn't exist in DB → CTE `ref` is empty → implicit cross join produces 0 rows → `alwaysOutputData: true` returns empty item. `Fn_FormatNearby` handles this as `not_found`. **No SQL error, no crash.**
- **Audit fix A5 — Euclidean formula risk**: Accuracy degrades at distances >50km and near poles. For Ninh Bình region (±10km between POIs), error is <0.1%. Acceptable. PostGIS `ST_DistanceSphere()` is the upgrade path.
- `alwaysOutputData: true`

#### Node 30: `Fn_FormatNearby`
- Code, `runOnceForAllItems` (multi-row)
- **0-row handling (including ref place not found)**:
```javascript
const prep = $('Fn_PrepNearby').first()?.json ?? {};
const items = $input.all();
const rows = items.map(i => i.json).filter(r => r && r.name);

if (rows.length === 0) {
  return {
    success: false, type: 'not_found', data: null,
    message: 'Không tìm thấy địa điểm gần ' + (prep.entityDisplay || 'đây') + '. Kiểm tra lại tên địa điểm.'
  };
}
```
- Output `{success, type: "nearby", data: {ref_name, places: [...]}, message}`

---

### Branch F: GET_DIRECTIONS (7 nodes)

#### Node 31: `Fn_PrepDirections`
- Code, `runOnceForEachItem`
- Extract origin/destination from entity_origin/entity_destination, slugify both

#### Node 32: `DB_DirectionCoords`
- Postgres: `SELECT slug, name, latitude, longitude FROM places WHERE slug IN ('{{ $json.origin_slug }}', '{{ $json.dest_slug }}') AND is_active = true`
- `alwaysOutputData: true`

#### Node 33: `Fn_ResolveDirectionCoords`
- Code, `runOnceForAllItems`
- Match DB rows to origin/dest by slug, flag unresolved locations
- Output: `{origin: {name, lat, lng, resolved}, destination: {...}, _allResolved, _needOriginGeocode, _needDestGeocode}`

#### Node 34: `IF_AllCoordsResolved`
- IF node, check `$json._allResolved === true`
- TRUE → ORS route. FALSE → HERE geocode.

#### Node 35: `HTTP_HEREGeocode_Direction`
- GET HERE geocode for unresolved location
- Timeout 5s
- **Audit fix A7 — same defensive guard as Node 25**: `if (!$json.items?.length)` → return unresolved with name-only fallback

#### Node 36: `Fn_ParseDirectionGeocode`
- Code, `runOnceForEachItem`
- Merge geocoded coords with existing data
- **Defensive**: `const pos = $json?.items?.[0]?.position; if (!pos?.lat) return { ...data, _geocodeFailed: true };`

#### Node 37: `HTTP_ORS_Route`
- **Audit fix A6 — use directions endpoint, NOT matrix**:
- POST to `https://api.openrouteservice.org/v2/directions/driving-car`
- Body:
```json
{
  "coordinates": [
    [{{ origin.lng }}, {{ origin.lat }}],
    [{{ dest.lng }}, {{ dest.lat }}]
  ]
}
```
- **Why not matrix**: Matrix API is for N×N distance tables (slow, higher quota usage). Directions API returns single A→B route with distance + duration + geometry. Correct for 2-point routing.
- Response path: `$json.routes[0].summary.distance` (meters), `$json.routes[0].summary.duration` (seconds)
- Timeout 4s
- `onError: "continueRegularOutput"`

#### Node 38: `Fn_FormatDirections`
- Code, `runOnceForEachItem`
- Haversine fallback if ORS fails
- **Audit fix D5**: try/catch wrapping. If ORS response missing `.routes[0]` → use Haversine.
- Output `{success, type: "directions", data: {origin, destination, distance_km, duration_min, maps_link}, message}`

---

### Branch G: SEARCH_TOUR (5 nodes — audit fix C6: split into IF + 2 DB nodes)

#### Node 39: `Fn_PrepTour`
- Code, `runOnceForEachItem`. Extract duration_days, slugify location.
- **Audit fix D8 — duration parse guard**:
```javascript
let duration = null;
const match = ($json.message || '').match(/(\d+)\s*ngày/);
if (match) {
  duration = parseInt(match[1], 10);
  if (isNaN(duration) || duration < 1 || duration > 30) duration = null;
}
return { ...$json, duration_days: duration, tourLocation: $json.entity || 'Ninh Bình' };
```

#### Node 39b: `IF_HasDuration` (NEW — audit fix C6)
- IF node, check `$json.duration_days !== null`
- TRUE → `DB_LookupTourFiltered` (Node 40a)
- FALSE → `DB_LookupTourAll` (Node 40b)
- **Why split (C6)**: Eliminates dynamic SQL string concatenation. Even though `duration_days` is validated as integer, n8n expression `{{ $json.duration_days ? 'AND ...' : '' }}` is a string concat in SQL — one bug in PrepTour validation = injection surface. Two separate DB nodes with static SQL = zero injection surface.

#### Node 40a: `DB_LookupTourFiltered` (NEW — audit fix C6)
- Postgres query — **static SQL, duration in WHERE**:
```sql
SELECT t.name, t.duration_days, t.price, t.description, t.highlights,
  json_agg(json_build_object('place', p.name, 'order', td.visit_order)) as destinations
FROM tours t
LEFT JOIN tour_destinations td ON td.tour_id = t.id
LEFT JOIN places p ON p.id = td.place_id
WHERE t.is_active = true AND t.duration_days = {{ $json.duration_days }}
GROUP BY t.id ORDER BY t.duration_days LIMIT 5
```
- `alwaysOutputData: true`, credential `wanVbO3iF1oBHLKq`
- **Safe**: `{{ $json.duration_days }}` is a validated integer from PrepTour. The SQL query itself is static — no string building.

#### Node 40b: `DB_LookupTourAll` (NEW — audit fix C6)
- Postgres query — **static SQL, no duration filter**:
```sql
SELECT t.name, t.duration_days, t.price, t.description, t.highlights,
  json_agg(json_build_object('place', p.name, 'order', td.visit_order)) as destinations
FROM tours t
LEFT JOIN tour_destinations td ON td.tour_id = t.id
LEFT JOIN places p ON p.id = td.place_id
WHERE t.is_active = true
GROUP BY t.id ORDER BY t.duration_days LIMIT 5
```
- `alwaysOutputData: true`, credential `wanVbO3iF1oBHLKq`

#### Node 41: `Fn_FormatTour`
- Code, `runOnceForAllItems` (multi-row)
- **0-row handling**: If no tours found → `{success: false, type: "not_found", data: null, message: "Không tìm thấy tour phù hợp..."}`
- Output `{success, type: "tour", data: {tours: [...]}, message}`

---

### Branch H: FALLBACK (1 node)

#### Node 42: `Fn_FallbackResponse`
- Code, `runOnceForEachItem`
- **Audit fix A14**: Use `success: true, type: "help"` (not `success: false`). FALLBACK is a valid, intentional response — not an error.
- If `_clarifyMessage` exists (from Fn_ValidateContext), use it as targeted clarification.
- Otherwise, return generic help menu listing all 7 supported intents with Vietnamese examples.
- Output:
```javascript
return {
  success: true,
  type: 'help',
  data: {
    supported_intents: ['GET_PLACE_INFO', 'GET_OPENING_HOURS', 'GET_TICKET_PRICE',
      'GET_WEATHER', 'SEARCH_NEARBY', 'GET_DIRECTIONS', 'SEARCH_TOUR'],
    _originalIntent: $json._originalIntent || null,
    _missingFields: $json._missingFields || null
  },
  message: $json._clarifyMessage || 'Xin lỗi, tôi chưa hiểu yêu cầu của bạn...'
};
```
- **UX note**: Targeted clarification ("Bạn muốn xem giờ mở cửa của đâu?") is much better than generic "Tôi chưa hiểu". The `_clarifyMessage` from ValidateContext enables this.

---

## Phase 6: Response Layer (4 nodes + 2 global error nodes)

### Node 43: `HTTP_ResponseComposer`
- POST to OpenRouter (`google/gemini-2.0-flash-001`)
- LLM formats structured data into natural Vietnamese
- All 7 service branches (NOT Fallback) feed into this
- System prompt: format only, no invention, emoji, <300 words
- Timeout 20s
- `onError: "continueRegularOutput"` — **critical: LLM fail must NOT kill flow**
- API key: `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`
- **Input**: Receives `{success, type, data, message}` from each `Fn_Format*` node
- **LLM user message includes**:
```
Dữ liệu gốc (JSON):
{{ JSON.stringify($json) }}

Hãy viết lại thành đoạn văn tiếng Việt tự nhiên dựa trên dữ liệu trên.
```
- **Output**: LLM response object with `choices[0].message.content`

### Node 44: `Fn_BuildFinalResponse`
- Code, `runOnceForAllItems`
- **Architecture (audit fix C1)**: Receives items from TWO wires:
  1. `HTTP_ResponseComposer` → this node (LLM response, has `.choices`)
  2. Each `Fn_Format*` → this node (service data, has `.type` + `.success`)
  3. OR `Fn_FallbackResponse` → this node (FALLBACK, has `.type = 'help'`)
- **Audit fix C1 — `.find()` not `for` loop**: Use deterministic `.find()` to pick first match by shape. No loop overwrite. No order dependency. If HTTP_ResponseComposer times out / retries / outputs malformed data, `.find()` still picks the correct service item.
- **Audit fix A9 — LLM-independent response**: `source.message` is always available as fallback.
- **Audit fix C5 — fuzzy hallucination guard**: Check first word of `source.data.name` (case-insensitive), not exact match. Allows LLM paraphrases like "Ngôi đền này…" to pass if first word "Đền" is present.
```javascript
const items = $input.all();

// C1 — Deterministic .find(), NOT loop overwrite
const service = items.find(i => i.json?.type && i.json?.success !== undefined);
const llmItem = items.find(i => i.json?.choices?.[0]?.message?.content);

const source = service?.json || {};
let llmText = llmItem?.json?.choices?.[0]?.message?.content || '';

// C5 — Fuzzy hallucination guard
// Only discard LLM if source has data.name AND LLM doesn't mention any part of it
if (llmText && source.data?.name) {
  const nameParts = source.data.name.toLowerCase().split(/\s+/);
  const llmLower = llmText.toLowerCase();
  // Check if at least the FIRST meaningful word appears in LLM text
  // (skip common prefixes like "Đền", "Chùa" — check last word too)
  const hasFirstWord = nameParts.length > 0 && llmLower.includes(nameParts[0]);
  const hasLastWord = nameParts.length > 1 && llmLower.includes(nameParts[nameParts.length - 1]);
  if (!hasFirstWord && !hasLastWord) {
    // LLM didn't mention ANY part of the name — likely hallucinated
    llmText = '';
  }
}

// PRIORITY: LLM text > service.message > hardcoded fallback
const finalMessage = llmText || source.message || 'Không có dữ liệu.';

// Latency computation (audit fix A1)
const webhookTime = $('Fn_ValidateInput').first()?.json?._webhookTime;
const latencyMs = webhookTime ? Date.now() - webhookTime : null;

return {
  success: source.success ?? false,
  type: source.type || 'unknown',
  data: source.data || null,
  message: finalMessage,
  _latencyMs: latencyMs
};
```
- **Why `.find()` over `for` loop (C1)**:
  - `for` loop: if n8n delivers 2 service-shaped items (retry, error item with `.type`), loop OVERWRITES `source` with last match. Non-deterministic based on item order.
  - `.find()`: always returns FIRST match. Deterministic regardless of item count or order.
  - If `HTTP_ResponseComposer` times out: `llmItem = undefined`, `llmText = ''`, falls through to `source.message`. Safe.
  - If `HTTP_ResponseComposer` retries and outputs 2 items: `.find()` picks first `choices` item. Safe.
- **Only `$()` reference**: `$('Fn_ValidateInput').first()` — safe, entry-layer node, always runs exactly once.
- **Mode**: `runOnceForAllItems` REQUIRED — receives items from multiple wires.

### Node 45: `Respond_Final`
- respondToWebhook with `{success, type, data, message}`

### Node 46: `DB_WriteLog`
- Postgres INSERT into `search_logs`
- `onError: "continueRegularOutput"` — **log failure must NEVER affect user response (audit A13 confirmed)**
- Runs parallel with `Respond_Final`

### Node 47: `ErrorTrigger` (GLOBAL ERROR HANDLER — audit fix A12)
- n8n Error Trigger node (`n8n-nodes-base.errorTrigger`)
- Catches any unhandled error in the workflow
- Connected to `Respond_SystemError`

### Node 48: `Respond_SystemError`
- respondToWebhook node
- Returns:
```json
{
  "success": false,
  "type": "system_error",
  "data": null,
  "message": "Xin lỗi, hệ thống đang gặp sự cố. Vui lòng thử lại sau."
}
```
- **Why**: Without this, n8n returns raw 500 HTML/JSON to client. With this, client always gets a valid JSON response.
- **Note**: Error Trigger only fires for UNCAUGHT errors. All service branches have `onError: "continueRegularOutput"` + try/catch in format nodes, so this is the absolute last resort.
- **Audit fix B7 — ErrorTrigger scope clarification**: `ErrorTrigger` does NOT catch errors from nodes configured with `onError: "continueRegularOutput"`. Those nodes swallow errors and output empty/error items instead of throwing. This means:
  - **All error handling for API failures (HERE, WeatherAPI, ORS, OpenRouter) MUST happen in the downstream `Fn_Format*` code nodes** via null/empty checks.
  - `ErrorTrigger` only catches: (1) bugs in Code nodes (syntax errors, uncaught exceptions), (2) misconfigured nodes (wrong credentials, missing params), (3) n8n internal errors.
  - This is BY DESIGN — we want API failures to be handled gracefully per-branch, not globally.
  - If a Code node has a bug that slips past try/catch, `ErrorTrigger` will catch it and return the system error JSON instead of raw 500.

---

## Phase 7: Connection Graph

```
Webhook_Receive
  → Fn_ValidateInput
    → IF_InputValid
      TRUE  → Fn_DetectIntentRule
                → IF_RuleMatched
                  TRUE  → Fn_ValidateContext → Switch_Intent
                  FALSE → HTTP_LLMClassify → Fn_NormalizeLLM → Fn_ValidateContext → Switch_Intent
      FALSE → Respond_InvalidInput

Switch_Intent
  [0] GET_PLACE_INFO    → Fn_PrepPlaceInfo → DB_LookupPlace → Fn_FormatPlaceInfo ──┬──→ HTTP_ResponseComposer
  [1] GET_OPENING_HOURS → Fn_PrepOpenHours → DB_LookupOpenHours → Fn_FormatOpenHours ──┬──→ HTTP_ResponseComposer
  [2] GET_TICKET_PRICE  → Fn_PrepTicketPrice → DB_LookupTicket → Fn_FormatTicketPrice ──┬──→ HTTP_ResponseComposer
  [3] GET_WEATHER       → Fn_PrepWeather → DB_WeatherCoords → Fn_ResolveWeatherCoords → IF_NeedGeocode
                            TRUE  → HTTP_HEREGeocode → Fn_ParseGeocode → HTTP_WeatherAPI
                            FALSE → HTTP_WeatherAPI
                          → Fn_FormatWeather ──┬──→ HTTP_ResponseComposer
  [4] SEARCH_NEARBY     → Fn_PrepNearby → IF_NearbyGPS
                            TRUE  → DB_NearbyByGPS → Fn_FormatNearby ──┬──→ HTTP_ResponseComposer
                            FALSE → DB_NearbyPlaces → Fn_FormatNearby ──┬──→ HTTP_ResponseComposer
  [5] GET_DIRECTIONS    → Fn_PrepDirections → DB_DirectionCoords → Fn_ResolveDirectionCoords → IF_AllCoordsResolved
                            TRUE  → HTTP_ORS_Route
                            FALSE → HTTP_HEREGeocode_Direction → Fn_ParseDirectionGeocode → HTTP_ORS_Route
                          → Fn_FormatDirections ──┬──→ HTTP_ResponseComposer
  [6] SEARCH_TOUR       → Fn_PrepTour → IF_HasDuration
                            TRUE  → DB_LookupTourFiltered → Fn_FormatTour ──┬──→ HTTP_ResponseComposer
                            FALSE → DB_LookupTourAll → Fn_FormatTour ──┬──→ HTTP_ResponseComposer
  [extra] FALLBACK      → Fn_FallbackResponse → Fn_BuildFinalResponse (skip LLM composer)

  ** DUAL-WIRE (audit fix B1, hardened C1) — each Fn_Format* node has TWO output connections:
     Wire 1: Fn_Format* → HTTP_ResponseComposer (for LLM formatting)
     Wire 2: Fn_Format* → Fn_BuildFinalResponse (direct, for service data)

HTTP_ResponseComposer → Fn_BuildFinalResponse
Fn_BuildFinalResponse receives items from BOTH wires:
  - Uses .find(i => i.json?.type) for service data (deterministic, no loop overwrite — C1)
  - Uses .find(i => i.json?.choices) for LLM text
  - If LLM missing → falls through to source.message

Fn_BuildFinalResponse → [Respond_Final, DB_WriteLog]  (parallel)

ErrorTrigger → Respond_SystemError  (global catch — B7: only uncaught exceptions)
```

### Key Connection Changes from Original Plan
1. **NEW**: `Fn_ValidateContext` inserted between intent detection and `Switch_Intent` (both rule and LLM paths)
2. **NEW**: `ErrorTrigger` → `Respond_SystemError` (global error catch — B7: only uncaught exceptions, not `onError: continueRegularOutput`)
3. **CHANGED**: `Fn_FallbackResponse` skips `HTTP_ResponseComposer` and goes directly to `Fn_BuildFinalResponse` (no LLM formatting for help/clarification messages)
4. **CHANGED (B1/C1)**: All `Fn_Format*` nodes have DUAL output wires — one to `HTTP_ResponseComposer` and one directly to `Fn_BuildFinalResponse`. Uses `.find()` not `for` loop (C1).
5. **NEW (C3)**: SEARCH_NEARBY has `IF_NearbyGPS` split — GPS bypass when `userLocation` available.
6. **NEW (C6)**: SEARCH_TOUR has `IF_HasDuration` split — 2 separate DB nodes, no dynamic SQL concat.
7. **CHANGED (C4)**: Regex priority order: weather/directions checked BEFORE tour to reduce conflict risk.

---

## Phase 8: Global Settings

```json
{
  "settings": {
    "executionOrder": "v2",
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner",
    "executionTimeout": 120
  }
}
```

- All DB nodes: `alwaysOutputData: true`, `onError: "continueRegularOutput"`, credential `wanVbO3iF1oBHLKq`
- All HTTP nodes: `onError: "continueRegularOutput"`
- All API keys hardcoded (no `$env`, per user preference)

---

## Code Node Mode Rules (typeVersion 2)

| Mode | Valid Access | Invalid Access |
|------|------------|----------------|
| `runOnceForEachItem` | `$json`, `$('Node').item.json` | `.first()`, `.all()` |
| `runOnceForAllItems` | `$('Node').first()`, `.all()`, `items[]` | `$json`, `.item` |

### Mode Assignments

| Node | Mode | Why |
|------|------|-----|
| `Fn_ValidateInput` | `runOnceForEachItem` | Single webhook item |
| `Fn_DetectIntentRule` | `runOnceForEachItem` | Single input item |
| `Fn_NormalizeLLM` | `runOnceForEachItem` | Single LLM response |
| `Fn_ValidateContext` | `runOnceForEachItem` | Single intent item |
| All `Fn_Prep*` nodes | `runOnceForEachItem` | Single input item |
| `Fn_FormatPlaceInfo` | `runOnceForEachItem` | Single DB row (subquery pre-aggregated) |
| `Fn_FormatWeather` | `runOnceForEachItem` | Single API response |
| `Fn_FormatDirections` | `runOnceForEachItem` | Single route response |
| `Fn_ParseGeocode` | `runOnceForEachItem` | Single geocode response |
| `Fn_ParseDirectionGeocode` | `runOnceForEachItem` | Single geocode response |
| `Fn_FallbackResponse` | `runOnceForEachItem` | Single input item |
| `Fn_FormatOpenHours` | `runOnceForAllItems` | Multi-row (7 days) |
| `Fn_FormatTicketPrice` | `runOnceForAllItems` | Multi-row (ticket types) |
| `Fn_FormatNearby` | `runOnceForAllItems` | Multi-row (5 places) |
| `Fn_FormatTour` | `runOnceForAllItems` | Multi-row (tours) |
| `Fn_ResolveDirectionCoords` | `runOnceForAllItems` | Multi-row (2 coords) |
| `Fn_BuildFinalResponse` | `runOnceForAllItems` | Dual-wire input: service + LLM items |

---

## Node Count

~50 nodes total (up from ~48). New nodes added: `IF_NearbyGPS` (28b), `DB_NearbyByGPS` (29b), `IF_HasDuration` (39b), `DB_LookupTourFiltered` (40a), `DB_LookupTourAll` (40b). Removed: `DB_LookupTour` (40, replaced by 40a+40b), `Fn_MergeComposerOutput` (43b, deleted).

---

## API Keys Reference

| Service | Key | Usage |
|---------|-----|-------|
| OpenRouter | `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` | Bearer header |
| WeatherAPI | `52c2f536877444ec8a0165526260501` | `key=` query param |
| HERE Maps | `KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0` | `apiKey=` query param |
| ~~SerpAPI~~ | ~~`a07fa99a...`~~ | **REMOVED** |
| Postgres | Credential ID: `wanVbO3iF1oBHLKq` | All DB nodes |

---

## Verification Test Cases

| # | Input | Expected Regex | Expected Intent | Expected Source |
|---|-------|---------------|-----------------|-----------------|
| 1 | `"Đền Thái Vi có gì hay?"` | No match → LLM | `GET_PLACE_INFO` | DB (places+tickets+hours) |
| 2 | `"Địa điểm gần Tràng An"` | `/gần/` match | `SEARCH_NEARBY` | DB (PostGIS distance) |
| 3 | `"Chùa Bái Đính mở cửa lúc mấy giờ?"` | `/mấy giờ/` match | `GET_OPENING_HOURS` | DB (opening_hours) |
| 4 | `"Tour 3 ngày Ninh Bình"` | `/tour\s+\d+\s*ngày/` match | `SEARCH_TOUR` | DB (tours+destinations) |
| 5 | `"Thời tiết Ninh Bình hôm nay"` | `/thời tiết/` match | `GET_WEATHER` | DB coords → WeatherAPI |
| 6 | `"Chỉ đường từ Tràng An đến Chùa Bái Đính"` | `/chỉ đường|từ.*đến/` match | `GET_DIRECTIONS` | DB coords → ORS |

All responses must return: `{success: boolean, type: string, data: object|null, message: string}`

---

## Accepted Risks & V2 Roadmap

### Accepted Risks (documented, not blocking)

| Risk | Impact | Why Accepted |
|------|--------|--------------|
| Euclidean distance formula | Inaccurate >50km | All Ninh Bình POIs within 15km radius. PostGIS is V2 upgrade. |
| No conversation state machine | Multi-turn fails | Stateless webhook design. V2 adds Redis session context. |
| ORS routing quota | Scale limit | Low traffic phase. V2 migrates to HERE Routing or self-hosted OSRM. |
| Slug-only POI resolution | Unrecognized places fail | DB coverage is seed data. V2 adds HERE Place lookup fallback. |
| No rate limiting (B8) | ORS/WeatherAPI quota exhaustion under spam | Low traffic phase. V2 adds per-session webhook throttle. NGINX `limit_req` is interim option. |
| Regex intent conflict (C4) | "Tour 3 ngày thời tiết" → SEARCH_TOUR, misses weather | Regex checks run sequentially — first match wins. Multi-intent support is V2. Workaround: reorder regex to check weather/directions BEFORE tour. |

### V2 Features (out of scope for this build)

1. **Conversation state machine**: Redis-backed `pendingIntent` + `pendingEntity` for multi-turn clarification
2. **PostGIS `ST_DistanceSphere()`**: Replace Euclidean approximation
3. **HERE Routing API**: Replace ORS for directions (no credential dependency)
4. **HERE Discover API**: Fallback for places not in DB
5. **Response caching**: Weather (15min TTL), Directions (1day TTL)
6. **Rate limiting**: Per-session throttle on webhook (or NGINX `limit_req_zone` as interim)
7. **Monitoring dashboard**: search_logs analytics
8. **Multi-intent support**: Parse multiple intents from single message (e.g., "tour 3 ngày thời tiết") — currently first-match-wins (C4)

---

## Pre-Implementation Checklist

Before building, verify each guard exists:

- [ ] `Fn_ValidateContext` blocks null entity for all intents that require it
- [ ] `Fn_ValidateContext` uses per-intent Vietnamese clarification messages with examples (B2)
- [ ] `Fn_ValidateContext` allows SEARCH_NEARBY through when `userLocation` GPS present (C3)
- [ ] `Fn_DetectIntentRule` regex priority: weather/directions BEFORE tour (C4)
- [ ] `Fn_DetectIntentRule` regex `/từ\s+.+\s+đến\s+.+/` requires both origin AND destination
- [ ] `DB_LookupPlace` uses subquery pattern for opening_hours (no duplicate rows)
- [ ] `Fn_ParseGeocode` and `Fn_ParseDirectionGeocode` have `items?.length` guard
- [ ] `Fn_ParseGeocode` has POI-level entity guard — no name fallback for POIs (B3)
- [ ] `Fn_ResolveWeatherCoords` treats lat/lng 0,0 as invalid → `_needGeocode = true` (C2)
- [ ] `Fn_FormatWeather` checks `_poiLevelNoCoords` and returns user-friendly error (B3)
- [ ] `Fn_FormatTicketPrice` returns `not_found` on 0 rows
- [ ] `Fn_FormatNearby` returns `not_found` when ref place slug doesn't exist
- [ ] `Fn_PrepNearby` detects GPS → `_useGPS` flag → `IF_NearbyGPS` routes to `DB_NearbyByGPS` (C3)
- [ ] `Fn_PrepTour` validates `duration_days` via `parseInt()` + `isNaN()` guard
- [ ] `IF_HasDuration` splits tour into 2 DB nodes — no dynamic SQL concat (C6)
- [ ] `DB_LookupTourFiltered` has static `WHERE t.duration_days = {{ int }}` (C6)
- [ ] `DB_LookupTourAll` has no duration filter (C6)
- [ ] `HTTP_ORS_Route` uses `/v2/directions/` not `/v2/matrix/`
- [ ] `Fn_BuildFinalResponse` uses `.find()` for service + LLM items — no `for` loop overwrite (C1)
- [ ] `Fn_BuildFinalResponse` receives DUAL-WIRE input: LLM + service data (B1/C1)
- [ ] `Fn_BuildFinalResponse` has fuzzy hallucination guard: first/last word of name (C5)
- [ ] `Fn_BuildFinalResponse` uses `source.message` as LLM-independent fallback
- [ ] `Fn_FallbackResponse` returns `{success: true, type: "help"}`
- [ ] `ErrorTrigger` + `Respond_SystemError` exists as global catch
- [ ] `ErrorTrigger` scope documented: does NOT catch `onError: continueRegularOutput` nodes (B7)
- [ ] `Fn_NormalizeLLM` forces `FALLBACK` when entity is null for entity-required intents
- [ ] `places` table has `UNIQUE(slug)` constraint (B4)
- [ ] All `Fn_Prep*` nodes use the canonical `slugify()` function with NFD + diacritics removal + đ→d (B5)
- [ ] DB seed slugs match `slugify()` output exactly (B5)
- [ ] All DB query nodes: `alwaysOutputData: true`, `onError: "continueRegularOutput"`
- [ ] All HTTP nodes: `onError: "continueRegularOutput"`, timeout configured
- [ ] All format nodes: try/catch with graceful `{success: false, type: "error"}` return
- [ ] All Code nodes: correct mode (`runOnceForEachItem` vs `runOnceForAllItems`) with matching API usage
- [ ] Each `Fn_Format*` node has dual output wires: → HTTP_ResponseComposer AND → Fn_BuildFinalResponse (B1)
