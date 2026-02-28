// Script to modify n8n workflow JSON nodes for GET_TICKET_PRICE production hardening
// ES Module version (for "type": "module" in package.json)
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'rule_first_travel_bot.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// =========================================================
// Component 2: Fn_ValidateInput — add updateId + userId
// =========================================================
const validateNode = workflow.nodes.find(n => n.name === 'Fn_ValidateInput');
if (validateNode) {
  validateNode.parameters.jsCode = `// Node 2: Fn_ValidateInput — V2 Production
// Normalize webhook data to root level.
// Extract sessionId, userId, updateId, message, userLocation.
// Output: {_valid, sessionId, userId, updateId, message, messageLower, userLocation, _webhookTime}

const body = $json.body || $json;
const rawMessage = body.message || body.msg || '';
const sessionId = body.session_id || body.sessionId || 'anon_' + Date.now();

// Production: extract Telegram update_id for idempotency
const updateId = body.update_id || body.updateId || null;

// Production: extract userId for rate limiting
const userId = body.user_id || body.userId || sessionId;

if (!rawMessage || typeof rawMessage !== 'string' || !rawMessage.trim()) {
  return {
    _valid: false,
    error: 'Tin nhắn không hợp lệ hoặc trống.'
  };
}

const message = rawMessage.trim();
const messageLower = message.toLowerCase();

// Parse userLocation
let userLocation = null;
const rawLoc = body.user_location || body.userLocation || null;
if (rawLoc && typeof rawLoc === 'object' &&
    typeof rawLoc.lat === 'number' && typeof rawLoc.lng === 'number') {
  userLocation = { lat: rawLoc.lat, lng: rawLoc.lng };
}

return {
  _valid: true,
  sessionId,
  userId,
  updateId,
  message,
  messageLower,
  userLocation,
  _webhookTime: Date.now()
};`;
  console.log('✅ Fn_ValidateInput updated');
} else {
  console.error('❌ Fn_ValidateInput not found');
}

// =========================================================
// Component 3: Fn_PrepTicketPrice — defensive enhancement
// =========================================================
const prepTicketNode = workflow.nodes.find(n => n.name === 'Fn_PrepTicketPrice');
if (prepTicketNode) {
  prepTicketNode.parameters.jsCode = `// Node 17: Fn_PrepTicketPrice — V3 Production
// Defensive entity cleanup before slug build
// V3: NFC normalization, comprehensive filler stripping, length guard, clarify message

function slugify(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\\s-]/g, '')
    .replace(/\\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Step 1: NFC normalization
let entity = ($json.entity || '').normalize('NFC');

// Step 2: Defensive strip — remove all filler/noise words
entity = entity
  .replace(/\\b(thông tin|cho tôi biết|cho tôi|giúp tôi|tôi cần|tôi muốn|cần biết|muốn biết|xem|tìm hiểu|tìm|hãy|về|của|là|ở|tại|vào|cửa|vé|bao nhiêu|bao nhieu|hết|tất cả|vui lòng|nhé|nha|đi|à|ạ|giá|giá vé|gia ve)\\b/gi, '')
  .replace(/[.,!?;:]/g, '')
  .replace(/\\s+/g, ' ')
  .trim();

// Step 3: Length guard — real place names are <= 5 words
if (entity && entity.split(/\\s+/).length > 5) {
  return {
    ...$json,
    success: false,
    type: 'error',
    data: null,
    message: 'Tên địa điểm quá dài. Bạn muốn xem giá vé ở đâu? Ví dụ: "Giá vé Tràng An"',
    slug: '',
    entity: null
  };
}

const slug = slugify(entity);

// Step 4: Empty slug guard — clear clarification message
if (!slug) {
  return {
    ...$json,
    success: false,
    type: 'error',
    data: null,
    message: 'Bạn muốn xem giá vé địa điểm nào? Ví dụ: "Giá vé Tràng An bao nhiêu?"',
    slug: '',
    entity: null,
    _clarifyMessage: 'Bạn muốn xem giá vé địa điểm nào? Ví dụ: "Giá vé Tràng An bao nhiêu?"'
  };
}

return { ...$json, entity, slug, entityDisplay: entity };`;
  console.log('✅ Fn_PrepTicketPrice updated');
} else {
  console.error('❌ Fn_PrepTicketPrice not found');
}

