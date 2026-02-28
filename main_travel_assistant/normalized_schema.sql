-- =====================================================
-- NORMALIZED SCHEMA — Rule-First Travel Bot
-- 8 tables + indexes + seed data (Ninh Bình focus)
-- Matches plan: plan-ruleFirstTravelBotRebuild.prompt.md
-- =====================================================

-- 0. Clean slate
DROP TABLE IF EXISTS search_logs CASCADE;
DROP TABLE IF EXISTS tour_destinations CASCADE;
DROP TABLE IF EXISTS tours CASCADE;
DROP TABLE IF EXISTS opening_hours CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS places CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =====================================================
-- 1. CATEGORIES
-- =====================================================
CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  slug VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO categories (name, slug) VALUES
  ('Đền',      'den'),
  ('Chùa',     'chua'),
  ('Danh lam', 'danh-lam'),
  ('Hang động', 'hang-dong'),
  ('Hồ',       'ho'),
  ('Núi',      'nui'),
  ('Bãi biển', 'bai-bien'),
  ('Khu vực',  'khu-vuc');

-- =====================================================
-- 2. PLACES  (B4: UNIQUE slug)
-- =====================================================
CREATE TABLE places (
  id          SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id),
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(120) NOT NULL UNIQUE,          -- B4: prevents duplicate slugs
  description TEXT,
  latitude    NUMERIC(10,6),
  longitude   NUMERIC(10,6),
  place_type  VARCHAR(30) DEFAULT 'landmark',
  is_active   BOOLEAN DEFAULT true
);

CREATE INDEX idx_places_slug ON places(slug);

-- Seed: Ninh Bình POIs (slugs match canonical slugify() — B5)
-- slugify("Đền Thái Vi") → "den-thai-vi"
INSERT INTO places (category_id, name, slug, description, latitude, longitude, place_type) VALUES
  (1, 'Đền Thái Vi',
      'den-thai-vi',
      'Đền thờ vua Trần Thái Tông, nằm trong khu danh thắng Tràng An, Ninh Bình. Kiến trúc cổ kính giữa núi non hùng vĩ.',
      20.224117, 105.929381, 'temple'),

  (2, 'Chùa Bái Đính',
      'chua-bai-dinh',
      'Quần thể chùa lớn nhất Đông Nam Á tại Gia Viễn, Ninh Bình. Gồm khu chùa cổ và chùa mới với nhiều kỷ lục.',
      20.273392, 105.854502, 'temple'),

  (2, 'Chùa Bái Đính Cổ',
      'chua-bai-dinh-co',
      'Phần chùa cổ của quần thể Bái Đính, xây dựng từ thời Đinh - Lê, nằm trên sườn núi với hang động tự nhiên.',
      20.269993, 105.865755, 'temple'),

  (3, 'Tràng An',
      'trang-an',
      'Quần thể danh thắng Tràng An — Di sản Thế giới UNESCO. Hệ thống hang động, sông nước và núi đá vôi ngoạn mục.',
      20.250650, 105.937240, 'landmark'),

  (3, 'Tam Cốc',
      'tam-coc',
      'Tam Cốc - Bích Động, được mệnh danh "Hạ Long trên cạn". Ba hang động xuyên núi trên sông Ngô Đồng.',
      20.215540, 105.932250, 'landmark'),

  (5, 'Hồ Hoàn Kiếm',
      'ho-hoan-kiem',
      'Hồ nằm giữa trung tâm Hà Nội, gắn liền với truyền thuyết vua Lê Lợi trả gươm thần.',
      21.028850, 105.852540, 'lake'),

  (3, 'Lăng Chủ tịch Hồ Chí Minh',
      'lang-chu-tich-ho-chi-minh',
      'Công trình tưởng niệm Chủ tịch Hồ Chí Minh tại Ba Đình, Hà Nội.',
      21.036860, 105.834680, 'landmark'),

  (2, 'Chùa Một Cột',
      'chua-mot-cot',
      'Biểu tượng kiến trúc Việt Nam — ngôi chùa có kiến trúc độc đáo hình bông sen trên một cột đá.',
      21.035900, 105.833430, 'temple'),

  (3, 'Vịnh Hạ Long',
      'vinh-ha-long',
      'Di sản Thiên nhiên Thế giới với hàng nghìn đảo đá vôi trên vịnh Bắc Bộ.',
      20.910200, 107.184000, 'landmark'),

  (4, 'Động Phong Nha',
      'dong-phong-nha',
      'Hệ thống hang động Phong Nha - Kẻ Bàng thuộc Quảng Bình, Di sản Thiên nhiên Thế giới.',
      17.589950, 106.283150, 'cave'),

  (8, 'Phố cổ Hội An',
      'pho-co-hoi-an',
      'Đô thị cổ Hội An — Di sản Văn hóa Thế giới, phố đèn lồng nổi tiếng tại Quảng Nam.',
      15.880150, 108.338050, 'area'),

  (3, 'Bà Nà Hills',
      'ba-na-hills',
      'Khu du lịch trên đỉnh núi Chúa, Đà Nẵng. Nổi tiếng với Cầu Vàng và làng Pháp.',
      15.997750, 107.987600, 'landmark'),

  (8, 'Sapa',
      'sapa',
      'Thị trấn vùng cao thuộc Lào Cai, nổi tiếng ruộng bậc thang và đỉnh Fansipan.',
      22.336450, 103.843850, 'area'),

  (3, 'Cố đô Huế',
      'co-do-hue',
      'Quần thể di tích Cố đô Huế — Di sản Văn hóa Thế giới, gồm Hoàng thành, lăng tẩm và chùa chiền.',
      16.469850, 107.579750, 'landmark'),

  (7, 'Mũi Né',
      'mui-ne',
      'Bãi biển và đồi cát nổi tiếng tại Bình Thuận, thiên đường lướt ván diều.',
      10.933350, 108.287250, 'beach'),

  (6, 'Núi Bà Đen',
      'nui-ba-den',
      'Ngọn núi cao nhất Nam Bộ (986m) tại Tây Ninh, có hệ thống cáp treo hiện đại.',
      11.364250, 106.143950, 'mountain');

