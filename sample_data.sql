-- =========================================================================
-- Sample Data — Tràng An GIS (Web + Bot compatible)
-- Apply AFTER schema.sql
-- =========================================================================

-- ── Users ──
INSERT INTO users (email, password, full_name, role) VALUES
('admin@trangangis.com',  '$2a$10$CwTycUXWue0Thq9StjUM0urYALw9B3rKHHJhgaJzf3k8fCJxkx.JG', 'Quản trị viên', 'superadmin'),
('editor@trangangis.com', '$2a$10$CwTycUXWue0Thq9StjUM0urYALw9B3rKHHJhgaJzf3k8fCJxkx.JG', 'Biên tập viên', 'admin'),
('user1@gmail.com',       '$2a$10$CwTycUXWue0Thq9StjUM0urYALw9B3rKHHJhgaJzf3k8fCJxkx.JG', 'Nguyễn Văn Nam', 'user'),
('user2@gmail.com',       '$2a$10$CwTycUXWue0Thq9StjUM0urYALw9B3rKHHJhgaJzf3k8fCJxkx.JG', 'Trần Thị Lan', 'user')
ON CONFLICT (email) DO NOTHING;

-- ── Categories ──
-- Web-specific Tràng An categories (supplement bot seed categories 1-8)
-- slug generated from name_en
INSERT INTO categories (name_vi, name_en, slug, icon, color) VALUES
('Hang động',       'Caves',            'hang-dong-trang-an', 'fas fa-mountain',  '#8B4513'),
('Đền chùa',        'Temples & Pagodas','den-chua',           'fas fa-torii-gate','#FFD700'),
('Bến thuyền',      'Boat Stations',    'ben-thuyen',         'fas fa-anchor',    '#1E90FF'),
('Nhà hàng',        'Restaurants',      'nha-hang',           'fas fa-utensils',  '#FF6347'),
('Cảnh quan',       'Landscapes',       'canh-quan',          'fas fa-tree',      '#228B22'),
('Di tích lịch sử', 'Historical Sites', 'di-tich-lich-su',    'fas fa-landmark',  '#800080')
ON CONFLICT (slug) DO NOTHING;

-- ── Attractions (Tràng An / Hoa Lư — web sample data) ──
-- Fix: add required slug + province + place_type + status
-- category_id references the newly inserted web categories above
-- Use CURRVAL or subquery since IDs are auto-generated

INSERT INTO attractions
  (name_vi, name_en, slug, province, place_type, description_vi, description_en,
   category_id, location, address_vi, address_en, opening_hours, ticket_price, featured_image, status)
