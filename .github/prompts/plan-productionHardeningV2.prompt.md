# Production Hardening V2 — Unified Route + Schema + Fallback

**TL;DR**: 10 production improvements in 6 phases. Merge distance queries into GET_DIRECTIONS with `_routeMode` flag (zero new intents/branches). Add 4 route guards. Add `location_aliases` DB table for alias resolution. Add HERE Discover fallback for DB misses on GET_PLACE_INFO. Add selective HERE Discover fallback for GET_OPENING_HOURS (DB miss) and SEARCH_NEARBY (DB result < 3). Add `data_source`, `province` columns and tour_destinations UNIQUE constraint. Total: +12 new nodes (52→64), 5 modified nodes, 1 new SQL migration file. No existing branches deleted or restructured.

> **Fallback Policy**: Fallback chỉ áp dụng khi (1) có external source đáng tin, (2) có lợi ích rõ ràng cho UX, (3) không làm tăng cost vô lý, (4) không gây data inconsistency. GET_TICKET_PRICE và SEARCH_TOUR **không fallback** — không có external authoritative source.

---

## Decisions

- **Merge not split**: Distance unified into GET_DIRECTIONS pipeline with `_routeMode` flag — zero new intents, zero new branches, zero Switch_Intent changes
- **Alias in DB not Code**: Enables admin management without workflow edits. 1 extra DB query per request (~2ms on local Postgres — negligible)
- **HERE Discover, not Google Places**: Reuses existing HERE API key. No new credential needed. `countryCode:VNM` + `at=20.25,105.97` biases to Vietnam/Ninh Bình
- **Selective Fallback**: HERE Discover fallback for 3 intents where external data is trustworthy: GET_PLACE_INFO (full POI), GET_OPENING_HOURS (openingHours field), SEARCH_NEARBY (nearby POI with category filter). GET_TICKET_PRICE and SEARCH_TOUR have no reliable external source — curated DB only. GET_WEATHER and GET_DIRECTIONS already use external APIs in their primary flow
- **No DB cache insert in critical path**: `Fn_CacheAndFormat` formats and returns immediately. Cache insert is parallel/deferred to avoid latency spike on the user response path

---

## Phase A: Schema Migration

New file: `main_travel_assistant/production_hardening_v2.sql`

### Step A1 — Add `data_source` column to `places`

```sql
ALTER TABLE places ADD COLUMN IF NOT EXISTS data_source VARCHAR(30) DEFAULT 'seed';
COMMENT ON COLUMN places.data_source IS 'Origin of record: seed | api | admin';
```

Values: `seed` (original), `api` (cached from HERE Discover), `admin` (manually added).

### Step A2 — Add `province` column to `places`

```sql
ALTER TABLE places ADD COLUMN IF NOT EXISTS province VARCHAR(100);

UPDATE places SET province = 'Ninh Bình' WHERE slug IN (
  'den-thai-vi', 'chua-bai-dinh', 'trang-an', 'tam-coc-bich-dong',
  'chua-bai-dinh-co', 'dong-thien-ha', 'hang-mua', 'ho-dong-chuon'
);
UPDATE places SET province = 'Hà Nội' WHERE slug IN (
  'ho-hoan-kiem', 'lang-chu-tich-ho-chi-minh', 'chua-mot-cot'
);
UPDATE places SET province = 'Quảng Ninh' WHERE slug IN ('vinh-ha-long');
UPDATE places SET province = 'Quảng Bình' WHERE slug IN ('phong-nha-ke-bang');
UPDATE places SET province = 'Quảng Nam' WHERE slug IN ('pho-co-hoi-an');
UPDATE places SET province = 'Đà Nẵng' WHERE slug IN ('ba-na-hills');
UPDATE places SET province = 'Lào Cai' WHERE slug IN ('sapa');
UPDATE places SET province = 'Thừa Thiên Huế' WHERE slug IN ('dai-noi-hue');
UPDATE places SET province = 'Bình Thuận' WHERE slug IN ('mui-ne');
UPDATE places SET province = 'Tây Ninh' WHERE slug IN ('nui-ba-den');
```

### Step A3 — UNIQUE constraint on `tour_destinations`

```sql
ALTER TABLE tour_destinations
ADD CONSTRAINT unique_tour_place UNIQUE (tour_id, place_id);
```

### Step A4 — New table `location_aliases`

```sql
CREATE TABLE IF NOT EXISTS location_aliases (
  id SERIAL PRIMARY KEY,
  alias VARCHAR(100) UNIQUE NOT NULL,
  canonical_name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON location_aliases(alias);
```

### Step A5 — Seed aliases

```sql
INSERT INTO location_aliases (alias, canonical_name) VALUES
  -- City abbreviations
  ('hn', 'Hà Nội'),
  ('hp', 'Hải Phòng'),
  ('sg', 'Hồ Chí Minh'),
  ('hcm', 'Hồ Chí Minh'),
  ('nb', 'Ninh Bình'),
  ('dn', 'Đà Nẵng'),
  ('hl', 'Hạ Long'),
  ('ha long', 'Hạ Long'),
  -- POI short names
  ('bd', 'Chùa Bái Đính'),
  ('bai dinh', 'Chùa Bái Đính'),
  ('ta', 'Tràng An'),
  ('trang an', 'Tràng An'),
  ('tc', 'Tam Cốc'),
  ('tam coc', 'Tam Cốc'),
  ('thai vi', 'Đền Thái Vi'),
  ('den thai vi', 'Đền Thái Vi'),
  ('hang mua', 'Hang Múa'),
  ('hue', 'Huế'),
  ('sapa', 'Sapa'),
  ('sa pa', 'Sapa'),
  ('pho co hoi an', 'Phố cổ Hội An'),
  ('hoi an', 'Phố cổ Hội An')
ON CONFLICT (alias) DO NOTHING;
```