-- =====================================================
-- 3. TICKETS
-- =====================================================
CREATE TABLE tickets (
  id          SERIAL PRIMARY KEY,
  place_id    INT REFERENCES places(id) ON DELETE CASCADE,
  ticket_type VARCHAR(60) NOT NULL DEFAULT 'general',
  adult_price INT DEFAULT 0,       -- VND
  child_price INT DEFAULT 0,       -- VND
  notes       TEXT
);

CREATE INDEX idx_tickets_place_id ON tickets(place_id);

-- Seed ticket data (Ninh Bình focus)
INSERT INTO tickets (place_id, ticket_type, adult_price, child_price, notes) VALUES
  -- Đền Thái Vi (id=1)
  (1, 'Vé tham quan', 0, 0, 'Miễn phí'),

  -- Chùa Bái Đính (id=2)
  (2, 'Vé tham quan', 100000, 50000, 'Bao gồm xe điện'),
  (2, 'Vé xe điện riêng', 30000, 20000, 'Xe điện nội khu'),

  -- Chùa Bái Đính Cổ (id=3)
  (3, 'Vé tham quan', 0, 0, 'Miễn phí'),

  -- Tràng An (id=4)
  (4, 'Vé thuyền', 250000, 120000, 'Tuyến tham quan 3 hang, ~3 giờ'),
  (4, 'Vé thuyền tuyến dài', 250000, 120000, 'Tuyến 9 hang, ~4 giờ'),

  -- Tam Cốc (id=5)
  (5, 'Vé thuyền', 150000, 75000, 'Bao gồm đò và phí hang động'),

  -- Hồ Hoàn Kiếm (id=6)
  (6, 'Miễn phí', 0, 0, 'Khu vực công cộng, đi bộ tự do'),

  -- Vịnh Hạ Long (id=9)
  (9, 'Vé tham quan vịnh', 250000, 100000, 'Vé lên tàu, chưa bao gồm tour'),

  -- Động Phong Nha (id=10)
  (10, 'Vé tham quan', 150000, 60000, 'Bao gồm thuyền vào hang'),

  -- Phố cổ Hội An (id=11)
  (11, 'Vé tham quan phố cổ', 120000, 0, 'Tham quan 5 điểm trong phố cổ'),

  -- Bà Nà Hills (id=12)
  (12, 'Vé cáp treo + công viên', 900000, 700000, 'Bao gồm Fantasy Park, vườn hoa'),

  -- Sapa - Fansipan (id=13)
  (13, 'Vé cáp treo Fansipan', 750000, 550000, 'Cáp treo lên đỉnh Fansipan'),

  -- Cố đô Huế (id=14)
  (14, 'Vé Đại Nội', 200000, 40000, 'Tham quan Hoàng thành Huế'),

  -- Núi Bà Đen (id=16)
  (16, 'Vé cáp treo', 200000, 100000, 'Cáp treo lên đỉnh');

