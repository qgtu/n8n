# 🧠 External Memory Service - Quick Start

## Cấu trúc

```
n8n/
├── memory-server.js         → Memory service (port 3333)
├── hybrid_travel_assistant_simple.json  → n8n workflow
└── package.json
```

## Bước 1: Cài dependencies

```bash
npm install express
```

## Bước 2: Chạy Memory Service

```bash
npm run memory
# hoặc: node memory-server.js
```

Output:
```
🧠 Memory Service running on http://localhost:3333
📊 Stats: http://localhost:3333/stats
```

## Bước 3: Import workflow vào n8n

1. Mở n8n: http://localhost:5678
2. Import **hybrid_travel_assistant_simple.json**
3. Activate workflow

## Bước 4: Test

```bash
curl -X POST http://localhost:5678/webhook/travel-form \
  -H "Content-Type: application/json" \
  -d '{"message": "thời tiết Hà Nội"}'
```

**Kết quả mong đợi:**
- Response có `sessionId`
- Check stats: `curl http://localhost:3333/stats` → thấy session được lưu

## Kiểm tra session persistence

**Test 1 - Tạo session mới:**
```bash
curl -X POST http://localhost:5678/webhook/travel-form \
  -H "Content-Type: application/json" \
  -d '{"message": "thời tiết Hà Nội"}'
```
→ Lấy `sessionId` từ response

**Test 2 - Dùng lại sessionId:**
```bash
curl -X POST http://localhost:5678/webhook/travel-form \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "sess_xxx", "message": "khách sạn gần đây"}'
```
→ Check `conversationCount` phải tăng lên

## Debug

**Check stats:**
```bash
curl http://localhost:3333/stats
```

**Test memory service riêng:**
```bash
# Save
curl -X POST http://localhost:3333/set \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test123","data":{"msg":"hello"},"ttl":30}'

# Get
curl -X POST http://localhost:3333/get \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test123"}'
```

## Workflow đã update

**Nodes đã thay:**
- ❌ MongoDB: Get Session → ✅ HTTP Request POST /get
- ❌ MongoDB: Update Session → ✅ HTTP Request POST /set
- ➕ Parse Memory Response (Code node)
- ➕ Pass Through Data (Code node)

**Flow:**
```
Webhook 
  → Extract SessionId 
  → Memory: Get Session (HTTP /get)
  → Parse Memory Response
  → Validate Input
  → Rule-Based Intent + Context Merge
  → Prepare MongoDB Update
  → Memory: Save Session (HTTP /set)
  → Pass Through Data
  → AI Fallback Check
  → ...
```

## Lưu ý

- **Memory service PHẢI chạy trước n8n test**
- TTL default: 1800 giây (30 phút)
- Port 3333 - đảm bảo không bị chiếm
- n8n 2.x không có `getWorkflowStaticData()` trong Code node → Phải dùng external service
- MongoDB node không có sẵn trong n8n 2.0.2 → Phải dùng HTTP Request

## Kiến trúc PRO

```
┌─────────┐     HTTP      ┌──────────────┐
│   n8n   │ ←──────────→  │ Memory Service│
│ (Port   │  POST /get    │  (Port 3333)  │
│  5678)  │  POST /set    │   Map + TTL   │
└─────────┘               └──────────────┘
     │
     └─→ Webhook, AI, APIs...
```

**n8n = Orchestrator, Memory = Service riêng** ✅