---

## Phase B: Distance Merge into GET_DIRECTIONS (0 new nodes, 3 modified)

### Step B1 — Modify `Fn_DetectIntentRule`

Add distance regex block BETWEEN opening hours (#3) and existing direction capture (#4).

New block at priority position #4 (existing direction moves to #5):

```javascript
// 4. GET_DIRECTIONS — distance mode (NEW)
// Keywords: "bao xa", "khoảng cách", "mấy km", "cách bao xa"
const distanceKeywords = /bao xa|khoảng cách|khoang cach|bao nhiêu km|mấy km|may km|cách bao xa|cach bao xa/;
if (distanceKeywords.test(msg)) {
  // If directions keywords also present → user wants full directions, skip distance-only
  if (/chỉ đường|chi duong|đường đi|duong di|chỉ.*đường/i.test(msg)) {
    // Fall through — directions regex (#5) will catch it with _routeMode: 'full'
  } else {
    // Try to capture origin + destination from "từ...đến" pattern
    const distDirMatch = msg.match(/từ\s+(.+?)\s+đến\s+(.+)/);
    if (distDirMatch) {
      // Guard: multi-destination ("Hải Phòng và Quảng Ninh") → fall through to LLM
      if (distDirMatch[2].includes(' và ') || distDirMatch[2].includes(' va ')) {
        return { ...$json, _ruleMatched: false };
      }
      return {
        ...$json,
        intent: 'GET_DIRECTIONS',
        _ruleMatched: true,
        _routeMode: 'distance_only',
        entity_origin: distDirMatch[1].trim(),
        entity_destination: distDirMatch[2].trim(),
        entity: null
      };
    }
    // Distance keyword WITHOUT "từ...đến" → fall through to LLM
    // (can't determine origin/dest from "bao xa hn hp" alone)
  }
}
```

Priority order becomes: Weather → Ticket → Hours → **Distance** → Directions → Nearby → Tour

Existing direction regex (#5) adds default `_routeMode: 'full'`:

```javascript
// 5. GET_DIRECTIONS — full mode (existing, updated)
const dirMatch = msg.match(/từ\s+(.+?)\s+đến\s+(.+)/);
if (dirMatch) {
  return {
    ...$json,
    intent: 'GET_DIRECTIONS',
    _ruleMatched: true,
    _routeMode: 'full',  // ← NEW: explicit mode
    entity_origin: dirMatch[1].trim(),
    entity_destination: dirMatch[2].trim(),
    entity: null
  };
}
if (/chỉ đường|chi duong|đường đi|duong di|directions/.test(msg)) {
  return { ...$json, intent: 'GET_DIRECTIONS', _ruleMatched: true, _routeMode: 'full', entity: null, entity_origin: null, entity_destination: null };
}
```

### Step B2 — Modify `Fn_PrepDirections`

Add 2 guards + pass `_routeMode`:

```javascript
// Node 31: Fn_PrepDirections — UPDATED
function slugify(text) { /* ... existing ... */ }

const originSlug = slugify($json.entity_origin || '');
const destSlug = slugify($json.entity_destination || '');

// Guard 1 — Origin = Destination
if (originSlug && destSlug && originSlug === destSlug) {
  return {
    success: false,
    type: 'error',
    data: null,
    message: 'Hai địa điểm trùng nhau. Bạn muốn đi từ đâu đến đâu?'
  };
}

return {
  ...$json,
  origin_slug: originSlug,
  dest_slug: destSlug,
  origin_display: $json.entity_origin || '',
  dest_display: $json.entity_destination || '',
  _routeMode: $json._routeMode || 'full'  // ← NEW: pass through
};
```

### Step B3 — Modify `Fn_FormatDirections`

Mode-aware response formatting:

```javascript
// Inside existing try block, after dirData is built:

const routeMode = coordData._routeMode || coordData.routeMode || 'full';

if (routeMode === 'distance_only') {
  // Distance-only: no maps_link, type = 'distance'
  const msg = `Khoảng cách từ ${dirData.origin.name} đến ${dirData.destination.name}: ${dirData.distance_km} km, khoảng ${dirData.duration_min} phút lái xe.`;
  return { success: true, type: 'distance', data: dirData, message: msg };
} else {
  // Full directions: include maps_link, type = 'directions'
  const mapsLink = `https://www.google.com/maps/dir/${dirData.origin.lat},${dirData.origin.lng}/${dirData.destination.lat},${dirData.destination.lng}`;
  dirData.maps_link = mapsLink;
  const msg = `Từ ${dirData.origin.name} đến ${dirData.destination.name}: ${dirData.distance_km} km, khoảng ${dirData.duration_min} phút lái xe.`;
  return { success: true, type: 'directions', data: dirData, message: msg };
}
```

---

## Phase C: Country Restriction on Geocode (0 new nodes, 2 modified)

### Step C1 — Modify `HTTP_HEREGeocode` URL

Append `&in=countryCode:VNM`:

```
BEFORE:
=https://geocode.search.hereapi.com/v1/geocode?q={{ encodeURIComponent($json.weatherLocation || $json.entity || '') }}&limit=1&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0

AFTER:
=https://geocode.search.hereapi.com/v1/geocode?q={{ encodeURIComponent($json.weatherLocation || $json.entity || '') }}&limit=1&in=countryCode:VNM&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0
```

### Step C2 — Modify `HTTP_HEREGeocode_Direction` URL

Append `&in=countryCode:VNM`:

```
BEFORE:
=https://geocode.search.hereapi.com/v1/geocode?q={{ encodeURIComponent($json._needOriginGeocode ? $json.origin.name : $json._needDestGeocode ? $json.destination.name : '') }}&limit=1&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0

AFTER:
=https://geocode.search.hereapi.com/v1/geocode?q={{ encodeURIComponent($json._needOriginGeocode ? $json.origin.name : $json._needDestGeocode ? $json.destination.name : '') }}&limit=1&in=countryCode:VNM&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0
```

**Why**: Prevents HERE from resolving "Sơn Tây" to a location outside Vietnam. Zero risk — only restricts search scope.

---

## Phase D: Global Alias Resolution (2 new nodes, 1 re-wire)

### Step D1 — New node `DB_ResolveAliases`

- **Type**: `n8n-nodes-base.postgres`
- **Position**: Between `Fn_ValidateContext` and `Switch_Intent` (x ≈ 1650, y ≈ 300)
- **Query**:

```sql
SELECT alias, canonical_name FROM location_aliases
WHERE alias IN (
  LOWER(TRIM('{{ $json.entity || '' }}')),
  LOWER(TRIM('{{ $json.entity_origin || '' }}')),
  LOWER(TRIM('{{ $json.entity_destination || '' }}'))
)
```

- `alwaysOutputData: true`, `onError: "continueRegularOutput"`, credential `wanVbO3iF1oBHLKq`
- Mode: `executeQuery`, returns 0-3 rows
- **If no aliases match**: Returns empty/null item → `Fn_ApplyAliases` passes through unchanged

### Step D2 — New node `Fn_ApplyAliases`

- **Type**: `n8n-nodes-base.code`
- **Mode**: `runOnceForAllItems`
- **Position**: x ≈ 1870, y ≈ 300
- **Code**:

```javascript
// Node: Fn_ApplyAliases
// Resolve entity aliases from DB lookup
// runOnceForAllItems — receives alias rows from DB_ResolveAliases

const items = $input.all();
const aliasRows = items.map(i => i.json).filter(r => r && r.alias && r.canonical_name);

// Get upstream data from Fn_ValidateContext
let upstream;
try { upstream = $('Fn_ValidateContext').first()?.json; } catch(e) { upstream = null; }
if (!upstream) {
  // No upstream data — pass through first item as-is
  return items.length > 0 ? items[0].json : {};
}

// No alias rows found → return upstream unchanged (avoid data loss)
if (!aliasRows.length) {
  return upstream;
}

// Build alias → canonical map
const aliasMap = {};
for (const row of aliasRows) {
  aliasMap[row.alias.toLowerCase().trim()] = row.canonical_name;
}

// Apply aliases if matched
const result = { ...upstream };

if (result.entity) {
  const key = result.entity.toLowerCase().trim();
  if (aliasMap[key]) {
    result._originalEntity = result.entity;
    result.entity = aliasMap[key];
  }
}

if (result.entity_origin) {
  const key = result.entity_origin.toLowerCase().trim();
  if (aliasMap[key]) {
    result._originalOrigin = result.entity_origin;
    result.entity_origin = aliasMap[key];
  }
}

if (result.entity_destination) {
  const key = result.entity_destination.toLowerCase().trim();
  if (aliasMap[key]) {
    result._originalDestination = result.entity_destination;
    result.entity_destination = aliasMap[key];
  }
}

return result;
```

### Step D3 — Re-wire connections

```
BEFORE:
Fn_ValidateContext → Switch_Intent

AFTER:
Fn_ValidateContext → DB_ResolveAliases → Fn_ApplyAliases → Switch_Intent
```

- Remove: `Fn_ValidateContext` main[0] → `Switch_Intent`
- Add: `Fn_ValidateContext` main[0] → `DB_ResolveAliases`
- Add: `DB_ResolveAliases` main[0] → `Fn_ApplyAliases`
- Add: `Fn_ApplyAliases` main[0] → `Switch_Intent`

**Benefits**: Resolves "từ hn đến hp" → entity_origin becomes "Hà Nội", entity_destination becomes "Hải Phòng" BEFORE slugifying. Works for ALL 7 intents automatically.

---

## Phase E: HERE Discover Fallback for GET_PLACE_INFO (3 new nodes, 1 re-wire)

### Step E1 — New node `IF_PlaceFound`

- **Type**: `n8n-nodes-base.if`
- **Position**: Between `DB_LookupPlace` and `Fn_FormatPlaceInfo` (x ≈ 2350, y ≈ -200)
- **Condition**: `{{ $json.id }}` is not empty (more robust than `name` — edge case: row exists but name is empty string)
  - TRUE → `Fn_FormatPlaceInfo` (existing path, no change)
  - FALSE → `HTTP_HEREDiscover` (new fallback path)

### Step E2 — New node `HTTP_HEREDiscover`

- **Type**: `n8n-nodes-base.httpRequest`
- **Position**: x ≈ 2570, y ≈ -100
- **Method**: GET
- **URL**:

```
=https://discover.search.hereapi.com/v1/discover?q={{ encodeURIComponent($('Fn_PrepPlaceInfo').item.json.entityDisplay || '') }}&at=20.25,105.97&in=countryCode:VNM&limit=1&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0
```

- `at=20.25,105.97` = Ninh Bình center (bias results toward local area)
- `in=countryCode:VNM` = restrict to Vietnam
- Timeout 5s, `onError: "continueRegularOutput"`

### Step E3 — New node `Fn_CacheAndFormat`

- **Type**: `n8n-nodes-base.code`
- **Mode**: `runOnceForEachItem`
- **Position**: x ≈ 2790, y ≈ -100
- **Code**:

```javascript
// Node: Fn_CacheAndFormat
// Parse HERE Discover response, format as place_info
// runOnceForEachItem

try {
  const items = $json?.items;
  let prep;
  try { prep = $('Fn_PrepPlaceInfo').item.json; } catch(e) { prep = {}; }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return {
      success: false,
      type: 'not_found',
      data: null,
      message: 'Không tìm thấy thông tin về ' + (prep.entityDisplay || 'địa điểm này') + '.'
    };
  }

  const place = items[0];
  const pos = place?.position;
  const addr = place?.address;
  const cats = place?.categories;

  const data = {
    name: place.title || prep.entityDisplay || 'Không rõ',
    description: addr?.label || '',
    coordinates: (pos?.lat != null && pos?.lng != null) ? { lat: pos.lat, lng: pos.lng } : null,
    category: cats?.[0]?.name || null,
    address: addr?.label || null,
    source: 'api',
    ticket_price: null,
    opening_hours: null
  };

  const msg = `${data.name}: ${data.description || 'Không có mô tả chi tiết.'}` +
    (data.category ? ` (Loại: ${data.category})` : '') +
    '\n\nLưu ý: Thông tin này từ nguồn bên ngoài, có thể không đầy đủ như dữ liệu chính thức.';

  return {
    success: true,
    type: 'place_info',
    data: data,
    message: msg,
    _cacheInsert: {
      name: data.name,
      slug: null, // Will be slugified if cached
      latitude: pos?.lat || null,
      longitude: pos?.lng || null,
      description: data.description,
      data_source: 'api',
      province: addr?.county || addr?.state || null
    }
  };
} catch(e) {
  return {
    success: false,
    type: 'error',
    data: null,
    message: 'Lỗi khi tra cứu thông tin địa điểm từ nguồn bên ngoài.'
  };
}
```

### Step E4 — Re-wire connections

```
BEFORE:
DB_LookupPlace → Fn_FormatPlaceInfo ──┬──→ HTTP_ResponseComposer
                                       └──→ Fn_BuildFinalResponse

