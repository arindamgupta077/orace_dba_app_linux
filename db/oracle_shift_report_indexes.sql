-- ============================================================================
-- Oracle DB Migration: Function-Based Indexes for Shift Report Performance
-- Safe to execute multiple times (idempotent block checking USER_INDEXES)
-- ============================================================================

DECLARE
  v_count NUMBER;
BEGIN
  -- 1. TRUNC(shift_date) index on app_shift_sessions
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_SHIFT_SESSION_DATE_TRUNC';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_shift_session_date_trunc ON app_shift_sessions (TRUNC(shift_date))';
    DBMS_OUTPUT.PUT_LINE('Created index IX_SHIFT_SESSION_DATE_TRUNC');
  END IF;

  -- 2. TRUNC(shift_date) index on app_handovers
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_HANDOVER_DATE_TRUNC';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_handover_date_trunc ON app_handovers (TRUNC(shift_date))';
    DBMS_OUTPUT.PUT_LINE('Created index IX_HANDOVER_DATE_TRUNC');
  END IF;

  -- 3. TRUNC(shift_date) index on app_db_status_checks
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_DB_STATUS_DATE_TRUNC';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_db_status_date_trunc ON app_db_status_checks (TRUNC(shift_date))';
    DBMS_OUTPUT.PUT_LINE('Created index IX_DB_STATUS_DATE_TRUNC');
  END IF;

  -- 4. TRUNC(shift_date) index on app_backup_status_checks
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_BACKUP_STATUS_DATE_TRUNC';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_backup_status_date_trunc ON app_backup_status_checks (TRUNC(shift_date))';
    DBMS_OUTPUT.PUT_LINE('Created index IX_BACKUP_STATUS_DATE_TRUNC');
  END IF;

END;
/