-- =====================================================
-- 4. OPENING HOURS  (per-day granularity, 0=Sunday)
-- =====================================================
CREATE TABLE opening_hours (
  id          SERIAL PRIMARY KEY,
  place_id    INT REFERENCES places(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   TIME,
  close_time  TIME,
  is_closed   BOOLEAN DEFAULT false
);

CREATE INDEX idx_hours_place_id_day ON opening_hours(place_id, day_of_week);

-- Helper: bulk insert 7-day schedule
-- Đền Thái Vi: 6:00-18:00 every day
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 1, d, '06:00', '18:00', false FROM generate_series(0, 6) AS d;

-- Chùa Bái Đính: 6:00-20:00 every day
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 2, d, '06:00', '20:00', false FROM generate_series(0, 6) AS d;

-- Chùa Bái Đính Cổ: 7:00-17:00 every day
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 3, d, '07:00', '17:00', false FROM generate_series(0, 6) AS d;

-- Tràng An: 6:00-16:00 (last boat 15:00)
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 4, d, '06:00', '16:00', false FROM generate_series(0, 6) AS d;

-- Tam Cốc: 6:00-16:30
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 5, d, '06:00', '16:30', false FROM generate_series(0, 6) AS d;

-- Hồ Hoàn Kiếm: 24/7
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 6, d, '00:00', '23:59', false FROM generate_series(0, 6) AS d;

-- Lăng Bác: 7:30-10:30 Tue-Thu, 7:30-11:00 Sat-Sun, closed Mon & Fri
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed) VALUES
  (7, 0, '07:30', '11:00', false),  -- Sun
  (7, 1, NULL, NULL, true),          -- Mon  (closed)
  (7, 2, '07:30', '10:30', false),   -- Tue
  (7, 3, '07:30', '10:30', false),   -- Wed
  (7, 4, '07:30', '10:30', false),   -- Thu
  (7, 5, NULL, NULL, true),          -- Fri  (closed)
  (7, 6, '07:30', '11:00', false);   -- Sat

-- Chùa Một Cột: 7:00-18:00
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 8, d, '07:00', '18:00', false FROM generate_series(0, 6) AS d;

-- Vịnh Hạ Long: 6:00-17:00
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 9, d, '06:00', '17:00', false FROM generate_series(0, 6) AS d;

-- Động Phong Nha: 7:00-16:00
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 10, d, '07:00', '16:00', false FROM generate_series(0, 6) AS d;

-- Phố cổ Hội An: 7:00-21:30
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 11, d, '07:00', '21:30', false FROM generate_series(0, 6) AS d;

-- Bà Nà Hills: 7:30-21:00
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 12, d, '07:30', '21:00', false FROM generate_series(0, 6) AS d;

-- Sapa: outdoor, open always
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 13, d, '00:00', '23:59', false FROM generate_series(0, 6) AS d;

-- Cố đô Huế: 7:00-17:30 (summer 5:30)
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 14, d, '07:00', '17:30', false FROM generate_series(0, 6) AS d;

-- Mũi Né: outdoor, open always
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 15, d, '00:00', '23:59', false FROM generate_series(0, 6) AS d;

-- Núi Bà Đen (cáp treo): 5:30-20:00
INSERT INTO opening_hours (place_id, day_of_week, open_time, close_time, is_closed)
SELECT 16, d, '05:30', '20:00', false FROM generate_series(0, 6) AS d;

-- =====================================================
-- 5. TOURS
-- =====================================================
CREATE TABLE tours (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  duration_days INT NOT NULL DEFAULT 1,
  price         INT DEFAULT 0,         -- VND
  description   TEXT,
  highlights    TEXT,
  is_active     BOOLEAN DEFAULT true
);