AFTER:
DB_LookupPlace → IF_PlaceFound
  TRUE  → Fn_FormatPlaceInfo ──┬──→ HTTP_ResponseComposer
                                └──→ Fn_BuildFinalResponse
  FALSE → HTTP_HEREDiscover → Fn_CacheAndFormat ──┬──→ HTTP_ResponseComposer
                                                    └──→ Fn_BuildFinalResponse
```

- Remove: `DB_LookupPlace` main[0] → `Fn_FormatPlaceInfo`
- Add: `DB_LookupPlace` main[0] → `IF_PlaceFound`
- Add: `IF_PlaceFound` main[0] (TRUE) → `Fn_FormatPlaceInfo`
- Add: `IF_PlaceFound` main[1] (FALSE) → `HTTP_HEREDiscover`
- Add: `HTTP_HEREDiscover` main[0] → `Fn_CacheAndFormat`
- Add: `Fn_CacheAndFormat` main[0] → `HTTP_ResponseComposer`
- Add: `Fn_CacheAndFormat` main[0] → `Fn_BuildFinalResponse`

**Fn_FormatPlaceInfo** existing dual-wire connections remain unchanged.

---

## Phase F: Selective Fallback for OPENING_HOURS & NEARBY (7 new nodes, 2 re-wires)

> **Design Principle**: Fallback chỉ khi có external source đáng tin. GET_TICKET_PRICE (không có API nào trả giá vé) và SEARCH_TOUR (business data) **không fallback**.

### Step F1 — New node `IF_HoursFound`

- **Type**: `n8n-nodes-base.if`
- **Position**: Between `DB_LookupOpenHours` and `Fn_FormatOpenHours` (x ≈ 2350, y ≈ 0)
- **Condition**: `{{ $json.day_of_week }}` exists (DB returned opening_hours rows)
  - TRUE → `Fn_FormatOpenHours` (existing path, no change)
  - FALSE → `HTTP_HEREDiscover_Hours` (fallback path)

### Step F2 — New node `HTTP_HEREDiscover_Hours`

- **Type**: `n8n-nodes-base.httpRequest`
- **Position**: x ≈ 2570, y ≈ 80
- **Method**: GET
- **URL**:

```
=https://discover.search.hereapi.com/v1/discover?q={{ encodeURIComponent($('Fn_PrepOpenHours').item.json.entityDisplay || '') }}&at=20.25,105.97&in=countryCode:VNM&limit=1&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0
```

- Timeout 5s, `onError: "continueRegularOutput"`

### Step F3 — New node `Fn_FormatHoursFromAPI`

- **Type**: `n8n-nodes-base.code`
- **Mode**: `runOnceForEachItem`
- **Position**: x ≈ 2790, y ≈ 80
- **Code**:

```javascript
// Node: Fn_FormatHoursFromAPI
// Parse HERE Discover response for opening hours
// runOnceForEachItem

