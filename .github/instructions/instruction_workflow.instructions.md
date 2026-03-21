# n8n Hybrid Travel Assistant – Production Instruction

> **Target audience**: GitHub Copilot, AI code assistants, technical documentation  
> **Workflow type**: Hybrid (Rule-first, AI-fallback) automation  
> **Platform**: n8n (node-based workflow automation)

---

## 🎯 CORE PRINCIPLE: WHAT IS HYBRID (MUST UNDERSTAND)

### ❌ WRONG MENTAL MODEL (leads to brittle workflows):
- "Hybrid = AI matches user input to API fields and calls the API"
- "Entity maps directly to API parameters"
- "AI decides business logic"

### ✅ CORRECT MENTAL MODEL:
**Hybrid = Rule-first for FLOW CONTROL, AI-fallback for LANGUAGE UNDERSTANDING**

- **Rules** decide the workflow path (intent routing)
- **AI** only understands natural language when rules cannot
- **APIs** are tools behind the scenes, NOT the workflow center
- **Entities** are semantic data, NOT API fields

> **Key insight**: Workflow revolves around INTENT & DATA READINESS, not around API structure.

---

## 📊 HOW THE SYSTEM WORKS (Natural Language Description)

### 1️⃣ **Receive User Input**
- System receives a natural language query
- No assumption about which API the user "wants"

### 2️⃣ **Validate Input**
- Check: message exists, not empty, proper format
- ❌ If invalid → return error early
- ✅ If valid → proceed

### 3️⃣ **Intent Recognition (Rule-First)**
System uses simple rules:
- Keywords
- Patterns (regex)
- Predefined intent mapping

**Goal**: Fast, cheap, stable

### 4️⃣ **Evaluate Intent Confidence**
- If rule is clear → use it
- If ambiguous/multiple interpretations → delegate to AI

### 5️⃣ **AI Does ONLY 2 Things**
AI is used to:
1. Choose exactly ONE intent
2. Extract raw entities (text, not validated)

**AI MUST NOT**:
- Call APIs
- Map API fields
- Handle missing data
- Decide business logic

### 6️⃣ **Normalize Intent & Entities (CRITICAL)**
System must:
- Normalize intent to internal enum
- Keep entities semantic (not API-bound yet)

**Example**:
- "北京", "Beijing", "Bắc Kinh" → `location = "Beijing"`
- Has NOT called weather/map/hotel yet

### 7️⃣ **Check Data Readiness (MOST IMPORTANT GATE)**
System asks:
> "For this intent, what data is REQUIRED to proceed?"

- If missing → ask user (do NOT guess)
- If complete → allow next step

**This is the critical blocker preventing garbage API calls**

### 8️⃣ **Select Tool Based on Intent (Not Text)**
- Intent determines tool
- Entity is just tool input

**API is a utility, NOT the center**

### 9️⃣ **Call API + Handle Errors**
Handle:
- Timeout
- Missing fields
- Incomplete data

❌ Do NOT expose API errors to user  
✅ Convert to system state

### 🔟 **Normalize API Results**
- Remove excess data
- Map to common format
- Keep results neutral (API-agnostic)

### 1️⃣1️⃣ **Respond to User**
- Match original intent
- Do NOT expose API details
- Do NOT ask user to "rephrase for the API"

---

## 🏗️ WORKFLOW ARCHITECTURE (n8n Node Structure)

### **REQUIRED NODE SEQUENCE**:

```
1. Webhook Trigger
   ↓
2. Input Validation Node
   → Check: body exists, message not empty
   → Early exit if invalid
   ↓
3. Rule-Based Intent Detector (IF/Switch/Code)
   → Fast pattern matching
   → Returns intent OR "rule_failed"
   ↓
4. [CONDITIONAL] AI Intent Classifier
   → ONLY if rule_failed
   → Returns: { intent, entities_raw }
   ↓
5. Intent Normalization Node
   → Convert to internal enum
   → Validate against supported intents
   ↓
6. Entity Extraction & Validation Node
   → Parse entities from text
   → DO NOT map to API yet
   ↓
7. Data Readiness Check Node (CRITICAL)
   → For each intent, check required fields
   → If missing → route to Clarify Node
   → If complete → proceed
   ↓
8. Tool Selector (Switch by intent)
   → Each intent → specific tool path
   ↓
9. Tool Adapter Nodes (per API)
   → Map semantic entities → API format
   → Handle API-specific quirks
   ↓
10. External API Nodes
    → WeatherAPI, SerpAPI, DistanceAPI, etc.
    ↓
11. API Response Parser
    → Extract relevant data
    → Normalize to common schema
    ↓
12. Response Formatter
    → Build user-facing response
    → Match intent context
    ↓
13. Error Handler (Global)
    → Catch timeouts, API failures
    → Return graceful fallback
```