CREATE INDEX idx_tours_duration ON tours(duration_days);

INSERT INTO tours (name, duration_days, price, description, highlights) VALUES
  ('Tour Tràng An - Bái Đính 1 ngày',
   1, 750000,
   'Khám phá quần thể danh thắng Tràng An và chùa Bái Đính trong 1 ngày.',
   'Đi thuyền Tràng An, tham quan chùa Bái Đính mới và cổ'),

  ('Tour Ninh Bình 2 ngày 1 đêm',
   2, 1500000,
   'Hành trình trọn vẹn khám phá Ninh Bình: Tràng An, Tam Cốc, Bái Đính, Đền Thái Vi.',
   'Tràng An, Tam Cốc - Bích Động, chùa Bái Đính, Đền Thái Vi'),

  ('Tour Ninh Bình 3 ngày 2 đêm',
   3, 2800000,
   'Tour sâu Ninh Bình bao gồm tất cả các điểm nổi tiếng và vườn quốc gia Cúc Phương.',
   'Tràng An, Tam Cốc, Bái Đính, Đền Thái Vi, VQG Cúc Phương');

-- =====================================================
-- 6. TOUR DESTINATIONS  (linking tours ↔ places)
-- =====================================================
CREATE TABLE tour_destinations (
  id                 SERIAL PRIMARY KEY,
  tour_id            INT REFERENCES tours(id) ON DELETE CASCADE,
  place_id           INT REFERENCES places(id) ON DELETE CASCADE,
  visit_order        INT NOT NULL DEFAULT 1,
  stay_duration_hours NUMERIC(4,1) DEFAULT 2
);

-- Tour 1: Tràng An → Bái Đính
INSERT INTO tour_destinations (tour_id, place_id, visit_order, stay_duration_hours) VALUES
  (1, 4, 1, 3.0),   -- Tràng An
  (1, 2, 2, 2.5);   -- Chùa Bái Đính

-- Tour 2: Tràng An → Tam Cốc → Bái Đính → Thái Vi
INSERT INTO tour_destinations (tour_id, place_id, visit_order, stay_duration_hours) VALUES
  (2, 4, 1, 3.0),   -- Tràng An
  (2, 5, 2, 2.5),   -- Tam Cốc
  (2, 2, 3, 2.0),   -- Chùa Bái Đính
  (2, 1, 4, 1.0);   -- Đền Thái Vi

-- Tour 3: Tràng An → Tam Cốc → Bái Đính → Thái Vi → Bái Đính Cổ
INSERT INTO tour_destinations (tour_id, place_id, visit_order, stay_duration_hours) VALUES
  (3, 4, 1, 3.0),   -- Tràng An
  (3, 5, 2, 2.5),   -- Tam Cốc
  (3, 2, 3, 2.5),   -- Chùa Bái Đính
  (3, 1, 4, 1.5),   -- Đền Thái Vi
  (3, 3, 5, 1.5);   -- Chùa Bái Đính Cổ

-- =====================================================
-- 7. USERS
-- =====================================================
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  session_id VARCHAR(100) NOT NULL UNIQUE,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 8. SEARCH LOGS
-- =====================================================
CREATE TABLE search_logs (
  id                 SERIAL PRIMARY KEY,
  session_id         VARCHAR(100),
  intent             VARCHAR(40),
  entity             VARCHAR(200),
  source             VARCHAR(30),      -- 'rule' | 'llm'
  latency_ms         INT,
  cache_hit          BOOLEAN DEFAULT false,
  fallback_triggered BOOLEAN DEFAULT false,
  error_type         VARCHAR(60),
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logs_session ON search_logs(session_id);
CREATE INDEX idx_logs_created ON search_logs(created_at);

-- =====================================================
-- VERIFY
-- =====================================================
SELECT 'categories' AS tbl, count(*) FROM categories
UNION ALL SELECT 'places', count(*) FROM places
UNION ALL SELECT 'tickets', count(*) FROM tickets
UNION ALL SELECT 'opening_hours', count(*) FROM opening_hours
UNION ALL SELECT 'tours', count(*) FROM tours
UNION ALL SELECT 'tour_destinations', count(*) FROM tour_destinations;
