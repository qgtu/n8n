// Test location detection logic for "3 điểm du lịch gần Hồ Gươm nhất"

const testMessage = "3 điểm du lịch gần hồ gươm nhất ?";
const messageLower = testMessage.toLowerCase();

console.log("Testing message:", testMessage);
console.log("Lower case:", messageLower);
console.log("");

// ---- CHECK PLACE NAME (explicit text) ----
const hasPlaceName =
  messageLower.includes('đền') ||
  messageLower.includes('chùa') ||
  messageLower.includes('nhà thờ') ||
  messageLower.includes('bảo tàng') ||
  messageLower.includes('lăng') ||
  messageLower.includes('hồ ') ||  // ⚠️ Requires space after 'hồ'
  messageLower.includes('núi ') ||
  messageLower.includes('biển');

console.log("hasPlaceName:", hasPlaceName, "(checks for 'hồ ' with space)");

// ---- CHECK LOCATION HINT (city/area names) ----
const hasLocationHint =
  messageLower.includes('ở ') ||
  messageLower.includes('tại ') ||
  messageLower.includes('gần ') ||  // ✅ This should match "gần hồ"
  messageLower.includes('quanh ') ||
  messageLower.includes('xung quanh ') ||
  messageLower.includes('khu vực ') ||
  messageLower.includes('hà nội') ||
  messageLower.includes('sài gòn') ||
  messageLower.includes('đà nẵng') ||
  messageLower.includes('ninh bình');

console.log("hasLocationHint:", hasLocationHint, "(checks for 'gần ')");

// ---- CHECK "GẦN TÔI" ----
const isNearMe =
  messageLower.includes('gần tôi') ||
  messageLower.includes('quanh tôi') ||
  messageLower.includes('xung quanh tôi') ||
  messageLower.includes('gần đây');

console.log("isNearMe:", isNearMe);

// ---- CHECK USER LOCATION AVAILABLE ----
const userLocation = null; // No device location in this test
const hasUserLocation = !!(userLocation && userLocation.lat && userLocation.lng);

console.log("hasUserLocation:", hasUserLocation);
console.log("");

// ---- FINAL CHECK ----
const hasAnyLocationSource = hasPlaceName || hasLocationHint || hasUserLocation || isNearMe;

console.log("hasAnyLocationSource:", hasAnyLocationSource);
console.log("");

if (hasAnyLocationSource) {
  console.log("✅ SUCCESS - Should NOT trigger 'missing location'");
  console.log("   Workflow should proceed to Switch_SpecialIntent → SEARCH_POI");
} else {
  console.log("❌ FAIL - Would trigger 'missing location'");
  console.log("   This is the bug the user reported");
}