---

## ⚠️ SUPPORTED INTENTS (Strict Enum)

```javascript
const SUPPORTED_INTENTS = [
  'get_weather',           // Weather for a location
  'get_distance',          // Distance between places
  'get_travel_time',       // Travel time estimation
  'search_hotel',          // Hotel search
  'book_tour',             // Tour booking
  'get_attraction_info',   // Attraction details
  'get_itinerary',         // Itinerary planning
  'emergency_info',        // Emergency contacts/help
  'clarify_request',       // Insufficient/ambiguous data
  'unsupported_request'    // Out of scope
];
```

**Rules**:
- Exactly ONE intent per execution
- Intent must be normalized to this enum
- Unknown intent → route to clarify or unsupported

---

## 🔴 CRITICAL ERRORS TO AVOID (Will Break Workflow)

### **1. Mapping Entity Directly to API**
❌ `city → weather_api.city` immediately  
✅ `entity → validate → normalize → tool_adapter`

### **2. AI Decides Business Logic**
❌ AI chooses API, calls API  
✅ AI only classifies & extracts

### **3. No "Validate Required Fields" Node**
**Consequence**:
- `city = unknown`
- `date = null`
- API returns `NA`
- You think it's API error, but it's FLOW error

**This is likely your current issue**

### **4. No Clear Boundaries Between**:
- Understanding intent
- Checking data
- Calling tool

**Result**:
- `clarify_request` spam
- Incorrect intent even for clear queries

### **5. Using SerpAPI Without Parser Layer**
❌ Expect SerpAPI to return structured data  
✅ Must have: `search_result → semantic_parser`

### **6. Hardcoded Mock Data in Production Nodes**
❌ `mock = demo = production` (technical debt)  
✅ Separate environments clearly

### **7. No Language Normalization (VN/EN/mixed)**
- "trung quốc", "China", "PRC"
- → rule fails → AI fallback constantly → token waste + wrong intent

### **8. No Clear Default Strategy**
Example:
- No date → use today? ask user?
- No city → use context? ask?

**Without clear decision → workflow behaves randomly**

---

## 🟡 SUBTLE ERRORS (Works Now, Breaks Later)

1. **Duplicate rule intents**
2. **Inconsistent intent names** across nodes
3. **Tool name ≠ Node name**
4. **Using `.first()` in runOnceForEach loops**
5. **Accessing env variables when blocked**
6. **Formatter returns incomplete schema**

---

## 📋 REQUIRED OUTPUT SCHEMA

**ALL workflow outputs MUST conform to**:

```json
{
  "intent": "string",              // From SUPPORTED_INTENTS enum
  "need_tool": boolean,            // true if external API called
  "tool_name": "string | null",   // Exact API node name
  "tool_input": {                  // Normalized input sent to tool
    // Intent-specific fields
  },
  "response_to_user": "string"     // Human-readable response
}
```

**Validation**:
- `intent` must be in enum
- If `need_tool === true`, `tool_name` must not be null
- `response_to_user` must always exist

---

## 🛠️ DATA READINESS RULES (Per Intent)

### **get_weather**
Required: `location`  
Optional: `date`  
Default: `date = today`

### **get_distance / get_travel_time**
Required: `origin`, `destination`  
Optional: `mode` (default: driving)

### **search_hotel**
Required: `location`, `check_in`, `check_out`  
Optional: `guests`, `price_range`

### **get_attraction_info**
Required: `attraction_name` OR `location`

### **clarify_request**
Required: `missing_fields` list

---

## 🎨 CODE STYLE & NAMING

### **Node Naming Convention**:
```
<Action>_<Entity>_<Stage>

Examples:
- Validate_Input_Early
- Detect_Intent_Rule
- Classify_Intent_AI
- Check_Data_Readiness
- Call_WeatherAPI
- Parse_Weather_Response
- Format_Final_Response
```

