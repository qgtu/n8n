-- =========================================================================
-- Unified Schema — Travel Assistant (Web + Bot)
-- PostgreSQL 15+ with PostGIS  |  Encoding: UTF-8
-- =========================================================================
--
-- SINGLE SOURCE OF TRUTH — merges:
--   1. Web schema (categories, attractions, tours, media, VR, events, reviews, etc.)
--   2. Bot tables (tickets, opening_hours, location_aliases, intent_keywords,
--      bot_sessions, update_logs, search_logs, alias_misses)
--   3. All seed data (16 attractions, 15 tickets, 112 opening hours, 3 tours,
--      10 tour stops, ~90 location aliases, ~70 intent keywords)
--
-- Usage (fresh DB):
--   createdb -U postgres disciplined_travel
--   psql -U postgres -d disciplined_travel -f schema.sql
--
-- =========================================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. WEB TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories for tourist attractions (+ slug for bot)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name_vi VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    icon VARCHAR(255),
    color VARCHAR(7) DEFAULT '#2E8B57',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tourist attractions (+ slug, province, place_type for bot)
CREATE TABLE attractions (
    id SERIAL PRIMARY KEY,
    name_vi VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    province VARCHAR(100),
    place_type VARCHAR(30) DEFAULT 'landmark',
    description_vi TEXT,
    description_en TEXT,
    category_id INTEGER REFERENCES categories(id),
    location GEOMETRY(POINT, 4326) NOT NULL,
    address_vi VARCHAR(500),
    address_en VARCHAR(500),
    opening_hours VARCHAR(255),
    ticket_price VARCHAR(255),
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    website VARCHAR(255),
    featured_image VARCHAR(500),
    status VARCHAR(20) DEFAULT 'active',
    view_count INTEGER DEFAULT 0,
    rating_avg DECIMAL(2,1) DEFAULT 0.0,
    rating_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Media files (images, videos, audio)
CREATE TABLE media (
    id SERIAL PRIMARY KEY,
    attraction_id INTEGER REFERENCES attractions(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    title_vi VARCHAR(255),
    title_en VARCHAR(255),
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    is_featured BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 360 VR scenes
CREATE TABLE vr_scenes (
    id SERIAL PRIMARY KEY,
    attraction_id INTEGER REFERENCES attractions(id) ON DELETE CASCADE,
    name_vi VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    image_path VARCHAR(500) NOT NULL,
    audio_path VARCHAR(500),
    subtitle_vi TEXT,
    subtitle_en TEXT,
    is_main_scene BOOLEAN DEFAULT FALSE,
    position_x DECIMAL(10,6),
    position_y DECIMAL(10,6),
    position_z DECIMAL(10,6),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Navigation hotspots between VR scenes
CREATE TABLE vr_hotspots (
    id SERIAL PRIMARY KEY,
    from_scene_id INTEGER REFERENCES vr_scenes(id) ON DELETE CASCADE,
    to_scene_id INTEGER REFERENCES vr_scenes(id) ON DELETE CASCADE,
    position_x DECIMAL(10,6) NOT NULL,
    position_y DECIMAL(10,6) NOT NULL,
    position_z DECIMAL(10,6) NOT NULL,
    icon VARCHAR(255) DEFAULT 'arrow',
    title_vi VARCHAR(255),
    title_en VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tours (+ duration_days, price, highlights, is_active for bot)
CREATE TABLE tours (
    id SERIAL PRIMARY KEY,
    name_vi VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    description_vi TEXT,
    description_en TEXT,
    duration VARCHAR(100),
    duration_days INTEGER NOT NULL DEFAULT 1,
    price INTEGER DEFAULT 0,
    highlights TEXT,
    difficulty VARCHAR(50),
    featured_image VARCHAR(500),
    is_recommended BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tour stops (+ stay_duration_hours, UNIQUE constraint for bot)
CREATE TABLE tour_stops (
    id SERIAL PRIMARY KEY,
    tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
    attraction_id INTEGER REFERENCES attractions(id) ON DELETE CASCADE,
    stop_order INTEGER NOT NULL,
    duration_minutes INTEGER,
    stay_duration_hours NUMERIC(4,1) DEFAULT 2.0,
    notes_vi TEXT,
    notes_en TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tour_id, attraction_id)
);

-- Events and festivals
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    name_vi VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    description_vi TEXT,
    description_en TEXT,
    attraction_id INTEGER REFERENCES attractions(id),
    start_date DATE NOT NULL,
    end_date DATE,
    start_time TIME,
    end_time TIME,
    featured_image VARCHAR(500),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User ratings and reviews
CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    attraction_id INTEGER REFERENCES attractions(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, attraction_id)
);

-- Visit logs for analytics
CREATE TABLE visit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    attraction_id INTEGER REFERENCES attractions(id),
    ip_address INET,
    user_agent TEXT,
    visit_date DATE DEFAULT CURRENT_DATE,
    visit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System settings
CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value_vi TEXT,
    value_en TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. BOT-ONLY TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Tickets (structured pricing data for bot GET_TICKET_PRICE handler)
CREATE TABLE tickets (
    id SERIAL PRIMARY KEY,
    attraction_id INTEGER NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
    ticket_type VARCHAR(60) NOT NULL DEFAULT 'general',
    adult_price INTEGER DEFAULT 0,
    child_price INTEGER DEFAULT 0,
    notes TEXT
);

-- Opening hours (structured schedule for bot GET_OPENING_HOURS handler)
CREATE TABLE opening_hours (
    id SERIAL PRIMARY KEY,
    attraction_id INTEGER NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    open_time TIME,
    close_time TIME,
    is_closed BOOLEAN DEFAULT false,
    UNIQUE (attraction_id, day_of_week)
);

-- Location aliases (user shorthand → attraction FK)
-- alias stores stripped-diacritics text, e.g. "trang an", "bd"
-- Resolution: alias → attraction_id → attractions.slug (single JOIN)
CREATE TABLE location_aliases (
    id SERIAL PRIMARY KEY,
    alias VARCHAR(100) NOT NULL UNIQUE,
    attraction_id INTEGER NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Intent keywords (hybrid keyword classification from DB)
-- Loaded into memory at server startup by loadIntentKeywords()
-- All keywords stored diacritics-stripped
CREATE TABLE intent_keywords (
    id SERIAL PRIMARY KEY,
    intent_type VARCHAR(50) NOT NULL,
    keyword VARCHAR(200) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bot sessions (multi-turn conversation state)
CREATE TABLE bot_sessions (
    session_id VARCHAR(100) NOT NULL PRIMARY KEY,
    context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

-- Update logs (Telegram update_id idempotency)
CREATE TABLE update_logs (
    update_id VARCHAR(100) NOT NULL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Search logs (analytics + monitoring)
CREATE TABLE search_logs (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100),
    intent VARCHAR(50),
    entity VARCHAR(200),
    source VARCHAR(30),
    is_unknown BOOLEAN DEFAULT false,
    is_missing_entity BOOLEAN DEFAULT false,
    is_fallback BOOLEAN DEFAULT false,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alias misses (entity names that fail resolution — for analysis)
CREATE TABLE alias_misses (
    id SERIAL PRIMARY KEY,
    entity_normalized VARCHAR(200) NOT NULL UNIQUE,
    entity_raw VARCHAR(200),
    reason VARCHAR(50),
    hit_count INTEGER DEFAULT 1,
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. UTILITY FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Update attraction rating when reviews change
CREATE OR REPLACE FUNCTION update_attraction_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE attractions
    SET
        rating_avg = (
            SELECT COALESCE(AVG(rating), 0)::DECIMAL(2,1)
            FROM reviews
            WHERE attraction_id = COALESCE(NEW.attraction_id, OLD.attraction_id)
            AND status = 'approved'
        ),
        rating_count = (
            SELECT COUNT(*)
            FROM reviews
            WHERE attraction_id = COALESCE(NEW.attraction_id, OLD.attraction_id)
            AND status = 'approved'
        )
    WHERE id = COALESCE(NEW.attraction_id, OLD.attraction_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_rating
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_attraction_rating();

-- Cleanup expired bot sessions (call via pg_cron or external scheduler)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM bot_sessions WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Cleanup stale idempotency keys older than 24 hours
CREATE OR REPLACE FUNCTION cleanup_stale_update_logs() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM update_logs WHERE created_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- Web indexes
CREATE INDEX idx_attractions_location ON attractions USING GIST (location);
CREATE INDEX idx_attractions_category ON attractions(category_id);
CREATE INDEX idx_attractions_status ON attractions(status);
CREATE INDEX idx_media_attraction ON media(attraction_id);
CREATE INDEX idx_vr_scenes_attraction ON vr_scenes(attraction_id);
CREATE INDEX idx_reviews_attraction ON reviews(attraction_id);
CREATE INDEX idx_reviews_status ON reviews(status);
CREATE INDEX idx_visit_logs_date ON visit_logs(visit_date);
CREATE INDEX idx_events_dates ON events(start_date, end_date);

-- Bot indexes
CREATE INDEX idx_attractions_slug ON attractions(slug);
CREATE INDEX idx_tickets_attraction ON tickets(attraction_id);
CREATE INDEX idx_hours_attraction_day ON opening_hours(attraction_id, day_of_week);
CREATE INDEX idx_tours_duration ON tours(duration_days);
CREATE INDEX idx_tours_active ON tours(is_active) WHERE is_active = true;
CREATE INDEX idx_aliases_alias ON location_aliases(alias);
CREATE INDEX idx_aliases_attraction ON location_aliases(attraction_id);
CREATE UNIQUE INDEX idx_ik_unique ON intent_keywords(intent_type, keyword);
CREATE INDEX idx_ik_active ON intent_keywords(active, priority DESC);
CREATE INDEX idx_sessions_expires ON bot_sessions(expires_at);
CREATE INDEX idx_sessions_updated ON bot_sessions(updated_at);
CREATE INDEX idx_update_logs_created ON update_logs(created_at);
CREATE INDEX idx_logs_created ON search_logs(created_at);
CREATE INDEX idx_logs_session ON search_logs(session_id);
CREATE INDEX idx_logs_intent ON search_logs(intent);
CREATE INDEX idx_logs_unknown ON search_logs(is_unknown) WHERE is_unknown = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. SEED DATA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 5.1 Categories ──
INSERT INTO categories (id, name_vi, name_en, slug) VALUES
  (1, 'Đền',       'Temple',      'den'),
  (2, 'Chùa',      'Pagoda',      'chua'),
  (3, 'Danh lam',  'Scenic Spot', 'danh-lam'),
  (4, 'Hang động', 'Cave',        'hang-dong'),
  (5, 'Hồ',        'Lake',        'ho'),
  (6, 'Núi',       'Mountain',    'nui'),
  (7, 'Bãi biển',  'Beach',       'bai-bien'),
  (8, 'Khu vực',   'Area',        'khu-vuc')
ON CONFLICT (slug) DO NOTHING;

SELECT setval('categories_id_seq', COALESCE((SELECT MAX(id) FROM categories), 0) + 1, false);

-- ── 5.2 Attractions ──
INSERT INTO attractions (id, category_id, name_vi, name_en, slug, description_vi, location, place_type, status, province) VALUES
  (1,  1, 'Đền Thái Vi',               'Thai Vi Temple',                'den-thai-vi',               'Đền thờ vua Trần Thái Tông, nằm trong khu danh thắng Tràng An, Ninh Bình. Kiến trúc cổ kính giữa núi non hùng vĩ.',                    ST_SetSRID(ST_MakePoint(105.929381, 20.224117), 4326), 'temple',   'active', 'Ninh Bình'),
  (2,  2, 'Chùa Bái Đính',             'Bai Dinh Pagoda',               'chua-bai-dinh',             'Quần thể chùa lớn nhất Đông Nam Á tại Gia Viễn, Ninh Bình. Gồm khu chùa cổ và chùa mới với nhiều kỷ lục.',                            ST_SetSRID(ST_MakePoint(105.854502, 20.273392), 4326), 'temple',   'active', 'Ninh Bình'),
  (3,  2, 'Chùa Bái Đính Cổ',          'Ancient Bai Dinh Pagoda',       'chua-bai-dinh-co',          'Phần chùa cổ của quần thể Bái Đính, xây dựng từ thời Đinh - Lê, nằm trên sườn núi với hang động tự nhiên.',                           ST_SetSRID(ST_MakePoint(105.865755, 20.269993), 4326), 'temple',   'active', 'Ninh Bình'),
  (4,  3, 'Tràng An',                   'Trang An Landscape Complex',    'trang-an',                  'Quần thể danh thắng Tràng An — Di sản Thế giới UNESCO. Hệ thống hang động, sông nước và núi đá vôi ngoạn mục.',                        ST_SetSRID(ST_MakePoint(105.937240, 20.250650), 4326), 'landmark', 'active', 'Ninh Bình'),
  (5,  3, 'Tam Cốc',                    'Tam Coc - Bich Dong',           'tam-coc',                   'Tam Cốc - Bích Động, được mệnh danh "Hạ Long trên cạn". Ba hang động xuyên núi trên sông Ngô Đồng.',                                  ST_SetSRID(ST_MakePoint(105.932250, 20.215540), 4326), 'landmark', 'active', 'Ninh Bình'),
  (6,  5, 'Hồ Hoàn Kiếm',              'Hoan Kiem Lake',                'ho-hoan-kiem',              'Hồ nằm giữa trung tâm Hà Nội, gắn liền với truyền thuyết vua Lê Lợi trả gươm thần.',                                                  ST_SetSRID(ST_MakePoint(105.852540, 21.028850), 4326), 'lake',     'active', 'Hà Nội'),
  (7,  3, 'Lăng Chủ tịch Hồ Chí Minh', 'Ho Chi Minh Mausoleum',         'lang-chu-tich-ho-chi-minh', 'Công trình tưởng niệm Chủ tịch Hồ Chí Minh tại Ba Đình, Hà Nội.',                                                                    ST_SetSRID(ST_MakePoint(105.834680, 21.036860), 4326), 'landmark', 'active', 'Hà Nội'),
  (8,  2, 'Chùa Một Cột',              'One Pillar Pagoda',              'chua-mot-cot',              'Biểu tượng kiến trúc Việt Nam — ngôi chùa có kiến trúc độc đáo hình bông sen trên một cột đá.',                                        ST_SetSRID(ST_MakePoint(105.833430, 21.035900), 4326), 'temple',   'active', 'Hà Nội'),
  (9,  3, 'Vịnh Hạ Long',              'Ha Long Bay',                    'vinh-ha-long',              'Di sản Thiên nhiên Thế giới với hàng nghìn đảo đá vôi trên vịnh Bắc Bộ.',                                                               ST_SetSRID(ST_MakePoint(107.184000, 20.910200), 4326), 'landmark', 'active', 'Quảng Ninh'),
  (10, 4, 'Động Phong Nha',            'Phong Nha Cave',                 'dong-phong-nha',            'Hệ thống hang động Phong Nha - Kẻ Bàng thuộc Quảng Bình, Di sản Thiên nhiên Thế giới.',                                                ST_SetSRID(ST_MakePoint(106.283150, 17.589950), 4326), 'cave',     'active', 'Quảng Bình'),
  (11, 8, 'Phố cổ Hội An',             'Hoi An Ancient Town',            'pho-co-hoi-an',             'Đô thị cổ Hội An — Di sản Văn hóa Thế giới, phố đèn lồng nổi tiếng tại Quảng Nam.',                                                   ST_SetSRID(ST_MakePoint(108.338050, 15.880150), 4326), 'area',     'active', 'Quảng Nam'),
  (12, 3, 'Bà Nà Hills',               'Ba Na Hills',                    'ba-na-hills',               'Khu du lịch trên đỉnh núi Chúa, Đà Nẵng. Nổi tiếng với Cầu Vàng và làng Pháp.',                                                       ST_SetSRID(ST_MakePoint(107.987600, 15.997750), 4326), 'landmark', 'active', 'Đà Nẵng'),
  (13, 8, 'Sapa',                       'Sapa',                           'sapa',                      'Thị trấn vùng cao thuộc Lào Cai, nổi tiếng ruộng bậc thang và đỉnh Fansipan.',                                                          ST_SetSRID(ST_MakePoint(103.843850, 22.336450), 4326), 'area',     'active', 'Lào Cai'),
  (14, 3, 'Cố đô Huế',                 'Hue Imperial City',              'co-do-hue',                 'Quần thể di tích Cố đô Huế — Di sản Văn hóa Thế giới, gồm Hoàng thành, lăng tẩm và chùa chiền.',                                     ST_SetSRID(ST_MakePoint(107.579750, 16.469850), 4326), 'landmark', 'active', 'Thừa Thiên Huế'),
  (15, 7, 'Mũi Né',                    'Mui Ne',                         'mui-ne',                    'Bãi biển và đồi cát nổi tiếng tại Bình Thuận, thiên đường lướt ván diều.',                                                              ST_SetSRID(ST_MakePoint(108.287250, 10.933350), 4326), 'beach',    'active', 'Bình Thuận'),
  (16, 6, 'Núi Bà Đen',                'Ba Den Mountain',                'nui-ba-den',                'Ngọn núi cao nhất Nam Bộ (986m) tại Tây Ninh, có hệ thống cáp treo hiện đại.',                                                          ST_SetSRID(ST_MakePoint(106.143950, 11.364250), 4326), 'mountain', 'active', 'Tây Ninh')
ON CONFLICT (slug) DO NOTHING;

SELECT setval('attractions_id_seq', COALESCE((SELECT MAX(id) FROM attractions), 0) + 1, false);

-- ── 5.3 Tickets ──
INSERT INTO tickets (id, attraction_id, ticket_type, adult_price, child_price, notes) VALUES
  (1,  1,  'Vé tham quan',             0,      0,      'Miễn phí'),
  (2,  2,  'Vé tham quan',             100000, 50000,  'Bao gồm xe điện'),
  (3,  2,  'Vé xe điện riêng',         30000,  20000,  'Xe điện nội khu'),
  (4,  3,  'Vé tham quan',             0,      0,      'Miễn phí'),
  (5,  4,  'Vé thuyền',                250000, 120000, 'Tuyến tham quan 3 hang, ~3 giờ'),
  (6,  4,  'Vé thuyền tuyến dài',      250000, 120000, 'Tuyến 9 hang, ~4 giờ'),
  (7,  5,  'Vé thuyền',                150000, 75000,  'Bao gồm đò và phí hang động'),
  (8,  6,  'Miễn phí',                 0,      0,      'Khu vực công cộng, đi bộ tự do'),
  (9,  9,  'Vé tham quan vịnh',        250000, 100000, 'Vé lên tàu, chưa bao gồm tour'),
  (10, 10, 'Vé tham quan',             150000, 60000,  'Bao gồm thuyền vào hang'),
  (11, 11, 'Vé tham quan phố cổ',      120000, 0,      'Tham quan 5 điểm trong phố cổ'),
  (12, 12, 'Vé cáp treo + công viên',  900000, 700000, 'Bao gồm Fantasy Park, vườn hoa'),
  (13, 13, 'Vé cáp treo Fansipan',     750000, 550000, 'Cáp treo lên đỉnh Fansipan'),
  (14, 14, 'Vé Đại Nội',               200000, 40000,  'Tham quan Hoàng thành Huế'),
  (15, 16, 'Vé cáp treo',              200000, 100000, 'Cáp treo lên đỉnh')
ON CONFLICT DO NOTHING;

SELECT setval('tickets_id_seq', COALESCE((SELECT MAX(id) FROM tickets), 0) + 1, false);

-- ── 5.4 Opening Hours ──
-- Attraction 1: Đền Thái Vi (06:00-18:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 1, d, '06:00'::time, '18:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 2: Chùa Bái Đính (06:00-20:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 2, d, '06:00'::time, '20:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 3: Chùa Bái Đính Cổ (07:00-17:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 3, d, '07:00'::time, '17:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 4: Tràng An (06:00-16:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 4, d, '06:00'::time, '16:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 5: Tam Cốc (06:00-16:30 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 5, d, '06:00'::time, '16:30'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 6: Hồ Hoàn Kiếm (24h daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 6, d, '00:00'::time, '23:59'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 7: Lăng HCM (closed Mon+Fri, other days 07:30-11:00 or 07:30-10:30)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed) VALUES
  (7, 0, '07:30', '11:00', false),
  (7, 1, NULL,    NULL,    true),
  (7, 2, '07:30', '10:30', false),
  (7, 3, '07:30', '10:30', false),
  (7, 4, '07:30', '10:30', false),
  (7, 5, NULL,    NULL,    true),
  (7, 6, '07:30', '11:00', false)
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 8: Chùa Một Cột (07:00-18:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 8, d, '07:00'::time, '18:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 9: Vịnh Hạ Long (06:00-17:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 9, d, '06:00'::time, '17:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 10: Động Phong Nha (07:00-16:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 10, d, '07:00'::time, '16:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 11: Phố cổ Hội An (07:00-21:30 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 11, d, '07:00'::time, '21:30'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 12: Bà Nà Hills (07:30-21:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 12, d, '07:30'::time, '21:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 13: Sapa (24h — open area)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 13, d, '00:00'::time, '23:59'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 14: Cố đô Huế (07:00-17:30 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 14, d, '07:00'::time, '17:30'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 15: Mũi Né (24h — beach)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 15, d, '00:00'::time, '23:59'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- Attraction 16: Núi Bà Đen (05:30-20:00 daily)
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT 16, d, '05:30'::time, '20:00'::time, false FROM generate_series(0,6) d
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- ── 5.5 Tours ──
INSERT INTO tours (id, name_vi, name_en, duration_days, price, description_vi, highlights, is_active) VALUES
  (1, 'Tour Tràng An - Bái Đính 1 ngày',   'Trang An - Bai Dinh 1 Day Tour',   1, 750000,
   'Khám phá quần thể danh thắng Tràng An và chùa Bái Đính trong 1 ngày.',
   'Đi thuyền Tràng An, tham quan chùa Bái Đính mới và cổ', true),
  (2, 'Tour Ninh Bình 2 ngày 1 đêm',       'Ninh Binh 2 Day 1 Night Tour',     2, 1500000,
   'Hành trình trọn vẹn khám phá Ninh Bình: Tràng An, Tam Cốc, Bái Đính, Đền Thái Vi.',
   'Tràng An, Tam Cốc - Bích Động, chùa Bái Đính, Đền Thái Vi', true),
  (3, 'Tour Ninh Bình 3 ngày 2 đêm',       'Ninh Binh 3 Day 2 Night Tour',     3, 2800000,
   'Tour sâu Ninh Bình bao gồm tất cả các điểm nổi tiếng và vườn quốc gia Cúc Phương.',
   'Tràng An, Tam Cốc, Bái Đính, Đền Thái Vi, VQG Cúc Phương', true)
ON CONFLICT DO NOTHING;

SELECT setval('tours_id_seq', COALESCE((SELECT MAX(id) FROM tours), 0) + 1, false);

-- ── 5.6 Tour Stops ──
INSERT INTO tour_stops (tour_id, attraction_id, stop_order, stay_duration_hours) VALUES
  -- Tour 1: Tràng An → Bái Đính
  (1, 4, 1, 3.0),
  (1, 2, 2, 2.5),
  -- Tour 2: Tràng An → Tam Cốc → Bái Đính → Đền Thái Vi
  (2, 4, 1, 3.0),
  (2, 5, 2, 2.5),
  (2, 2, 3, 2.0),
  (2, 1, 4, 1.0),
  -- Tour 3: Full Ninh Bình
  (3, 4, 1, 3.0),
  (3, 5, 2, 2.5),
  (3, 2, 3, 2.5),
  (3, 1, 4, 1.5),
  (3, 3, 5, 1.5)
ON CONFLICT (tour_id, attraction_id) DO NOTHING;

-- ── 5.7 Location Aliases ──
-- Slug-based subquery (safe on DB rebuild even if IDs shift)
-- Merged from all bot migrations: 000 + 003 + 004

INSERT INTO location_aliases (alias, attraction_id)
SELECT v.alias, p.id FROM (VALUES
  -- Đền Thái Vi
  ('den thai vi',          'den-thai-vi'),
  ('thai vi',              'den-thai-vi'),
  ('dtv',                  'den-thai-vi'),
  ('den',                  'den-thai-vi'),
  ('thai vi ninh binh',    'den-thai-vi'),
  -- Chùa Bái Đính
  ('chua bai dinh',        'chua-bai-dinh'),
  ('bai dinh',             'chua-bai-dinh'),
  ('bd',                   'chua-bai-dinh'),
  ('bai dinh ninh binh',   'chua-bai-dinh'),
  ('chua bd',              'chua-bai-dinh'),
  -- Chùa Bái Đính Cổ
  ('chua bai dinh co',     'chua-bai-dinh-co'),
  ('bai dinh co',          'chua-bai-dinh-co'),
  ('chua co bai dinh',     'chua-bai-dinh-co'),
  -- Tràng An
  ('trang an',             'trang-an'),
  ('ta',                   'trang-an'),
  ('quang trang an',       'trang-an'),
  ('trang an ninh binh',   'trang-an'),
  ('danh thang trang an',  'trang-an'),
  ('khu du lich trang an', 'trang-an'),
  -- Tam Cốc
  ('tam coc',              'tam-coc'),
  ('tc',                   'tam-coc'),
  ('tam coc bich dong',    'tam-coc'),
  ('bich dong',            'tam-coc'),
  ('tam coc ninh binh',    'tam-coc'),
  -- Hồ Hoàn Kiếm
  ('ho hoan kiem',         'ho-hoan-kiem'),
  ('hoan kiem',            'ho-hoan-kiem'),
  ('ho guom',              'ho-hoan-kiem'),
  ('ho kiem',              'ho-hoan-kiem'),
  ('ho hoan kiem ha noi',  'ho-hoan-kiem'),
  ('ho guom ha noi',       'ho-hoan-kiem'),
  -- Lăng Chủ tịch Hồ Chí Minh
  ('lang chu tich ho chi minh', 'lang-chu-tich-ho-chi-minh'),
  ('lang bac',             'lang-chu-tich-ho-chi-minh'),
  ('lang ho chi minh',     'lang-chu-tich-ho-chi-minh'),
  ('lang bac ho',          'lang-chu-tich-ho-chi-minh'),
  ('lang chu tich',        'lang-chu-tich-ho-chi-minh'),
  -- Chùa Một Cột
  ('chua mot cot',         'chua-mot-cot'),
  ('mot cot',              'chua-mot-cot'),
  ('chua mot cot ha noi',  'chua-mot-cot'),
  -- Vịnh Hạ Long
  ('vinh ha long',         'vinh-ha-long'),
  ('ha long',              'vinh-ha-long'),
  ('hl',                   'vinh-ha-long'),
  ('ha long bay',          'vinh-ha-long'),
  ('ha long quang ninh',   'vinh-ha-long'),
  -- Động Phong Nha
  ('dong phong nha',       'dong-phong-nha'),
  ('phong nha',            'dong-phong-nha'),
  ('phong nha ke bang',    'dong-phong-nha'),
  ('dong phong nha ke bang', 'dong-phong-nha'),
  -- Phố cổ Hội An
  ('pho co hoi an',        'pho-co-hoi-an'),
  ('hoi an',               'pho-co-hoi-an'),
  ('pho co',               'pho-co-hoi-an'),
  ('hoi an quang nam',     'pho-co-hoi-an'),
  -- Bà Nà Hills
  ('ba na hills',          'ba-na-hills'),
  ('ba na',                'ba-na-hills'),
  ('ba na hill',           'ba-na-hills'),
  ('cau vang',             'ba-na-hills'),
  ('ba na da nang',        'ba-na-hills'),
  -- Sapa
  ('sapa',                 'sapa'),
  ('sa pa',                'sapa'),
  ('sapa lao cai',         'sapa'),
  ('sa pa lao cai',        'sapa'),
  -- Cố đô Huế
  ('co do hue',            'co-do-hue'),
  ('hue',                  'co-do-hue'),
  ('hoang thanh hue',      'co-do-hue'),
  ('dai noi hue',          'co-do-hue'),
  ('kinh thanh hue',       'co-do-hue'),
  -- Mũi Né
  ('mui ne',               'mui-ne'),
  ('mui ne binh thuan',    'mui-ne'),
  ('doi cat mui ne',       'mui-ne'),
  -- Núi Bà Đen
  ('nui ba den',           'nui-ba-den'),
  ('ba den',               'nui-ba-den'),
  ('nui ba den tay ninh',  'nui-ba-den')
) AS v(alias, slug)
JOIN attractions p ON p.slug = v.slug
ON CONFLICT (alias) DO NOTHING;

-- ── 5.8 Intent Keywords (all diacritics-stripped) ──
-- Priority determines evaluation order (highest first)
INSERT INTO intent_keywords (intent_type, keyword, priority) VALUES
  -- GET_TICKET_PRICE (priority 800)
  ('GET_TICKET_PRICE', 'gia ve',          800),
  ('GET_TICKET_PRICE', 'bao nhieu tien',  800),
  ('GET_TICKET_PRICE', 'ticket price',    800),
  ('GET_TICKET_PRICE', 've vao cua',      800),
  ('GET_TICKET_PRICE', 'phi',             800),
  ('GET_TICKET_PRICE', 'phi vao',         800),
  ('GET_TICKET_PRICE', 'phi vao cua',     800),
  ('GET_TICKET_PRICE', 'mat bao nhieu',   800),

  -- GET_OPENING_HOURS (priority 700)
  ('GET_OPENING_HOURS', 'gio mo cua',      700),
  ('GET_OPENING_HOURS', 'may gio mo',      700),
  ('GET_OPENING_HOURS', 'may gio',         700),
  ('GET_OPENING_HOURS', 'mo cua',          700),
  ('GET_OPENING_HOURS', 'opening hours',   700),
  ('GET_OPENING_HOURS', 'mo cua luc may gio', 700),

  -- GET_WEATHER (priority 600)
  ('GET_WEATHER', 'thoi tiet',            600),
  ('GET_WEATHER', 'du bao thoi tiet',     600),
  ('GET_WEATHER', 'weather',              600),
  ('GET_WEATHER', 'nhiet do',             600),
  ('GET_WEATHER', 'mua',                  600),
  ('GET_WEATHER', 'nang',                 600),
  ('GET_WEATHER', 'troi',                 600),

  -- GET_DIRECTIONS (priority 500)
  ('GET_DIRECTIONS', 'chi duong',          500),
  ('GET_DIRECTIONS', 'duong di',           500),
  ('GET_DIRECTIONS', 'huong dan duong',    500),
  ('GET_DIRECTIONS', 'di chuyen',          500),
  -- GET_DIRECTIONS — distance keywords (priority 510)
  ('GET_DIRECTIONS', 'khoang cach',        510),
  ('GET_DIRECTIONS', 'bao xa',             510),
  ('GET_DIRECTIONS', 'cach bao xa',        510),
  ('GET_DIRECTIONS', 'bao nhieu km',       510),
  ('GET_DIRECTIONS', 'may km',             510),

  -- SEARCH_NEARBY (priority 400)
  ('SEARCH_NEARBY', 'gan day',             400),
  ('SEARCH_NEARBY', 'gan toi',             400),
  ('SEARCH_NEARBY', 'xung quanh',          400),
  ('SEARCH_NEARBY', 'quanh day',           400),
  ('SEARCH_NEARBY', 'nearby',              400),
  -- SEARCH_NEARBY — discover (priority 410)
  ('SEARCH_NEARBY', 'dia diem du lich',    410),
  ('SEARCH_NEARBY', 'diem du lich',        410),
  ('SEARCH_NEARBY', 'diem tham quan',      410),

  -- DISCOVER_LOCATION (priority 350)
  ('DISCOVER_LOCATION', 'co gi hay',       350),
  ('DISCOVER_LOCATION', 'co gi choi',      350),
  ('DISCOVER_LOCATION', 'nen di dau',      350),
  ('DISCOVER_LOCATION', 'co gi',           350),
  ('DISCOVER_LOCATION', 'di dau',          350),
  ('DISCOVER_LOCATION', 'khong biet di dau', 350),
  ('DISCOVER_LOCATION', 'goi y dia diem',  350),
  ('DISCOVER_LOCATION', 'goi y',           350),
  ('DISCOVER_LOCATION', 'noi tieng',       350),
  ('DISCOVER_LOCATION', 'dac biet',        350),
  ('DISCOVER_LOCATION', 'cho nao',        350),
  ('DISCOVER_LOCATION', 'dep',            350),

  -- SEARCH_TOUR (priority 300)
  ('SEARCH_TOUR', 'tour',                  300),
  ('SEARCH_TOUR', 'lich trinh',            300),
  ('SEARCH_TOUR', 'hanh trinh',            300),
  ('SEARCH_TOUR', 'chuyen di',             300),
  ('SEARCH_TOUR', 'dat tour',              300),
  ('SEARCH_TOUR', 'book tour',             300),
  ('SEARCH_TOUR', 'du lich',              300),
  ('SEARCH_TOUR', 'chuyen du lich',        300),
  ('SEARCH_TOUR', 'tham quan',             300),
  ('SEARCH_TOUR', 'kham pha',             300),
  ('SEARCH_TOUR', 'di choi',              300),

  -- GET_PLACE_INFO (priority 200)
  ('GET_PLACE_INFO', 'thong tin',           200),
  ('GET_PLACE_INFO', 'gioi thieu',          200),
  ('GET_PLACE_INFO', 'la gi',              200),
  ('GET_PLACE_INFO', 'tim hieu',           200),
  ('GET_PLACE_INFO', 'info',               200),
  ('GET_PLACE_INFO', 'dia diem',           200),
  ('GET_PLACE_INFO', 'gioi thieu ve',      200)
ON CONFLICT (intent_type, keyword) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- MONITORING QUERIES (reference, do not run as part of migration)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Top unknown queries (past 24h):
--   SELECT entity, COUNT(*) FROM search_logs
--   WHERE is_unknown = true AND created_at > NOW() - INTERVAL '24 hours'
--   GROUP BY entity ORDER BY COUNT(*) DESC LIMIT 20;
--
-- Cleanup stale data:
--   SELECT cleanup_expired_sessions();
--   SELECT cleanup_stale_update_logs();
-- ═══════════════════════════════════════════════════════════════════════════