VALUES
(
  'Đền Thái Vi', 'Thai Vi Temple', 'den-thai-vi-hoa-lu',
  'Ninh Bình', 'temple',
  'Đền Thái Vi là ngôi đền cổ kính nằm trong quần thể danh thắng Tràng An, thờ vua Đinh Tiên Hoàng và Lê Đại Hành. Đây là nơi có giá trị lịch sử và tâm linh cao.',
  'Thai Vi Temple is an ancient temple located in Trang An scenic complex, worshipping King Dinh Tien Hoang and Le Dai Hanh.',
  (SELECT id FROM categories WHERE slug = 'den-chua'),
  ST_GeomFromText('POINT(105.9175 20.2567)', 4326),
  'Tràng An, Ninh Hải, Hoa Lư, Ninh Bình', 'Trang An, Ninh Hai, Hoa Lu, Ninh Binh',
  '7:00 - 17:00', 'Miễn phí',
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800', 'active'
),
(
  'Hang Sáng', 'Sang Cave', 'hang-sang',
  'Ninh Bình', 'cave',
  'Hang Sáng là một trong những hang động đẹp nhất của Tràng An với ánh sáng tự nhiên chiếu xuống tạo nên cảnh quan kỳ ảo.',
  'Sang Cave is one of the most beautiful caves in Trang An.',
  (SELECT id FROM categories WHERE slug = 'hang-dong-trang-an'),
  ST_GeomFromText('POINT(105.9145 20.2545)', 4326),
  'Tràng An, Ninh Hải, Hoa Lư, Ninh Bình', 'Trang An, Ninh Hai, Hoa Lu, Ninh Binh',
  '8:00 - 16:30', '200,000 VND',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800', 'active'
),
(
  'Hang Tối', 'Dark Cave', 'hang-toi',
  'Ninh Bình', 'cave',
  'Hang Tối nổi tiếng với chiều dài lớn và không gian rộng rãi, mang lại cảm giác thám hiểm thú vị.',
  'Dark Cave is famous for its great length and spacious space.',
  (SELECT id FROM categories WHERE slug = 'hang-dong-trang-an'),
  ST_GeomFromText('POINT(105.9165 20.2535)', 4326),
  'Tràng An, Ninh Hải, Hoa Lư, Ninh Bình', 'Trang An, Ninh Hai, Hoa Lu, Ninh Binh',
  '8:00 - 16:30', '200,000 VND',
  'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800', 'active'
),
(
  'Bến thuyền Tràng An', 'Trang An Boat Station', 'ben-thuyen-trang-an',
  'Ninh Bình', 'landmark',
  'Bến thuyền chính để khởi hành các tour du lịch sinh thái Tràng An.',
  'Main boat station for Trang An ecological tourism tours.',
  (SELECT id FROM categories WHERE slug = 'ben-thuyen'),
  ST_GeomFromText('POINT(105.9190 20.2580)', 4326),
  'Tràng An, Ninh Hải, Hoa Lư, Ninh Bình', 'Trang An, Ninh Hai, Hoa Lu, Ninh Binh',
  '7:30 - 17:00', '200,000 VND/người',
  'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800', 'active'
),
(
  'Nhà hàng Tre Xanh', 'Green Bamboo Restaurant', 'nha-hang-tre-xanh',
  'Ninh Bình', 'restaurant',
  'Nhà hàng chuyên phục vụ các món đặc sản Ninh Bình như cơm cháy, dê núi.',
  'Restaurant specializing in Ninh Binh specialties.',
  (SELECT id FROM categories WHERE slug = 'nha-hang'),
  ST_GeomFromText('POINT(105.9200 20.2590)', 4326),
  'Tràng An, Ninh Hải, Hoa Lư, Ninh Bình', 'Trang An, Ninh Hai, Hoa Lu, Ninh Binh',
  '6:00 - 22:00', '150,000 - 300,000 VND/món',
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800', 'active'
),
(
  'Núi Ngũ Động', 'Ngu Dong Mountain', 'nui-ngu-dong',
  'Ninh Bình', 'mountain',
  'Núi Ngũ Động cao 209m với 5 hang động xuyên qua lòng núi, là điểm check-in hấp dẫn trong quần thể Tràng An.',
  'Ngu Dong Mountain is 209m high with 5 caves.',
  (SELECT id FROM categories WHERE slug = 'canh-quan'),
  ST_GeomFromText('POINT(105.9130 20.2520)', 4326),
  'Tràng An, Ninh Hải, Hoa Lư, Ninh Bình', 'Trang An, Ninh Hai, Hoa Lu, Ninh Binh',
  '8:00 - 17:00', 'Bao gồm trong vé Tràng An',
  'https://images.unsplash.com/photo-1464822759844-d150065c142f?w=800', 'active'
),
(
  'Cố đô Hoa Lư', 'Ancient Capital Hoa Lu', 'co-do-hoa-lu',
  'Ninh Bình', 'landmark',
  'Cố đô Hoa Lư là thủ đô đầu tiên của Việt Nam thời phong kiến dưới triều Đinh và Lê.',
  'Ancient Capital Hoa Lu was the first capital of feudal Vietnam under the Dinh and Le dynasties.',
  (SELECT id FROM categories WHERE slug = 'di-tich-lich-su'),
  ST_GeomFromText('POINT(105.9250 20.2600)', 4326),
  'Hoa Lư, Ninh Bình', 'Hoa Lu, Ninh Binh',
  '7:30 - 17:00', '20,000 VND',
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800', 'active'
),
(
  'Đền Đinh Tiên Hoàng', 'Dinh Tien Hoang Temple', 'den-dinh-tien-hoang',
  'Ninh Bình', 'temple',
  'Đền thờ Hoàng đế Đinh Tiên Hoàng - vị vua đầu tiên của nước Đại Cồ Việt. Kiến trúc đền mang đậm nét truyền thống Việt Nam với những chi tiết trang trí tinh xảo.',
  'Temple worshipping Emperor Dinh Tien Hoang - the first king of Dai Co Viet.',
  (SELECT id FROM categories WHERE slug = 'den-chua'),
  ST_GeomFromText('POINT(105.9240 20.2595)', 4326),
  'Hoa Lư, Ninh Bình', 'Hoa Lu, Ninh Binh',
  '7:30 - 17:00', 'Bao gồm trong vé Hoa Lư',
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800', 'active'
)
ON CONFLICT (slug) DO NOTHING;