### **Variable Naming**:
- `intent_detected` (not `intent`)
- `entities_raw` (before validation)
- `entities_validated` (after validation)
- `api_result` (raw API response)
- `normalized_result` (after parsing)

### **Comments**:
Every decision node MUST have:
```javascript
// WHY: Explanation of business logic
// INPUT: Expected data format
// OUTPUT: What this node produces
```

---

## 🚫 FORBIDDEN PATTERNS

1. **AI nodes with tool_call enabled**
   - AI must ONLY classify
   - Tools are called via explicit nodes

2. **Hardcoded city/date/price in production**
   - Use environment variables
   - Use dynamic user input

3. **String concatenation for API URLs**
   - Use URL builder functions
   - Validate parameters first

4. **Silent failures**
   - Always route to error handler
   - Log all API failures

5. **Multi-intent execution**
   - One request = one intent
   - Batch requests must be split upstream

---

## ✅ VALIDATION CHECKLIST (Before Deployment)

### **Flow Validation**:
- [ ] Input validation node exists
- [ ] Rule-based detector comes BEFORE AI
- [ ] AI node has NO tool access
- [ ] Data readiness check exists for ALL intents
- [ ] Each intent has dedicated tool adapter
- [ ] Error handler catches ALL node failures

### **Schema Validation**:
- [ ] All outputs match required schema
- [ ] Intent enum is enforced
- [ ] No null responses without error flag

### **Security Validation**:
- [ ] No API keys in code (use env)
- [ ] User input is sanitized
- [ ] No eval() or code injection risks

### **Performance Validation**:
- [ ] Rule detection runs in <50ms
- [ ] AI fallback only triggers when needed
- [ ] API timeouts are configured (max 10s)

---

## 📖 EXAMPLE: Correct Hybrid Flow (Pseudocode)

```
User: "北京明天天气怎么样？"

→ Node 1: Validate_Input
  ✅ message exists
  
→ Node 2: Detect_Intent_Rule
  ✅ Keyword "天气" detected → intent = "get_weather"
  ✅ Skip AI fallback
  
→ Node 3: Extract_Entities
  location = "北京"
  date = "明天"
  
→ Node 4: Normalize_Entities
  location = "Beijing" (standardized)
  date = "2026-01-06" (computed)
  
→ Node 5: Check_Data_Readiness
  Required: location ✅
  Optional: date ✅
  → Data COMPLETE → proceed
  
→ Node 6: Route_to_Tool
  intent = "get_weather" → Call_WeatherAPI
  
→ Node 7: Tool_Adapter_Weather
  Map: location → weatherapi.q = "Beijing"
  Map: date → weatherapi.dt = "2026-01-06"
  
→ Node 8: Call_WeatherAPI
  GET /forecast?q=Beijing&dt=2026-01-06
  
→ Node 9: Parse_Weather_Response
  Extract: temp, condition, humidity
  
→ Node 10: Format_Response
  "北京明天天气：晴，最高15°C，最低5°C"
  
→ Output:
{
  "intent": "get_weather",
  "need_tool": true,
  "tool_name": "WeatherAPI",
  "tool_input": { "location": "Beijing", "date": "2026-01-06" },
  "response_to_user": "北京明天天气：晴，最高15°C，最低5°C"
}
```

---

## 🎯 ONE-SENTENCE SUMMARY

**Hybrid Travel Assistant is NOT "AI calls API", but a system that understands user intent first, ensures data completeness, and only then uses APIs as backend tools.**

---

## 🔧 GITHUB COPILOT USAGE

When using this instruction file:

1. **Generate workflow**: Reference this entire document
2. **Debug intent issues**: Check sections 7 (Data Readiness) and Critical Errors
3. **Add new intent**: Follow SUPPORTED_INTENTS enum + add Data Readiness rule
4. **Fix clarify_request spam**: Review Data Readiness + Entity Normalization nodes

---

## 🏆 QUY TẮC VÀNG (GOLDEN RULES) - BẮT BUỘC TUÂN THỦ

> **Critical Rules**: Vi phạm những quy tắc này sẽ khiến workflow crash hoặc hoạt động sai.

---

### 📋 QUY TẮC 1: DATA CONTRACT - LUÔN NORMALIZE DATA (CRITICAL!)

#### ⚠️ VẤN ĐỀ THƯỜNG GẶP

