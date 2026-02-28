-- ============================================================
-- Session Management Migration — Travel Bot V2
-- Run ONCE in pgAdmin against the travel bot database
-- ============================================================

-- Step 1: Create bot_sessions table
CREATE TABLE IF NOT EXISTS bot_sessions (
  session_id   VARCHAR(100) PRIMARY KEY,
  context_data JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

COMMENT ON TABLE bot_sessions IS 'Stores per-session state for Travel Bot V2 multi-turn context';
COMMENT ON COLUMN bot_sessions.context_data IS 'JSONB: {version,last_intent,last_place_slug,last_entity,last_coords,flow_state,location_updated_at,turn_count,last_interaction_at}';

-- Step 2: Indexes
CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires  ON bot_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_updated  ON bot_sessions(updated_at);

-- Step 3: UPSERT helper function
CREATE OR REPLACE FUNCTION upsert_bot_session(
  p_session_id   VARCHAR,
  p_context_data JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO bot_sessions (session_id, context_data, created_at, updated_at, expires_at)
  VALUES (p_session_id, p_context_data, NOW(), NOW(), NOW() + INTERVAL '7 days')
  ON CONFLICT (session_id) DO UPDATE SET
    context_data = p_context_data,
    updated_at   = NOW(),
    expires_at   = NOW() + INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Step 4: TTL cleanup (run periodically via pg_cron or manual)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM bot_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Context Data JSON Contract (reference)
-- ============================================================
-- {
--   "version": 1,
--   "last_intent": "GET_WEATHER",
--   "last_place_slug": "den-thai-vi",
--   "last_entity": "đền thái vi",
--   "last_coords": { "lat": 20.25, "lng": 105.97 },
--   "last_module": "GET_PLACE_INFO",
--   "flow_state": "idle",
--   "location_updated_at": 1700000000,
--   "turn_count": 3,
--   "last_interaction_at": 1700000000
-- }
-- ============================================================