try {
  const hereItems = $json?.items;
  let prep;
  try { prep = $('Fn_PrepOpenHours').item.json; } catch(e) { prep = {}; }

  if (!hereItems || !Array.isArray(hereItems) || hereItems.length === 0) {
    return {
      success: false, type: 'not_found', data: null,
      message: 'Không tìm thấy giờ mở cửa của ' + (prep.entityDisplay || 'địa điểm này') + '.'
    };
  }

  const place = hereItems[0];
  const placeName = place.title || prep.entityDisplay || 'Không rõ';
  const oh = place.openingHours;

  if (!oh || (!oh.text && !oh.isOpen)) {
    return {
      success: false, type: 'not_found', data: null,
      message: 'Không tìm thấy giờ mở cửa của ' + placeName + '.'
    };
  }

  // Build schedule from HERE text array
  const scheduleText = oh.text ? oh.text.join('\n') : '';
  const isOpenNow = oh.isOpen != null ? (oh.isOpen ? 'Đang mở cửa' : 'Đang đóng cửa') : 'Không rõ';

  const msg = placeName + ' — Hiện tại: ' + isOpenNow + '.'
    + (scheduleText ? '\n' + scheduleText : '')
    + '\n\nLưu ý: Giờ mở cửa lấy từ nguồn bên ngoài, có thể không chính xác.';

  return {
    success: true, type: 'opening_hours',
    data: {
      name: placeName,
      today: isOpenNow,
      schedule: scheduleText,
      source: 'api'
    },
    message: msg
  };
} catch(e) {
  return { success: false, type: 'error', data: null, message: 'Lỗi khi tra cứu giờ mở cửa từ nguồn bên ngoài.' };
}
```

### Step F4 — Re-wire OPENING_HOURS connections

```
BEFORE:
DB_LookupOpenHours → Fn_FormatOpenHours ──┬──→ HTTP_ResponseComposer
                                            └──→ Fn_BuildFinalResponse