// =========================================================
// Component 5: DB_LookupTicket — enhanced query
// =========================================================
const dbTicketNode = workflow.nodes.find(n => n.name === 'DB_LookupTicket');
if (dbTicketNode) {
  dbTicketNode.parameters.query = `SELECT p.name, p.province, t.ticket_type, t.adult_price, t.child_price, t.notes,
  oh.open_time, oh.close_time, oh.is_closed
FROM tickets t
JOIN places p ON p.id = t.place_id
LEFT JOIN opening_hours oh ON oh.place_id = p.id
  AND oh.day_of_week = EXTRACT(DOW FROM NOW())
WHERE p.slug = '{{ $json.slug }}' AND p.is_active = true`;
  console.log('✅ DB_LookupTicket query updated');
} else {
  console.error('❌ DB_LookupTicket not found');
}

// =========================================================
// Component 4: Fn_FormatTicketPrice — UX-rich response
// =========================================================
const formatTicketNode = workflow.nodes.find(n => n.name === 'Fn_FormatTicketPrice');
if (formatTicketNode) {
  formatTicketNode.parameters.jsCode = `// Node 19: Fn_FormatTicketPrice — V3 Production
// Multi-row (may have multiple ticket types)
// V3: UX-rich with emoji, free ticket handling, cross-ref opening hours, province

try {
  const items = $input.all();
  const rows = items.map(i => i.json).filter(r => r && r.ticket_type);
  const prep = $('Fn_PrepTicketPrice').first()?.json ?? {};

  if (rows.length === 0) {
    return {
      success: false, type: 'not_found', data: null,
      message: '❌ Không tìm thấy thông tin giá vé của ' + (prep.entityDisplay || 'địa điểm này') + '.'
    };
  }

  const placeName = rows[0].name || prep.entityDisplay;
  const province = rows[0].province || null;
  const openTime = rows[0].open_time || null;
  const closeTime = rows[0].close_time || null;
  const isClosed = rows[0].is_closed || false;

  const tickets = rows.map(r => ({
    type: r.ticket_type,
    adult_price: r.adult_price || 0,
    child_price: r.child_price || 0,
    notes: r.notes || ''
  }));

  // Build UX-rich message
  let msg = '🎫 Giá vé ' + placeName + '\\n\\n';

  tickets.forEach(t => {
    const adultStr = t.adult_price > 0
      ? t.adult_price.toLocaleString('vi-VN') + 'đ'
      : 'Miễn phí 🆓';
    const childStr = t.child_price > 0
      ? t.child_price.toLocaleString('vi-VN') + 'đ'
      : 'Miễn phí 🆓';

    msg += '• ' + t.type + ':\\n';
    msg += '  💰 Người lớn: ' + adultStr + '\\n';
    msg += '  👶 Trẻ em: ' + childStr + '\\n';
    if (t.notes && t.notes !== 'Miễn phí') {
      msg += '  📝 ' + t.notes + '\\n';
    }
    msg += '\\n';
  });

  // Cross-reference: opening hours for today
  if (openTime && closeTime && !isClosed) {
    const openStr = String(openTime).substring(0, 5);
    const closeStr = String(closeTime).substring(0, 5);
    msg += '⏰ Giờ mở cửa hôm nay: ' + openStr + ' – ' + closeStr + '\\n';
  } else if (isClosed) {
    msg += '⏰ Hôm nay: Đóng cửa\\n';
  }

  // Province info
  if (province) {
    msg += '📍 ' + province + '\\n';
  }

  return {
    success: true, type: 'ticket_price',
    data: { name: placeName, province, tickets, opening_hours: { open: openTime, close: closeTime, is_closed: isClosed }, source: 'db' },
    message: msg.trim()
  };
} catch(e) {
  return { success: false, type: 'error', data: null, message: '⚠️ Lỗi khi xử lý thông tin giá vé. Vui lòng thử lại sau.' };
}`;
  console.log('✅ Fn_FormatTicketPrice updated');
} else {
  console.error('❌ Fn_FormatTicketPrice not found');
}