-- ── Tickets (structured pricing for bot GET_TICKET_PRICE) ──
INSERT INTO tickets (attraction_id, ticket_type, adult_price, child_price, notes)
SELECT p.id, 'Vé tham quan', 0, 0, 'Miễn phí'
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu'
ON CONFLICT DO NOTHING;

INSERT INTO tickets (attraction_id, ticket_type, adult_price, child_price, notes)
SELECT p.id, 'Vé tham quan', 200000, 100000, 'Bao gồm đò tham quan hang'
FROM attractions p WHERE p.slug IN ('hang-sang', 'hang-toi')
ON CONFLICT DO NOTHING;

INSERT INTO tickets (attraction_id, ticket_type, adult_price, child_price, notes)
SELECT p.id, 'Vé thuyền', 200000, 100000, 'Vé tour sinh thái Tràng An'
FROM attractions p WHERE p.slug = 'ben-thuyen-trang-an'
ON CONFLICT DO NOTHING;

INSERT INTO tickets (attraction_id, ticket_type, adult_price, child_price, notes)
SELECT p.id, 'Vé tham quan', 20000, 10000, 'Vé vào cố đô Hoa Lư (bao gồm Đền Đinh + Đền Lê)'
FROM attractions p WHERE p.slug IN ('co-do-hoa-lu', 'den-dinh-tien-hoang')
ON CONFLICT DO NOTHING;

-- ── Opening Hours (structured for bot GET_OPENING_HOURS) ──
INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT p.id, d, '07:00'::time, '17:00'::time, false
FROM attractions p, generate_series(0,6) d
WHERE p.slug IN ('den-thai-vi-hoa-lu', 'co-do-hoa-lu', 'den-dinh-tien-hoang')
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT p.id, d, '08:00'::time, '16:30'::time, false
FROM attractions p, generate_series(0,6) d
WHERE p.slug IN ('hang-sang', 'hang-toi', 'ben-thuyen-trang-an', 'nui-ngu-dong')
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

INSERT INTO opening_hours (attraction_id, day_of_week, open_time, close_time, is_closed)
SELECT p.id, d, '06:00'::time, '22:00'::time, false
FROM attractions p, generate_series(0,6) d
WHERE p.slug = 'nha-hang-tre-xanh'
ON CONFLICT (attraction_id, day_of_week) DO NOTHING;

-- ── Location Aliases (bot entity graph — diacritics-stripped) ──
INSERT INTO location_aliases (alias, attraction_id)
SELECT v.alias, p.id FROM (VALUES
  -- Hang Sáng
  ('hang sang',          'hang-sang'),
  ('sang cave',          'hang-sang'),
  ('hang sang trang an', 'hang-sang'),
  -- Hang Tối
  ('hang toi',           'hang-toi'),
  ('dark cave',          'hang-toi'),
  ('hang toi trang an',  'hang-toi'),
  -- Bến thuyền Tràng An
  ('ben thuyen trang an','ben-thuyen-trang-an'),
  ('ben thuyen',         'ben-thuyen-trang-an'),
  ('do trang an',        'ben-thuyen-trang-an'),
  -- Núi Ngũ Động
  ('nui ngu dong',       'nui-ngu-dong'),
  ('ngu dong',           'nui-ngu-dong'),
  -- Cố đô Hoa Lư
  ('co do hoa lu',       'co-do-hoa-lu'),
  ('hoa lu',             'co-do-hoa-lu'),
  ('kinh do hoa lu',     'co-do-hoa-lu'),
  -- Đền Đinh Tiên Hoàng
  ('den dinh tien hoang','den-dinh-tien-hoang'),
  ('dinh tien hoang',    'den-dinh-tien-hoang'),
  ('den vua dinh',       'den-dinh-tien-hoang')
) AS v(alias, slug)
JOIN attractions p ON p.slug = v.slug
ON CONFLICT (alias) DO NOTHING;