AFTER:
DB_LookupOpenHours → IF_HoursFound
  TRUE  → Fn_FormatOpenHours ──┬──→ HTTP_ResponseComposer
                                └──→ Fn_BuildFinalResponse
  FALSE → HTTP_HEREDiscover_Hours → Fn_FormatHoursFromAPI ──┬──→ HTTP_ResponseComposer
                                                              └──→ Fn_BuildFinalResponse
```

---

### Step F5 — New node `IF_NearbyEnough`

- **Type**: `n8n-nodes-base.code`
- **Mode**: `runOnceForAllItems`
- **Position**: Between `Fn_FormatNearby` output and `HTTP_ResponseComposer` (x ≈ 2900, y ≈ 600)
- **Why Code instead of IF**: Need to count rows AND branch — IF node can't count array length from multi-row input
- **Code**:

```javascript
// Node: IF_NearbyEnough
// Check if DB returned >= 3 results. If not, flag for HERE fallback.
// runOnceForAllItems

const items = $input.all();
const formatResult = items[0]?.json;

// If Fn_FormatNearby already succeeded with enough data → pass through
if (formatResult?.success === true && formatResult?.data?.places?.length >= 3) {
  return { ...formatResult, _needNearbyFallback: false };
}

// Not enough results → flag for fallback
let prep;
try { prep = $('Fn_PrepNearby').first()?.json; } catch(e) { prep = {}; }

