-- =====================================================
-- POI OVERRIDE TABLE - PostgreSQL (pgAdmin 4)
-- Travel Assistant - Fast-path geocode bypass
-- =====================================================
-- IMPORTANT: aliases uses NORMALIZED KEYS (no diacritics, underscores)
-- Workflow normalizes raw input before DB lookup
-- Contract: { normalized_alias: "den_thai_vi", intent: "GET_WEATHER" }
-- Query: WHERE aliases ? $1 AND intent_support ? $2
-- =====================================================

-- 1. DROP existing types/table if needed (optional)
DROP TABLE IF EXISTS poi_override CASCADE;
DROP TYPE IF EXISTS place_type_enum CASCADE;
DROP TYPE IF EXISTS status_enum CASCADE;

-- 2. CREATE ENUM TYPES
CREATE TYPE place_type_enum AS ENUM (
  'temple', 'lake', 'park', 'area', 'landmark', 
  'cave', 'mountain', 'beach', 'museum', 'church'
);

CREATE TYPE status_enum AS ENUM ('active', 'deprecated');

-- 3. CREATE TABLE
CREATE TABLE poi_override (
  id SERIAL PRIMARY KEY,
  canonical_name VARCHAR(100) NOT NULL,
  aliases JSONB NOT NULL,  -- NORMALIZED keys only: ["den_thai_vi", "thai_vi"]
  lat NUMERIC(10, 6) NOT NULL,
  lng NUMERIC(10, 6) NOT NULL,
  place_type place_type_enum NOT NULL,
  admin_level INT DEFAULT 3,  -- 1=country, 2=city/province, 3=POI (higher = more specific)
  priority NUMERIC(3, 2) DEFAULT 0.90,
  intent_support JSONB NOT NULL,
  status status_enum DEFAULT 'active',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ADMIN_LEVEL CONVENTION:
-- 1 = Country (Việt Nam)
-- 2 = Province/City (Hà Nội, Ninh Bình, Đà Nẵng)
-- 3 = District/Area (Tràng An, Tam Cốc, Phố cổ Hội An)
-- 4 = Specific POI (Đền Thái Vi, Chùa Bái Đính, Hồ Hoàn Kiếm)
-- DB query uses: ORDER BY admin_level DESC → POI wins over city

-- 4. CREATE INDEXES (optimized for ? operator)
CREATE INDEX idx_poi_status ON poi_override(status);
CREATE INDEX idx_poi_priority ON poi_override(priority);
CREATE INDEX idx_poi_admin_level ON poi_override(admin_level);
CREATE INDEX idx_poi_aliases ON poi_override USING GIN(aliases jsonb_path_ops);
CREATE INDEX idx_poi_intent ON poi_override USING GIN(intent_support jsonb_path_ops);

-- 5. CREATE TRIGGER for updated_at auto-update
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_poi_updated_at
  BEFORE UPDATE ON poi_override
  FOR EACH ROW
  EXECUTE FUNCTION update_modified_column();

-- =====================================================
-- INSERT POI DATA (15 records) - NORMALIZED ALIASES
-- =====================================================

INSERT INTO poi_override (canonical_name, aliases, lat, lng, place_type, admin_level, priority, intent_support, status) VALUES

-- Ninh Bình (POI level = 4)
('Đền Thái Vi', 
 '["den_thai_vi", "thai_vi", "den_thai_vi_ninh_binh"]'::jsonb,
 20.224117, 105.929381, 'temple', 4, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active'),

('Chùa Bái Đính', 
 '["chua_bai_dinh", "bai_dinh", "bai_dinh_ninh_binh"]'::jsonb,
 20.273392, 105.854502, 'temple', 4, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active'),

('Chùa Bái Đính Cổ', 
 '["chua_bai_dinh_co", "bai_dinh_co", "bai_dinh_co_ninh_binh"]'::jsonb,
 20.269993, 105.865755, 'temple', 4, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active'),

('Tràng An', 
 '["trang_an", "khu_du_lich_trang_an", "trang_an_ninh_binh"]'::jsonb,
 20.250650, 105.937240, 'landmark', 3, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR"]'::jsonb, 'active'),

('Tam Cốc', 
 '["tam_coc", "tam_coc_bich_dong", "tam_coc_ninh_binh"]'::jsonb,
 20.215540, 105.932250, 'landmark', 3, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR"]'::jsonb, 'active'),

('Hồ Hoàn Kiếm', 
 '["ho_hoan_kiem", "ho_guom", "bo_ho", "hoan_kiem"]'::jsonb,
 21.028850, 105.852540, 'lake', 4, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active'),

('Lăng Chủ tịch Hồ Chí Minh', 
 '["lang_bac", "lang_chu_tich", "lang_ho_chi_minh", "lang_chu_tich_ho_chi_minh"]'::jsonb,
 21.036860, 105.834680, 'landmark', 4, 0.95,
 '["GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active'),

('Chùa Một Cột', 
 '["chua_mot_cot", "mot_cot", "one_pillar_pagoda"]'::jsonb,
 21.035900, 105.833430, 'temple', 4, 0.95,
 '["GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active'),

('Vịnh Hạ Long', 
 '["vinh_ha_long", "ha_long", "ha_long_bay"]'::jsonb,
 20.910200, 107.184000, 'landmark', 3, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR"]'::jsonb, 'active'),

('Động Phong Nha', 
 '["dong_phong_nha", "phong_nha", "phong_nha_ke_bang"]'::jsonb,
 17.589950, 106.283150, 'cave', 4, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR"]'::jsonb, 'active'),

('Phố cổ Hội An', 
 '["pho_co_hoi_an", "hoi_an", "hoi_an_ancient_town"]'::jsonb,
 15.880150, 108.338050, 'area', 3, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL"]'::jsonb, 'active'),

('Bà Nà Hills', 
 '["ba_na_hills", "ba_na", "cau_vang", "golden_bridge"]'::jsonb,
 15.997750, 107.987600, 'landmark', 4, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR"]'::jsonb, 'active'),

('Sapa', 
 '["sapa", "sa_pa", "fansipan"]'::jsonb,
 22.336450, 103.843850, 'area', 3, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL"]'::jsonb, 'active'),

('Cố đô Huế', 
 '["co_do_hue", "dai_noi_hue", "kinh_thanh_hue", "hoang_thanh_hue", "hue"]'::jsonb,
 16.469850, 107.579750, 'landmark', 3, 0.95,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR"]'::jsonb, 'active'),

('Mũi Né', 
 '["mui_ne", "doi_cat_mui_ne"]'::jsonb,
 10.933350, 108.287250, 'beach', 3, 0.90,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI", "SEARCH_TOUR", "SEARCH_HOTEL"]'::jsonb, 'active'),

('Núi Bà Đen', 
 '["nui_ba_den", "ba_den", "ba_den_tay_ninh"]'::jsonb,
 11.364250, 106.143950, 'mountain', 4, 0.90,
 '["GET_WEATHER", "GET_PLACE_INFO", "SEARCH_POI"]'::jsonb, 'active');
  
-- =====================================================
-- VERIFY DATA
-- =====================================================
SELECT 
  id, 
  canonical_name, 
  place_type, 
  admin_level,
  priority,
  lat || ',' || lng AS coordinates,
  aliases
FROM poi_override 
WHERE status = 'active'
ORDER BY admin_level DESC, priority DESC, id;

-- =====================================================
-- SAMPLE QUERY: Deterministic lookup by normalized alias + intent
-- This is the EXACT query used by the workflow
-- RULE: ORDER BY admin_level DESC → POI (4) wins over Area (3) wins over City (2)
-- =====================================================
-- SELECT canonical_name, lat, lng, place_type, admin_level, priority 
-- FROM poi_override 
-- WHERE status = 'active' 
--   AND aliases ? 'den_thai_vi'
--   AND intent_support ? 'GET_WEATHER'
-- ORDER BY admin_level DESC, priority DESC 
-- LIMIT 1;
