-- ============================================================================
-- Migration: Add absolute session timeout and last-activity tracking
-- to app_sessions for enterprise-grade auto-logout.
--
-- Run this ONCE against the APP_DBA schema after deploying the updated
-- application code.  It is idempotent — re-running it is safe.
-- ============================================================================

-- 1. Add absolute_expires_at — immutable hard cap set at login time.
DECLARE
  v_col_exists NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_col_exists
    FROM user_tab_columns
   WHERE table_name  = 'APP_SESSIONS'
     AND column_name = 'ABSOLUTE_EXPIRES_AT';
  IF v_col_exists = 0 THEN
    EXECUTE IMMEDIATE
      'ALTER TABLE app_sessions ADD (absolute_expires_at TIMESTAMP(6))';
  END IF;
END;
/

-- 2. Add last_activity_at — updated on meaningful user activity only.
DECLARE
  v_col_exists NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_col_exists
    FROM user_tab_columns
   WHERE table_name  = 'APP_SESSIONS'
     AND column_name = 'LAST_ACTIVITY_AT';
  IF v_col_exists = 0 THEN
    EXECUTE IMMEDIATE
      'ALTER TABLE app_sessions ADD (last_activity_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP)';
  END IF;
END;
/

-- 3. Backfill existing rows so queries that filter on the new columns
--    don't silently exclude old sessions.
UPDATE app_sessions
   SET absolute_expires_at = COALESCE(expires_at, created_at + INTERVAL '24' HOUR),
       last_activity_at    = COALESCE(last_activity_at, created_at, SYSTIMESTAMP)
 WHERE absolute_expires_at IS NULL;
COMMIT;

-- 4. Index for efficient inactivity checks (queries filter on last_activity_at).
DECLARE
  v_idx_exists NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_idx_exists
    FROM user_indexes
   WHERE index_name = 'APP_SESSIONS_ACTIVITY_IX';
  IF v_idx_exists = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE INDEX app_sessions_activity_ix ON app_sessions (last_activity_at)';
  END IF;
END;
/