return {
  ...formatResult,
  _needNearbyFallback: true,
  _nearbyEntity: prep?.entityDisplay || '',
  _nearbyLat: prep?._gpsLat || null,
  _nearbyLng: prep?._gpsLng || null
};
```

### Step F6 — New node `IF_NeedNearbyFallback`

- **Type**: `n8n-nodes-base.if`
- **Position**: x ≈ 3100, y ≈ 600
- **Condition**: `{{ $json._needNearbyFallback }}` equals `true`
  - TRUE → `HTTP_HEREDiscover_Nearby` (fallback)
  - FALSE → `HTTP_ResponseComposer` + `Fn_BuildFinalResponse` (pass through)

### Step F7 — New node `HTTP_HEREDiscover_Nearby`

- **Type**: `n8n-nodes-base.httpRequest`
- **Position**: x ≈ 3320, y ≈ 650
- **Method**: GET
- **URL**:

```
=https://discover.search.hereapi.com/v1/discover?q=tourist+attraction&at={{ $json._nearbyLat || 20.25 }},{{ $json._nearbyLng || 105.97 }}&in=countryCode:VNM&limit=5&apiKey=KEdGMWp6Tp_mpBomQv2hmZxHoVJhzoO8jTHaweW7wV0
```

- `q=tourist+attraction` — category filter to avoid generic POI (ATM, gas station)
- GPS coords from upstream prep node, default to Ninh Bình center
- Timeout 5s, `onError: "continueRegularOutput"`

### Step F8 — New node `Fn_MergeNearbyResults`

- **Type**: `n8n-nodes-base.code`
- **Mode**: `runOnceForEachItem`
- **Position**: x ≈ 3540, y ≈ 650
- **Code**:

```javascript
// Node: Fn_MergeNearbyResults
// Merge HERE Discover nearby with existing DB results (if any)
// Filter by tourist-relevant categories only
// runOnceForEachItem

try {
  const hereItems = $json?.items;
  let prep;
  try { prep = $('Fn_PrepNearby').first()?.json; } catch(e) { prep = {}; }
  const refName = prep?.entityDisplay || 'đây';

  // Get existing DB results from IF_NearbyEnough
  let existingPlaces = [];
  try {
    const upstream = $('IF_NearbyEnough').first()?.json;
    if (upstream?.data?.places) {
      existingPlaces = upstream.data.places;
    }
  } catch(e) {}

  // Category whitelist for tourist relevance
  const allowedCategories = [
    'tourist attraction', 'landmark', 'temple', 'museum',
    'natural feature', 'park', 'historical', 'cultural',
    'religious', 'monument', 'scenic', 'pagoda', 'church',
    'sightseeing', 'leisure', 'recreation'
  ];

  // Parse HERE items with category filter
  const herePlaces = [];
  if (hereItems && Array.isArray(hereItems)) {
    for (const item of hereItems) {
      const cats = item.categories || [];
      const catNames = cats.map(c => (c.name || '').toLowerCase());

      // Filter: at least one category matches whitelist
      const isRelevant = catNames.some(cn =>
        allowedCategories.some(ac => cn.includes(ac))
      );
      if (!isRelevant && cats.length > 0) continue;

      const pos = item.position;
      herePlaces.push({
        name: item.title || 'Không rõ',
        slug: null,
        description: item.address?.label || '',
        place_type: catNames[0] || 'landmark',
        distance_km: item.distance ? (item.distance / 1000).toFixed(2) : null,
        source: 'api'
      });
    }
  }

  // Merge: DB first, then HERE (deduplicate by name)
  const existingNames = new Set(existingPlaces.map(p => p.name.toLowerCase()));
  const merged = [...existingPlaces];
  for (const hp of herePlaces) {
    if (!existingNames.has(hp.name.toLowerCase())) {
      merged.push(hp);
      existingNames.add(hp.name.toLowerCase());
    }
  }

  if (merged.length === 0) {
    return {
      success: false, type: 'not_found', data: null,
      message: 'Không tìm thấy địa điểm gần ' + refName + '.'
    };
  }

  let msg = 'Các địa điểm gần ' + refName + ':\n';
  merged.forEach((p, i) => {
    msg += (i + 1) + '. ' + p.name;
    if (p.distance_km) msg += ' — ' + p.distance_km + ' km';
    if (p.source === 'api') msg += ' (nguồn bên ngoài)';
    msg += '\n';
  });

  const hasApiData = merged.some(p => p.source === 'api');
  if (hasApiData) {
    msg += '\nLưu ý: Một số kết quả từ nguồn bên ngoài.';
  }

  return {
    success: true, type: 'nearby',
    data: { ref_name: refName, places: merged },
    message: msg.trim()
  };
} catch(e) {
  return { success: false, type: 'error', data: null, message: 'Lỗi khi tìm địa điểm lân cận.' };
}
```

### Step F9 — Re-wire SEARCH_NEARBY connections

```
BEFORE:
Fn_FormatNearby ──┬──→ HTTP_ResponseComposer
                   └──→ Fn_BuildFinalResponse

AFTER:
Fn_FormatNearby → IF_NearbyEnough → IF_NeedNearbyFallback
  TRUE  (need fallback) → HTTP_HEREDiscover_Nearby → Fn_MergeNearbyResults ──┬──→ HTTP_ResponseComposer
                                                                              └──→ Fn_BuildFinalResponse
  FALSE (enough data)   ──┬──→ HTTP_ResponseComposer
                           └──→ Fn_BuildFinalResponse
