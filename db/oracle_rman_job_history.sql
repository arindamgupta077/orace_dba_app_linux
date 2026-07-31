-- ============================================================================
-- ORACLE RMAN JOB HISTORY TABLE (APP_RMAN_JOB_HISTORY)
-- Stores persistent RMAN backup execution status across all application users.
-- ============================================================================

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tables WHERE table_name = 'APP_RMAN_JOB_HISTORY';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE app_rman_job_history (
        job_id          VARCHAR2(100)  NOT NULL PRIMARY KEY,
        database_name   VARCHAR2(50)   NOT NULL,
        backup_type     VARCHAR2(50)   DEFAULT ''FULL'',
        status          VARCHAR2(20)   NOT NULL CHECK (status IN (''running'',''success'',''error'',''completed'')),
        started_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        completed_at    TIMESTAMP WITH TIME ZONE,
        ai_summary      CLOB,
        raw_output      CLOB,
        params_json     CLOB,
        requested_by    VARCHAR2(100)
      )';
    DBMS_OUTPUT.PUT_LINE('Table APP_RMAN_JOB_HISTORY created successfully.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('Table APP_RMAN_JOB_HISTORY already exists.');
  END IF;
END;
/

-- Index for fast queries by database and status
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IDX_RMAN_JOB_DB_STATUS';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX idx_rman_job_db_status ON app_rman_job_history (database_name, status, started_at DESC)';
    DBMS_OUTPUT.PUT_LINE('Index IDX_RMAN_JOB_DB_STATUS created.');
  END IF;
END;
/
