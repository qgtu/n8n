# Plan: Port n8n Workflow → Production Node.js Backend

## Goal

Bỏ n8n. Tách toàn bộ logic từ `rule_first_travel_bot.json` sang `main_travel_assistant/` (Node.js TypeScript). Backend xử lý 7 intents + FALLBACK, production-grade, không phụ thuộc n8n.

## Architecture Decisions

| Decision | Choice |
|----------|--------|
| LLM Fallback | **Port luôn** — OpenRouter Gemini 2.0 Flash (chỉ khi rule fails) |
| HERE API Fallback | **Port luôn** — Cache → DB → HERE chain |
| LLM Response Composer | **Skip** — template text |
| Cache | **In-memory Map+TTL** (upgrade Redis khi cần) |
| Logging | **Winston** (đã cài) |

## Architecture

```
Telegram → Route → Controller (ACK 200) → Pipeline → Intent Engine → Handler → Service (Cache→DB→API) → Format → Send
```

## Folder Structure

```
src/
 ├── server.ts
 ├── app.ts
 ├── routes/telegram.route.ts
 ├── controllers/telegram.controller.ts
 ├── core/
 │    pipeline.ts          # validate → classify → context gate → handle → log
 │    intent.engine.ts     # rule-first classifier
 │    context.ts           # per-intent data readiness gate
 ├── intents/
 │    placeInfo.ts, ticketPrice.ts, openingHours.ts,
 │    weather.ts, nearby.ts, directions.ts, tour.ts, fallback.ts
 ├── services/
 │    cache.ts, here.ts, weather.ts, directions.ts, tour.ts,
 │    session.ts, idempotency.ts, searchLog.ts
 ├── utils/
 │    normalize.ts, slugResolver.ts, parser.ts,
 │    validator.ts, logger.ts, http.ts
 ├── config/env.ts, db.ts
 └── types/index.ts
```

Old `shared/`, `intent/`, `handlers/`, `handleMessage.ts` → replaced. Old files stay as re-export barrels for backward compat.

## Intent UX Table

| Intent | Trigger | Required Context | Cache TTL |
|--------|---------|-----------------|-----------|
| GET_PLACE_INFO | tên địa điểm, "thông tin" | entity | 24h |
| GET_TICKET_PRICE | "giá vé", "bao nhiêu tiền" | entity | 24h |
| GET_OPENING_HOURS | "mở cửa", "giờ mở" | entity | 24h |
| GET_WEATHER | "thời tiết", "mưa", "nắng" | entity (default: Ninh Bình) | 10min |
| SEARCH_NEARBY | "gần tôi", "xung quanh" | entity | 30min |
| GET_DIRECTIONS | "từ...đến...", "chỉ đường" | entity_origin + entity_destination | 1h |
| SEARCH_TOUR | "tour", "\d+ ngày" | entity OR duration_days | 24h |
| UNKNOWN | no match | — | — |

## Fallback Chain per API

- **HERE_API_KEY**: Place Info, Geocode, Nearby, Opening Hours fallback, Ticket fallback
- **WEATHER_API_KEY**: Weather only. Timeout 3s. Graceful error on fail.
- **ORS_API_KEY**: Directions only. Timeout 3s. Graceful error on fail.
- **OPENROUTER_API_KEY**: LLM fallback khi rule fails. KHÔNG replace DB/API.

## Anti-Error Rules

1. No handler throws — always return structured response
2. All external API: timeout 3000ms, max 1 retry, catch riêng
3. DB down → skip DB → go direct to API fallback
4. Context gate BEFORE handler — không gọi API khi thiếu data
5. LLM KHÔNG override rule engine

## Execution

```
Phase 0 (types+utils) → Phase 1 (core) → Phase 2 (services) → Phase 3 (intents) → Phase 4 (wiring) → Phase 5 (logging)
```

## File Summary (22 files)

| # | File | Action |
|---|------|--------|
| 1 | `types/index.ts` | CREATE |
| 2 | `utils/logger.ts` | CREATE |
| 3 | `utils/http.ts` | CREATE |
| 4 | `utils/normalize.ts` | CREATE (rewrite) |
| 5 | `utils/slugResolver.ts` | CREATE (merge aliases+slugify) |
| 6 | `utils/parser.ts` | CREATE |
| 7 | `utils/validator.ts` | CREATE |
| 8 | `core/intent.engine.ts` | CREATE |
| 9 | `core/context.ts` | CREATE |
| 10 | `core/pipeline.ts` | CREATE |
| 11 | `services/cache.ts` | CREATE |
| 12 | `services/here.ts` | CREATE |
| 13 | `services/weather.ts` | CREATE |
| 14 | `services/directions.ts` | CREATE |
| 15 | `services/tour.ts` | CREATE |
| 16 | `services/searchLog.ts` | CREATE |
| 17 | `intents/placeInfo.ts` | CREATE |
| 18 | `intents/ticketPrice.ts` | CREATE |
| 19 | `intents/openingHours.ts` | CREATE |
| 20 | `intents/weather.ts` | CREATE |
| 21 | `intents/nearby.ts` | CREATE |
| 22 | `intents/directions.ts` | CREATE |
| 23 | `intents/tour.ts` | CREATE |
| 24 | `intents/fallback.ts` | CREATE |
| 25 | `controllers/telegram.controller.ts` | CREATE |
| 26 | `routes/telegram.route.ts` | CREATE |
| 27 | `app.ts` | REWRITE |
| 28 | `shared/types.ts` | EDIT → re-export barrel |
| 29 | `shared/logger.ts` | EDIT → re-export barrel |