```

- Remove: `Fn_FormatNearby` main[0] → `HTTP_ResponseComposer`, `Fn_BuildFinalResponse`
- Add: `Fn_FormatNearby` main[0] → `IF_NearbyEnough`
- Add: `IF_NearbyEnough` main[0] → `IF_NeedNearbyFallback`
- Add: `IF_NeedNearbyFallback` main[0] (TRUE) → `HTTP_HEREDiscover_Nearby`
- Add: `IF_NeedNearbyFallback` main[1] (FALSE) → `HTTP_ResponseComposer`, `Fn_BuildFinalResponse`
- Add: `HTTP_HEREDiscover_Nearby` main[0] → `Fn_MergeNearbyResults`
- Add: `Fn_MergeNearbyResults` main[0] → `HTTP_ResponseComposer`, `Fn_BuildFinalResponse`

---

### Fallback Policy Summary

| Intent | Fallback? | Lý do |
|--------|-----------|-------|
| GET_PLACE_INFO | ✅ Phase E | HERE Discover có full POI data |
| GET_OPENING_HOURS | ✅ Phase F | HERE Discover có `openingHours` field |
| SEARCH_NEARBY | ✅ Phase F | HERE Discover nearby có POI + category filter |
| GET_WEATHER | ❌ Không | Không phụ thuộc DB — đã dùng external API |
| GET_DIRECTIONS | ❌ Không | Đã có geocode fallback trong pipeline |
| GET_TICKET_PRICE | ❌ Không | Không có external API nào trả giá vé |
| SEARCH_TOUR | ❌ Không | Business data — không có external source |

---

## Phase Summary

| Phase | New Nodes | Modified Nodes | Files Changed |
|-------|-----------|----------------|---------------|
| A (Schema) | 0 | 0 | +1 SQL migration |
| B (Distance merge) | 0 | 3 | `Fn_DetectIntentRule`, `Fn_PrepDirections`, `Fn_FormatDirections` |
| C (Country filter) | 0 | 2 | `HTTP_HEREGeocode`, `HTTP_HEREGeocode_Direction` |
| D (Alias resolution) | 2 | 0 | +`DB_ResolveAliases`, +`Fn_ApplyAliases`, re-wire |
| E (HERE Discover) | 3 | 0 | +`IF_PlaceFound`, +`HTTP_HEREDiscover`, +`Fn_CacheAndFormat`, re-wire |
| F (Hours + Nearby fallback) | 7 | 0 | +`IF_HoursFound`, +`HTTP_HEREDiscover_Hours`, +`Fn_FormatHoursFromAPI`, +`IF_NearbyEnough`, +`IF_NeedNearbyFallback`, +`HTTP_HEREDiscover_Nearby`, +`Fn_MergeNearbyResults`, re-wire x2 |
| **Total** | **12** | **5** | **52 → 64 nodes, +1 SQL** |

---

## Bad Case Coverage

| Bad Case | Guard | Phase |
|----------|-------|-------|
| ❌ Regex bắt sai entity ("Hải Phòng và Hạ Long") | LLM fallback — regex `từ...đến` captures greedily but LLM handles multi-dest | B1 |
| ❌ HERE trả sai tỉnh ("Sơn Tây") | `&in=countryCode:VNM` restricts to Vietnam | C |
| ❌ Intent conflict distance vs directions | Distance block excludes when `chỉ đường\|đường đi` also present → falls to directions regex (#5) with `_routeMode: 'full'` | B1 |
| ❌ API cost double | Same pipeline, 0 extra API calls — ORS returns distance + duration already | B3 |
| ❌ Alias "hn" → fail | DB `location_aliases` resolves before slugify | D |
| ❌ Origin = destination | Guard in `Fn_PrepDirections` — short-circuits before any API call | B2 |
| ❌ Silent wrong distance (Sơn Tây wrong province) | VNM country filter + future `province` column for disambiguation | C + A2 |
| ❌ DB miss → "not found" for legitimate place | HERE Discover fallback for GET_PLACE_INFO | E |
| ❌ DB miss giờ mở cửa → "không tìm thấy" | HERE Discover `openingHours` fallback cho GET_OPENING_HOURS | F |
| ❌ DB nearby trả ít kết quả (< 3) | HERE Discover nearby + category filter, merge với DB results | F |
| ❌ HERE nearby trả POI không liên quan (ATM, gas) | Category whitelist filter: chỉ tourist attraction, landmark, temple, museum... | F |

---

## Verification Test Cases

| # | Input | Expected Behavior |
|---|-------|-------------------|
| 1 | `"Khoảng cách từ Tràng An đến Bái Đính"` | `type: 'distance'`, km + minutes, NO maps_link |
| 2 | `"Chỉ đường từ Tràng An đến Bái Đính"` | `type: 'directions'`, km + minutes + maps_link (existing) |
| 3 | `"Từ Tràng An đến Tràng An"` | Error: "Hai địa điểm trùng nhau" |
| 4 | `"Thời tiết nb"` | Alias resolves nb → Ninh Bình → weather result |
| 5 | `"Khoảng cách từ hn đến hp"` | Alias resolves → Hà Nội to Hải Phòng → distance |
| 6 | `"Chỉ đường từ Sơn Tây đến Ninh Bình"` | HERE resolves Sơn Tây within VNM only |
| 7 | `"Nhà thờ lớn Hà Nội có gì hay?"` | DB miss → HERE Discover → place_info with `source: 'api'` |
| 8 | `"Bao xa từ Tam Cốc đến Hang Múa?"` | Distance mode via regex → `type: 'distance'` |
| 9 | `"Giờ mở cửa Nhà thờ lớn Hà Nội?"` | DB miss → HERE Discover → `openingHours` + disclaimer |
| 10 | `"Gần Nhà thờ lớn có gì?"` | DB miss (< 3) → HERE Discover nearby → merged + category filter |

---

## Connection Graph (Updated)

```
Webhook_Receive
  → Fn_ValidateInput
    → IF_InputValid
      TRUE  → Fn_DetectIntentRule
                → IF_RuleMatched
                  TRUE  → Fn_ValidateContext → DB_ResolveAliases → Fn_ApplyAliases → Switch_Intent
                  FALSE → HTTP_LLMClassify → Fn_NormalizeLLM → Fn_ValidateContext → DB_ResolveAliases → Fn_ApplyAliases → Switch_Intent
      FALSE → Respond_InvalidInput

