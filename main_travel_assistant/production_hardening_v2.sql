-- ============================================================
-- Production Hardening V2 — Schema Migration
-- Run this ONCE in pgAdmin against the travel bot database
-- ============================================================

-- Step A1: Add data_source column to places
ALTER TABLE places ADD COLUMN IF NOT EXISTS data_source VARCHAR(30) DEFAULT 'seed';
COMMENT ON COLUMN places.data_source IS 'Origin of record: seed | api | admin';

-- Step A2: Add province column to places
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

-- Step A3: UNIQUE constraint on tour_destinations
ALTER TABLE tour_destinations
ADD CONSTRAINT unique_tour_place UNIQUE (tour_id, place_id);

-- Step A4: New table location_aliases
CREATE TABLE IF NOT EXISTS location_aliases (
  id SERIAL PRIMARY KEY,
  alias VARCHAR(100) UNIQUE NOT NULL,
  canonical_name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON location_aliases(alias);

-- Step A5: Seed aliases
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