Webhook node output có structure:
```javascript
{
  body: { message: "thời tiết hà nội" },
  query: {},
  headers: {},
  params: {}
}
```

❌ **SAI - Nodes đọc trực tiếp từ body:**
```javascript
// Node 1
const msg = $json.body.message;

// Node 2 (vài nodes sau)
const msg = $json.body.message; // Lặp lại, dễ quên, dễ sai
```

✅ **ĐÚNG - Normalize ngay sau validate:**
```javascript
// Detect_Intent_Rule node (node đầu tiên sau validate)
const rawMessage = $json.body?.message || $json.message;

if (!rawMessage || typeof rawMessage !== 'string' || !rawMessage.trim()) {
  return { error: true, intent_detected: 'validation_error' };
}

// ✅ NORMALIZE: Đưa message lên root level
return {
  message: rawMessage.trim(),           // ← ROOT LEVEL
  message_original: rawMessage.trim(),
  message_normalized: rawMessage.toLowerCase().trim(),
  intent_detected: bestMatch.intent,
  entities_raw: bestMatch.entities_raw
};
```

#### 📐 DATA FLOW CHUẨN

```
Webhook Trigger
  Output: { body: { message: "..." } }
  ↓
Detect_Intent_Rule (NORMALIZE HERE!)
  Output: { 
    message: "...",              ← Normalized to root
    message_original: "...",
    intent_detected: "get_weather"
  }
  ↓
All Subsequent Nodes
  Use ONLY: $json.message
  NEVER: $json.body.message
```

#### 🎯 NGUYÊN TẮC

1. **Single Source of Truth**: Chỉ 1 field `message` ở root level
2. **Normalize Early**: Ngay sau validation node
3. **No Redundancy**: Không node nào đọc `$json.body.message` sau normalize
4. **Type Safety**: Luôn check type trước khi normalize

---

### 🔐 QUY TẮC 2: WEBHOOK DATA STRUCTURE

#### 📍 Webhook Node Output Paths

| Path | Content | Example |
|------|---------|---------|
| `$json.body` | POST body (JSON) | `{ "message": "..." }` |
| `$json.query` | Query params | `{ "id": "123" }` |
| `$json.headers` | HTTP headers | `{ "content-type": "..." }` |
| `$json.params` | URL params | `{ "userId": "abc" }` |
| `$json.message` | ❌ **KHÔNG TỒN TẠI** | Phải tự normalize |

#### ✅ Safe Access Pattern

```javascript
// ✅ Luôn dùng optional chaining
const message = $json.body?.message || $json.message;
const userId = $json.query?.userId || $json.params?.userId;

// ✅ Type checking
if (!message || typeof message !== 'string' || !message.trim()) {
  return { error: true, message: 'Invalid message' };
}
```

---

### ⚙️ QUY TẮC 3: IF NODE CONFIGURATION (Tránh "Conversion Error")

#### ❌ LỖI THƯỜNG GẶP

```json
{
  "conditions": {
    "options": {
      "caseSensitive": false,
      "leftValue": "",           // ❌ Thừa, gây lỗi
      "typeValidation": "strict" // ❌ Thừa, gây lỗi
    },
    "conditions": [
      {
        "leftValue": "={{ $json.body }}",
        "operator": {
          "type": "object",       // ❌ Lỗi nếu $json.body là ""
          "operation": "exists"
        }
      }
    ]
  }
}
```

**Lỗi**: `NodeOperationError: Conversion error: the string '' can't be converted to an object`

#### ✅ CẤU HÌNH ĐÚNG

```json
{
  "conditions": {
    "options": {
      "caseSensitive": false
      // ❌ KHÔNG thêm leftValue, typeValidation ở đây
    },
    "conditions": [
      {
        "id": "check-message-exists",
        "leftValue": "={{ $json.body?.message }}",  // ✅ Safe navigation
        "rightValue": "",
        "operator": {
          "type": "string",                         // ✅ String, not object
          "operation": "exists"
        }
      },
      {
        "id": "check-message-not-empty",
        "leftValue": "={{ String($json.body?.message || '').trim() }}",
        "rightValue": "",
        "operator": {
          "type": "string",
          "operation": "isNotEmpty"
        }
      }
    ],
    "combinator": "and"
  }
}
```

