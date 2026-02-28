-- ============================================================
-- Production Migration: Idempotency + Rate Limit Tables
-- Travel Bot — GET_TICKET_PRICE hardening (shared infra)
-- Run ONCE in pgAdmin against the travel bot database
-- ============================================================

-- 1. IDEMPOTENCY TABLE — prevent double replies on Telegram retry
CREATE TABLE IF NOT EXISTS update_logs (
  update_id    BIGINT PRIMARY KEY,
  user_id      VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_update_logs_user ON update_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_update_logs_processed ON update_logs(processed_at);

COMMENT ON TABLE update_logs IS 'Idempotency guard: stores processed Telegram update_ids to prevent duplicate replies';

-- Cleanup: auto-purge entries older than 48h (run via pg_cron or manual)
-- DELETE FROM update_logs WHERE processed_at < NOW() - INTERVAL '48 hours';

-- 2. RATE LIMIT TABLE — per-user request throttling
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id      VARCHAR(100) NOT NULL,
  window_start TIMESTAMPTZ  NOT NULL,
  count        INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user ON rate_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

COMMENT ON TABLE rate_limits IS 'Per-user rate limiting: 5 requests per 10-second window';

-- Cleanup: auto-purge windows older than 1h
-- DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';

-- ============================================================
-- VERIFY
-- ============================================================
SELECT 'tables created' AS check_type, table_name
FROM information_schema.tables
WHERE table_name IN ('update_logs', 'rate_limits');