-- ── Media ──
INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image', 'Toàn cảnh đền Thái Vi', 'Thai Vi Temple Overview',
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=1200', true
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image360', 'Ảnh 360° sân đền', '360° Temple Courtyard',
  'https://pannellum.org/images/alma.jpg', false
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'audio', 'Thuyết minh đền Thái Vi', 'Thai Vi Temple Audio Guide',
  '/audio/thai_vi_temple.mp3', false
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image', 'Khám phá Hang Sáng', 'Exploring Sang Cave',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200', true
FROM attractions p WHERE p.slug = 'hang-sang'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image360', 'Ảnh 360° trong hang', '360° Inside Cave',
  'https://pannellum.org/images/bma-1.jpg', false
FROM attractions p WHERE p.slug = 'hang-sang'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image', 'Hành trình Hang Tối', 'Dark Cave Journey',
  'https://images.unsplash.com/photo-1551632811-561732d1e306?w=1200', true
FROM attractions p WHERE p.slug = 'hang-toi'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image360', 'Ảnh 360° lối vào hang', '360° Cave Entrance',
  'https://pannellum.org/images/cerro-toco-0.jpg', false
FROM attractions p WHERE p.slug = 'hang-toi'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image', 'Bến thuyền Tràng An', 'Trang An Boat Station',
  'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=1200', true
FROM attractions p WHERE p.slug = 'ben-thuyen-trang-an'
ON CONFLICT DO NOTHING;

INSERT INTO media (attraction_id, type, title_vi, title_en, file_path, is_featured)
SELECT p.id, 'image360', 'Ảnh 360° bến thuyền', '360° Boat Station',
  'https://pannellum.org/images/from-tree.jpg', false
FROM attractions p WHERE p.slug = 'ben-thuyen-trang-an'
ON CONFLICT DO NOTHING;

-- ── VR Scenes ──
INSERT INTO vr_scenes (attraction_id, name_vi, name_en, image_path, audio_path, subtitle_vi, subtitle_en, is_main_scene)
SELECT p.id,
  'Cổng đền Thái Vi', 'Thai Vi Temple Gate',
  'https://pannellum.org/images/alma.jpg', '/audio/gate.mp3',
  'Chào mừng bạn đến với đền Thái Vi, ngôi đền cổ kính thờ vua Đinh Tiên Hoàng.',
  'Welcome to Thai Vi Temple, an ancient temple worshipping King Dinh Tien Hoang.', true
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu';

INSERT INTO vr_scenes (attraction_id, name_vi, name_en, image_path, audio_path, subtitle_vi, subtitle_en, is_main_scene)
SELECT p.id,
  'Sân trong đền', 'Temple Courtyard',
  'https://pannellum.org/images/bma-1.jpg', '/audio/courtyard.mp3',
  'Đây là sân trong của đền, nơi diễn ra các nghi lễ trang trọng.',
  'This is the inner courtyard where solemn ceremonies take place.', false
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu';

INSERT INTO vr_scenes (attraction_id, name_vi, name_en, image_path, audio_path, subtitle_vi, subtitle_en, is_main_scene)
SELECT p.id,
  'Chính điện', 'Main Hall',
  'https://pannellum.org/images/cerro-toco-0.jpg', '/audio/main_hall.mp3',
  'Chính điện thờ tượng vua Đinh Tiên Hoàng và các bảo vật quý giá.',
  'Main hall houses the statue of King Dinh Tien Hoang and precious treasures.', false