#### 🎯 NGUYÊN TẮC IF NODE

1. **No extra fields in options**: Chỉ `caseSensitive`
2. **Use safe navigation**: `?.` để tránh undefined
3. **Match type correctly**: String check cho string, boolean cho boolean
4. **Explicit comparison**: `{{ $json.can_proceed === true }}` thay vì `{{ $json.can_proceed }}`

---

### 🔑 QUY TẮC 4: API KEYS & ENVIRONMENT VARIABLES

#### ❌ TUYỆT ĐỐI KHÔNG HARDCODE

```javascript
// ❌ NGUY HIỂM - Leak key, không rotate được
{
  "name": "key",
  "value": "9e89a15b36844093ba775734252701"
}
```

#### ✅ LUÔN DÙNG ENV VARS

```javascript
// ✅ Production-ready
{
  "name": "key",
  "value": "={{ $env.WEATHER_API_KEY || '9e89a15b36844093ba775734252701' }}"
  //         ↑ Ưu tiên env          ↑ Fallback cho local dev
}
```

#### 📝 .env File Format

```bash
# API Keys (NEVER commit to git!)
WEATHER_API_KEY=your_key_here
SERP_API_KEY=your_key_here
GROQ_API_KEY=your_key_here

# N8N Config
N8N_PORT=5678
N8N_PROTOCOL=http
N8N_HOST=localhost
```

---

### ⚡ QUY TẮC 5: WORKFLOW SETTINGS

#### ✅ Production Settings

```json
{
  "active": false,
  "settings": {
    "executionOrder": "v2",              // ✅ v2 cho hybrid workflows
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner",
    "executionTimeout": 120              // ✅ Timeout 2 phút
  }
}
```

#### ⚠️ executionOrder

| Version | Use Case | Risk |
|---------|----------|------|
| `v1` | Simple linear workflows | ❌ Race condition với hybrid |
| `v2` | **Hybrid workflows**, parallel branches | ✅ Deterministic execution |

**Quy tắc**: Hybrid workflows **BẮT BUỘC** dùng `executionOrder: v2`

---

### 🎨 QUY TẮC 6: ENTITY NORMALIZATION

#### ✅ Location Normalization Map

```javascript
const locationMap = {
  // Vietnamese names
  'hà nội': 'Hanoi',
  'đà nẵng': 'Da Nang',
  'sài gòn': 'Ho Chi Minh City',
  'bắc kinh': 'Beijing',
  'trung quốc': 'China',
  
  // ASCII variants
  'ha noi': 'Hanoi',
  'da nang': 'Da Nang',
  'bac kinh': 'Beijing',
  'trung quoc': 'China',
  
  // English
  'hanoi': 'Hanoi',
  'beijing': 'Beijing',
  'saigon': 'Ho Chi Minh City',
  'china': 'China'
};

// Normalize
const normalized = locationMap[entities.location.toLowerCase().trim()];
if (normalized) {
  entities.location = normalized;
}
```

#### ✅ Date Normalization

```javascript
const dateMap = {
  'today': new Date().toISOString().split('T')[0],
  'hôm nay': new Date().toISOString().split('T')[0],
  'hom nay': new Date().toISOString().split('T')[0],
  'tomorrow': new Date(Date.now() + 86400000).toISOString().split('T')[0],
  'ngày mai': new Date(Date.now() + 86400000).toISOString().split('T')[0],
  'ngay mai': new Date(Date.now() + 86400000).toISOString().split('T')[0]
};

const normalizedDate = dateMap[entities.date.toLowerCase().trim()];
if (normalizedDate) {
  entities.date = normalizedDate;
}
```

---

### 🛡️ QUY TẮC 7: ERROR HANDLING

#### ✅ Error Connections Pattern

```json
{
  "Call_WeatherAPI": {
    "main": [
      [{ "node": "Parse_Weather_Response" }]
    ],
    "error": [
      [{ "node": "Global_Error_Handler" }]  // ✅ Always add
    ]
  }
}
```

#### ✅ Global Error Handler Template

```javascript
const error = $json.error || {};
const errorMessage = error.message || 'Unknown error';

return {
  intent: 'error',
  need_tool: false,
  tool_name: null,
  response_to_user: `Xin lỗi, đã xảy ra lỗi: ${errorMessage}`,
  error_details: {
    type: error.name || 'Error',
    message: errorMessage,
    timestamp: new Date().toISOString()
  }
};
```

