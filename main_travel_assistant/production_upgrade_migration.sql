-- =====================================================
-- PRODUCTION UPGRADE MIGRATION
-- Travel Assistant - Observability, Caching, Versioning
-- =====================================================
-- Run this AFTER poi_override_postgres.sql and place_metadata_migration.sql
-- =====================================================

-- 1. METADATA VERSIONING (ALTER poi_override)
ALTER TABLE poi_override ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE poi_override ADD COLUMN IF NOT EXISTS verified_by VARCHAR(50) DEFAULT 'system';
ALTER TABLE poi_override ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3,2) DEFAULT 0.80;
ALTER TABLE poi_override ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'manual';

-- 2. REQUEST LOG (Observability)
CREATE TABLE IF NOT EXISTS request_log (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(100),
  intent VARCHAR(30),
  latency_ms INT,
  cache_hit_weather BOOLEAN DEFAULT false,
  cache_hit_distance BOOLEAN DEFAULT false,
  knowledge_hit BOOLEAN DEFAULT false,
  fallback_triggered BOOLEAN DEFAULT false,
  clarification_triggered BOOLEAN DEFAULT false,
  error_type VARCHAR(30),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rlog_session ON request_log(session_id);
CREATE INDEX IF NOT EXISTS idx_rlog_intent ON request_log(intent);
CREATE INDEX IF NOT EXISTS idx_rlog_created ON request_log(created_at);

-- 3. WEATHER CACHE (15 min TTL)
CREATE TABLE IF NOT EXISTS weather_cache (
  id SERIAL PRIMARY KEY,
  cache_key VARCHAR(200) UNIQUE NOT NULL,
  response_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wcache_key ON weather_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_wcache_expires ON weather_cache(expires_at);

-- 4. DISTANCE CACHE (1 day TTL)
CREATE TABLE IF NOT EXISTS distance_cache (
  id SERIAL PRIMARY KEY,
  cache_key VARCHAR(200) UNIQUE NOT NULL,
  response_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dcache_key ON distance_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_dcache_expires ON distance_cache(expires_at);

-- 5. CACHE CLEANUP (optional scheduled job)
-- DELETE FROM weather_cache WHERE expires_at < NOW();
-- DELETE FROM distance_cache WHERE expires_at < NOW();

-- =====================================================
-- VERIFY
-- =====================================================
SELECT 'poi_override columns' AS check_type, column_name
FROM information_schema.columns
WHERE table_name = 'poi_override' AND column_name IN ('version', 'verified_by', 'confidence_score', 'source_type');

SELECT 'tables created' AS check_type, table_name
FROM information_schema.tables
WHERE table_name IN ('request_log', 'weather_cache', 'distance_cache');
