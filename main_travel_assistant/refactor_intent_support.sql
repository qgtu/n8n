-- =====================================================
-- Phase 6 Migration: Add GET_DISTANCE to intent_support
-- Purpose: Enable DB-first place resolution for GET_DISTANCE pipeline
-- Run AFTER all prior migrations (poi_override, place_metadata, production_upgrade)
-- =====================================================

-- Add GET_DISTANCE to all active POIs that don't already have it
UPDATE poi_override
SET intent_support = intent_support || '["GET_DISTANCE"]'::jsonb
WHERE status = 'active'
  AND NOT intent_support ? 'GET_DISTANCE';

-- Also add common city aliases that are useful for distance queries
-- These are major cities frequently used as origin/destination
INSERT INTO poi_override (canonical_name, aliases, lat, lng, place_type, admin_level, priority, intent_support, status)
VALUES
  ('Hà Nội', '["ha_noi", "hanoi"]'::jsonb, 21.028511, 105.804817, 'area', 2, 0.95,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Đà Nẵng', '["da_nang", "danang"]'::jsonb, 16.054407, 108.202164, 'area', 2, 0.95,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Hồ Chí Minh', '["ho_chi_minh", "sai_gon", "saigon", "tp_hcm"]'::jsonb, 10.823099, 106.629664, 'area', 2, 0.95,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Ninh Bình', '["ninh_binh"]'::jsonb, 20.250000, 105.975000, 'area', 2, 0.90,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Nha Trang', '["nha_trang"]'::jsonb, 12.238791, 109.196749, 'area', 2, 0.90,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Đà Lạt', '["da_lat", "dalat"]'::jsonb, 11.946163, 108.441930, 'area', 2, 0.90,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Phú Quốc', '["phu_quoc"]'::jsonb, 10.289879, 103.984023, 'area', 2, 0.90,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active'),
  ('Quảng Ninh', '["quang_ninh", "ha_long"]'::jsonb, 20.959902, 107.042542, 'area', 2, 0.90,
   '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL", "GET_DISTANCE"]'::jsonb, 'active')
ON CONFLICT DO NOTHING;

-- =====================================================
-- VERIFY: All active POIs should now include GET_DISTANCE
-- =====================================================
SELECT
  id,
  canonical_name,
  intent_support,
  CASE WHEN intent_support ? 'GET_DISTANCE' THEN 'YES' ELSE 'NO' END AS has_distance
FROM poi_override
WHERE status = 'active'
ORDER BY id;