#### 🎯 NGUYÊN TẮC

1. **All HTTP nodes**: Phải có error connection
2. **All AI nodes**: Phải có error connection
3. **Never expose raw errors**: Convert to user-friendly message
4. **Always log**: Include timestamp và error type

---

### 📊 QUY TẮC 8: BOOLEAN CHECKS (Tránh String "true")

#### ❌ LỖI THƯỜNG GẶP

```json
{
  "leftValue": "={{ $json.can_proceed }}",  // ❌ Có thể là "true" (string)
  "operator": { "type": "boolean", "operation": "true" }
}
```

#### ✅ CÁCH SỬA

```json
{
  "leftValue": "={{ $json.can_proceed === true }}",  // ✅ Explicit comparison
  "operator": { "type": "boolean", "operation": "true" }
}
```

**Quy tắc**: Luôn dùng `=== true` hoặc `=== false` cho boolean checks

---

### 🧪 QUY TẮC 9: WEATHERAPI ENDPOINT SELECTION

#### ❌ SAI - Dùng forecast.json khi không cần

```javascript
// ❌ Lỗi khi query current weather
url: "https://api.weatherapi.com/v1/forecast.json",
params: {
  q: "Hanoi",
  dt: "2026-01-06"  // ❌ dt không work với current weather
}
```

#### ✅ ĐÚNG - Chọn endpoint phù hợp

```javascript
// ✅ Current weather
url: "https://api.weatherapi.com/v1/current.json",
params: {
  q: "Hanoi"
  // Không cần dt
}

// ✅ Future/Historical forecast
url: "https://api.weatherapi.com/v1/forecast.json",
params: {
  q: "Hanoi",
  days: 3  // Dùng days thay vì dt
}
```

**Quy tắc**: 
- `current.json`: Thời tiết hiện tại
- `forecast.json`: Dự báo nhiều ngày (dùng `days` param)
- `history.json`: Dữ liệu quá khứ (dùng `dt` param)

---

## 🚨 COMMON PITFALLS & FIXES

### ❌ Pitfall 1: Data Contract Violation

```javascript
// ❌ Node outputs nested data
return { body: { message: "test" } };

// ❌ Next node reads wrong path
const msg = $json.message; // undefined!
```

**✅ Fix**: Normalize early, use consistently
```javascript
return { 
  message: $json.body?.message,  // ✅ Root level
  intent: "get_weather"
};
```

---

### ❌ Pitfall 2: Object.exists on String

```javascript
// ❌ IF node checks object but receives ""
{
  "leftValue": "={{ $json.body }}",
  "operator": { "type": "object", "operation": "exists" }
}
```

**Error**: `Conversion error: '' can't be converted to object`

**✅ Fix**: Check string instead
```javascript
{
  "leftValue": "={{ $json.body?.message }}",
  "operator": { "type": "string", "operation": "exists" }
}
```

---

### ❌ Pitfall 3: executionOrder v1 với Hybrid

```json
{
  "settings": {
    "executionOrder": "v1"  // ❌ Race condition!
  }
}
```

**✅ Fix**: Luôn dùng v2
```json
{
  "settings": {
    "executionOrder": "v2"  // ✅ Deterministic
  }
}
```

---

## ✅ PRE-DEPLOYMENT CHECKLIST

- [ ] **Data Contract**: All nodes use `$json.message`, not `$json.body.message`
- [ ] **API Keys**: Using `$env.*` instead of hardcoded values
- [ ] **Error Handling**: All HTTP/AI nodes have error connections
- [ ] **Execution Order**: Set to `v2` for hybrid workflows
- [ ] **Boolean Checks**: Using `=== true` instead of implicit checks
- [ ] **Timeout**: Set `executionTimeout` appropriately (60-120s)
- [ ] **Normalization**: Location & date entities are normalized
- [ ] **Validation**: Input validation happens IMMEDIATELY after webhook
- [ ] **IF Node Options**: No extra fields (`leftValue`, `typeValidation`) in options
- [ ] **WeatherAPI**: Using correct endpoint (`current.json` vs `forecast.json`)

---

**Last updated**: 2026-01-06  
**Version**: 2.1 (Added Golden Rules)  
**Previous**: 2.0 (Hybrid-first Architecture)