// =========================================================
// Component 6: Fn_FormatTicketFromAPI — polished fallback
// =========================================================
const formatTicketAPINode = workflow.nodes.find(n => n.name === 'Fn_FormatTicketFromAPI');
if (formatTicketAPINode) {
  formatTicketAPINode.parameters.jsCode = `// Node: Fn_FormatTicketFromAPI — V2 Production
// Parse HERE Discover response for ticket price fallback
// V2: consistent emoji, clearer messaging, action suggestion

try {
  const items = $json?.items;
  let prep;
  try { prep = $('Fn_PrepTicketPrice').item.json; } catch(e) { prep = {}; }
  const entityName = prep.entityDisplay || 'địa điểm này';

  if (!items || !Array.isArray(items) || items.length === 0) {
    return {
      success: false,
      type: 'not_found',
      data: null,
      message: '❌ Không tìm thấy thông tin giá vé của ' + entityName + '.\\n\\n💡 Bạn có thể thử tìm trên website chính thức của địa điểm.'
    };
  }

  const place = items[0];
  const addr = place?.address;
  const cats = place?.categories || [];
  const contacts = place?.contacts || [];
  const phone = contacts?.[0]?.phone?.[0]?.value || null;
  const website = contacts?.[0]?.www?.[0]?.value || null;
  const catName = cats?.[0]?.name || null;
  const pos = place?.position;

  // Category-based price estimation (Vietnam typical ranges)
  const PRICE_ESTIMATES = {
    'museum': { range: '30.000 – 50.000 VNĐ', note: 'bảo tàng' },
    'historical monument': { range: '30.000 – 80.000 VNĐ', note: 'di tích lịch sử' },
    'park-recreation-area': { range: '20.000 – 100.000 VNĐ', note: 'khu vui chơi' },
    'natural-geographical': { range: '50.000 – 200.000 VNĐ', note: 'danh lam thắng cảnh' },
    'temple': { range: 'Miễn phí – 50.000 VNĐ', note: 'đền/chùa' },
    'pagoda': { range: 'Miễn phí – 50.000 VNĐ', note: 'chùa' },
    'tourist-attraction': { range: '50.000 – 200.000 VNĐ', note: 'điểm du lịch' },
    'leisure': { range: '50.000 – 150.000 VNĐ', note: 'khu giải trí' }
  };

  // Find matching estimate from HERE category
  let estimate = null;
  const catIdLower = (cats?.[0]?.id || '').toLowerCase();
  const catNameLower = (catName || '').toLowerCase();
  for (const [key, val] of Object.entries(PRICE_ESTIMATES)) {
    if (catIdLower.includes(key) || catNameLower.includes(key)) {
      estimate = val;
      break;
    }
  }
  if (!estimate) {
    estimate = { range: '30.000 – 150.000 VNĐ', note: 'ước tính chung' };
  }

  const data = {
    name: place.title || entityName,
    category: catName,
    address: addr?.label || null,
    coordinates: (pos?.lat != null && pos?.lng != null) ? { lat: pos.lat, lng: pos.lng } : null,
    estimated_price: estimate.range,
    price_note: estimate.note,
    website: website,
    phone: phone,
    source: 'api_estimate'
  };

  let msg = '🎫 Giá vé ' + data.name + '\\n\\n';
  msg += '⚠️ Thông tin chưa có trong hệ thống — đây là ước tính tham khảo:\\n\\n';
  if (catName) msg += '🏛️ Loại: ' + catName + '\\n';
  if (addr?.label) msg += '📍 Khu vực: ' + addr.label + '\\n';
  msg += '\\n💰 Giá vé ước tính: ' + estimate.range + ' (' + estimate.note + ')\\n';
  if (website) msg += '\\n🌐 Website: ' + website;
  if (phone) msg += '\\n📞 Liên hệ: ' + phone;
  msg += '\\n\\n💡 Để có giá chính xác, vui lòng gọi điện hoặc truy cập website của địa điểm.';

  return {
    success: true,
    type: 'ticket_price',
    data: data,
    message: msg
  };
} catch(e) {
  return {
    success: false,
    type: 'error',
    data: null,
    message: '⚠️ Lỗi khi tra cứu thông tin giá vé. Vui lòng thử lại sau.'
  };
}`;
  console.log('✅ Fn_FormatTicketFromAPI updated');
} else {
  console.error('❌ Fn_FormatTicketFromAPI not found');
}

// =========================================================
// Write back
// =========================================================
fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('\n🎉 All nodes updated. Workflow saved.');