Switch_Intent
  [0] GET_PLACE_INFO    → Fn_PrepPlaceInfo → DB_LookupPlace → IF_PlaceFound
                            TRUE  → Fn_FormatPlaceInfo ──┬──→ HTTP_ResponseComposer
                                                          └──→ Fn_BuildFinalResponse
                            FALSE → HTTP_HEREDiscover → Fn_CacheAndFormat ──┬──→ HTTP_ResponseComposer
                                                                             └──→ Fn_BuildFinalResponse
  [1] GET_OPENING_HOURS → Fn_PrepOpenHours → DB_LookupOpenHours → IF_HoursFound
                            TRUE  → Fn_FormatOpenHours ──┬──→ HTTP_ResponseComposer
                                                          └──→ Fn_BuildFinalResponse
                            FALSE → HTTP_HEREDiscover_Hours → Fn_FormatHoursFromAPI ──┬──→ HTTP_ResponseComposer
                                                                                       └──→ Fn_BuildFinalResponse
  [2] GET_TICKET_PRICE  → (unchanged — no external source for ticket prices)
  [3] GET_WEATHER       → (unchanged, but HTTP_HEREGeocode has &in=countryCode:VNM)
  [4] SEARCH_NEARBY     → Fn_PrepNearby → IF_NearbyGPS → [DB_NearbyByGPS | DB_NearbyPlaces] → Fn_FormatNearby
                          → IF_NearbyEnough → IF_NeedNearbyFallback
                            TRUE  → HTTP_HEREDiscover_Nearby → Fn_MergeNearbyResults ──┬──→ HTTP_ResponseComposer
                                                                                        └──→ Fn_BuildFinalResponse
                            FALSE ──┬──→ HTTP_ResponseComposer
                                     └──→ Fn_BuildFinalResponse
  [5] GET_DIRECTIONS    → Fn_PrepDirections(+guard+mode) → DB_DirectionCoords → Fn_ResolveDirectionCoords → IF_AllCoordsResolved
                            TRUE  → HTTP_ORS_Route
                            FALSE → HTTP_HEREGeocode_Direction(+VNM) → Fn_ParseDirectionGeocode → HTTP_ORS_Route
                          → Fn_FormatDirections(+mode-aware) ──┬──→ HTTP_ResponseComposer
                                                                └──→ Fn_BuildFinalResponse
  [6] SEARCH_TOUR       → (unchanged)
  [extra] FALLBACK      → Fn_FallbackResponse → Fn_BuildFinalResponse

HTTP_ResponseComposer → Fn_BuildFinalResponse
Fn_BuildFinalResponse → [Respond_Final, DB_WriteLog]
ErrorTrigger → Respond_SystemError
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Alias DB query adds latency | ~2ms on local Postgres — negligible vs 20s LLM timeout |
| HERE Discover returns non-POI result | `limit=1` + `at=20.25,105.97` biases to Ninh Bình area |
| HERE Discover API changes | `onError: continueRegularOutput` — fallback gracefully |
| Alias table grows large | Index on `alias` column — O(log n) lookup |
| Distance mode confuses LLM composer | `type: 'distance'` (not 'directions') → LLM system prompt can differentiate |
| Multi-destination distance ("HP và QN") crashes ORS | Guard: `distDirMatch[2].includes(' và ')` → `_ruleMatched: false` → LLM fallback |
| Distance + directions keywords in same sentence | Distance block checks for `chỉ đường\|đường đi` first — if present, skips to directions regex |
| `_routeMode` not passed through pipeline | Spread via `...prep` in Fn_ResolveDirectionCoords — verified in existing code |
| HERE opening hours outdated | Disclaimer in response: "Giờ mở cửa lấy từ nguồn bên ngoài, có thể không chính xác" |
| HERE nearby returns non-tourist POI | Category whitelist filter — only tourist attraction, landmark, temple, museum, etc. |
| Nearby merge duplicates | Deduplicate by name (case-insensitive) — DB results take priority |
| HERE API cost increase from 3 intents | Only triggered on DB miss — majority of queries hit DB cache first |

---

## Implementation Order

1. **Phase A** first — SQL migration (no workflow changes, safe to run anytime)
2. **Phase C** second — URL-only changes, zero risk, instant improvement
3. **Phase B** third — Code changes in 3 existing nodes, self-contained in directions branch
4. **Phase D** fourth — 2 new nodes + re-wire, affects all intents (test all 7 after)
5. **Phase E** fifth — 3 new nodes + re-wire, only affects GET_PLACE_INFO branch
6. **Phase F** last — 6 new nodes + 2 re-wires, affects GET_OPENING_HOURS and SEARCH_NEARBY branches
