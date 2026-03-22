# n8n Hybrid Travel Assistant

Hệ thống trợ lý du lịch theo kiến trúc **Hybrid (Rule-first, AI-fallback)**, gồm:
- **n8n orchestration layer** (workflow + webhook)
- **Node.js/TypeScript backend** (`main_travel_assistant`) cho Telegram, NLP pipeline, DB và tích hợp API ngoài.

## 1) Kiến trúc tổng quan

### Hybrid principle
- **Rule-first**: ưu tiên luật/keyword/pattern để route intent nhanh, ổn định.
- **AI-fallback**: chỉ dùng khi rule không đủ tự tin.
- **Data readiness gate**: chỉ gọi tool/API khi đủ dữ liệu bắt buộc.

### Thành phần chính
- `main_travel_assistant/rule_first_travel_bot.json`: workflow n8n.
- `main_travel_assistant/src/`: backend xử lý Telegram + pipeline intent/entity.
- `schema.sql`, `sample_data.sql`: schema + dữ liệu mẫu PostgreSQL/PostGIS.

## 2) Yêu cầu môi trường

- Node.js `>=18.10.0` (khuyến nghị Node 18/20)
- PostgreSQL 15+ (khuyến nghị bật PostGIS)
- n8n `2.x`

## 3) Cấu trúc thư mục

```text
n8n/
├─ README.md
├─ README-MEMORY.md
├─ schema.sql
├─ sample_data.sql
├─ .env.example
└─ main_travel_assistant/
   ├─ .env.example
   ├─ package.json
   ├─ rule_first_travel_bot.json
   └─ src/
```

## 4) Cài đặt

### Root (n8n)
```bash
npm install
```

### Backend
```bash
cd main_travel_assistant
npm install
```

## 5) Cấu hình biến môi trường

Tạo file env từ file mẫu:

```bash
# tại thư mục root
Copy-Item .env.example .env

# tại thư mục backend
Copy-Item main_travel_assistant\.env.example main_travel_assistant\.env
```

Điền các biến quan trọng:
- DB: `DB_POSTGRESDB_*`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SECRET_TOKEN`, `TELEGRAM_WEBHOOK_URL`
- API keys: `HERE_API_KEY`, `WEATHER_API_KEY`/`OPENWEATHER_API_KEY`, `ORS_API_KEY`, `OPENROUTER_API_KEY`

## 6) Khởi tạo database

```bash
psql -U postgres -d disciplined_travel -f schema.sql
psql -U postgres -d disciplined_travel -f sample_data.sql
```

## 7) Chạy dự án

### Chạy n8n (root)
```bash
npm run start
```

### Chạy backend Telegram (terminal khác)
```bash
cd main_travel_assistant
npm run dev
```

Backend expose:
- `GET /health`
- `POST /api/webhook/telegram`

## 8) Import workflow n8n

1. Mở n8n UI (mặc định `http://localhost:5678`)
2. Import file: `main_travel_assistant/rule_first_travel_bot.json`
3. Cập nhật credential/API key trong workflow nếu cần
4. Activate workflow

## 9) Bảo mật `.env` (tránh đẩy nhầm secret)

Repository đã có rule ignore:
- `.env`
- `.env.*`
- cho phép `.env.example`

Checklist trước khi push:
```bash
git status
git --no-pager diff -- .env main_travel_assistant/.env
```

Nếu lỡ track `.env`:
```bash
git rm --cached .env
git rm --cached main_travel_assistant/.env
git commit -m "Stop tracking env files"
```

## 10) Tài liệu thêm

- `README-MEMORY.md`: hướng dẫn memory service và flow tham khảo.