FROM attractions p WHERE p.slug = 'den-thai-vi-hoa-lu';

-- ── VR Hotspots (reference by scene position in insertion order) ──
-- NOTE: hotspots reference vr_scenes.id which is auto-generated.
-- In production these should reference actual scene IDs from the VR editor.
-- Sample data omitted here — insert via admin UI after VR scenes are created.

-- ── Tours (web tours — supplemental to bot seed tours 1-3) ──
-- Note: duration_days + is_active required for bot; duration text kept for web display
INSERT INTO tours (name_vi, name_en, description_vi, description_en, duration, duration_days, price, is_active, is_recommended, featured_image)
VALUES
(
  'Tour khám phá hang động', 'Cave Exploration Tour',
  'Hành trình khám phá các hang động tuyệt đẹp của Tràng An bằng thuyền rồng.',
  'Journey to explore the beautiful caves of Trang An by dragon boat.',
  '3 giờ', 1, 200000, true, true,
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800'
),
(
  'Tour tâm linh văn hóa', 'Spiritual Culture Tour',
  'Tham quan các đền chùa thiêng liêng và tìm hiểu lịch sử cố đô Hoa Lư.',
  'Visit sacred temples and learn about the history of ancient capital Hoa Lu.',
  '4 giờ', 1, 250000, true, true,
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800'
),
(
  'Tour trọn gói Tràng An', 'Complete Trang An Tour',
  'Trải nghiệm toàn diện quần thể Tràng An với hang động, đền chùa và cảnh quan.',
  'Comprehensive experience of Trang An complex with caves, temples and landscapes.',
  'Cả ngày', 1, 500000, true, true,
  'https://images.unsplash.com/photo-1464822759844-d150065c142f?w=800'
)
ON CONFLICT DO NOTHING;

-- ── Tour Stops (link web tours to new attractions) ──
-- Tour: Cave Exploration — Hang Sáng → Hang Tối → Bến thuyền
INSERT INTO tour_stops (tour_id, attraction_id, stop_order, stay_duration_hours)
SELECT
  (SELECT id FROM tours WHERE name_vi = 'Tour khám phá hang động'),
  p.id, v.ord, v.hrs
FROM (VALUES
  ('hang-sang',           1, 1.5),
  ('hang-toi',            2, 1.5),
  ('ben-thuyen-trang-an', 3, 0.5)
) AS v(slug, ord, hrs)
JOIN attractions p ON p.slug = v.slug
ON CONFLICT (tour_id, attraction_id) DO NOTHING;

-- Tour: Spiritual Culture — Đền Thái Vi → Đền Đinh Tiên Hoàng → Cố đô Hoa Lư
INSERT INTO tour_stops (tour_id, attraction_id, stop_order, stay_duration_hours)
SELECT
  (SELECT id FROM tours WHERE name_vi = 'Tour tâm linh văn hóa'),
  p.id, v.ord, v.hrs
FROM (VALUES
  ('den-thai-vi-hoa-lu',  1, 1.5),
  ('den-dinh-tien-hoang', 2, 1.5),
  ('co-do-hoa-lu',        3, 1.0)
) AS v(slug, ord, hrs)
JOIN attractions p ON p.slug = v.slug
ON CONFLICT (tour_id, attraction_id) DO NOTHING;

-- Tour: Complete Tràng An — all key stops
INSERT INTO tour_stops (tour_id, attraction_id, stop_order, stay_duration_hours)
SELECT
  (SELECT id FROM tours WHERE name_vi = 'Tour trọn gói Tràng An'),
  p.id, v.ord, v.hrs
FROM (VALUES
  ('ben-thuyen-trang-an', 1, 1.0),
  ('hang-sang',           2, 1.5),
  ('hang-toi',            3, 1.5),
  ('nui-ngu-dong',        4, 1.0),
  ('den-thai-vi-hoa-lu',  5, 1.0)
) AS v(slug, ord, hrs)
JOIN attractions p ON p.slug = v.slug
ON CONFLICT (tour_id, attraction_id) DO NOTHING;
