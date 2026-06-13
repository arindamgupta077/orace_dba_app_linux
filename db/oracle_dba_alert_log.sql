-- ==============================================================
-- DBA Alert Log Table
-- Stores Oracle alert log errors received from n8n every 15 min.
-- Separate from app_alert_notifications (tablespace/datafile).
-- ==============================================================

SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

-- ---------------------------------------------------------------
-- 1. Create dba_alert_log table
-- ---------------------------------------------------------------
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM user_tables
   WHERE table_name = 'DBA_ALERT_LOG';

  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE dba_alert_log (
        alert_id              NUMBER GENERATED ALWAYS AS IDENTITY,
        database_name         VARCHAR2(50)   NOT NULL,
        originating_timestamp TIMESTAMP      NOT NULL,
        error_code            VARCHAR2(20),
        message_text          VARCHAR2(4000),
        severity              VARCHAR2(10)   DEFAULT 'INFO',
        status                VARCHAR2(20)   DEFAULT 'OPEN',
        acknowledged_by       VARCHAR2(100),
        acknowledged_at       TIMESTAMP,
        resolved_by           VARCHAR2(100),
        resolved_at           TIMESTAMP,
        created_at            TIMESTAMP      DEFAULT SYSTIMESTAMP,
        CONSTRAINT pk_dba_alert_log
          PRIMARY KEY (alert_id),
        CONSTRAINT uk_dba_alert_log
          UNIQUE (database_name, originating_timestamp, message_text),
        CONSTRAINT ck_dba_alert_log_severity
          CHECK (severity IN ('P1', 'P2', 'INFO')),
        CONSTRAINT ck_dba_alert_log_status
          CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))
      )
    ]';
    DBMS_OUTPUT.PUT_LINE('dba_alert_log table created.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('dba_alert_log table already exists — skipping.');
  END IF;
END;
/

-- ---------------------------------------------------------------
-- 2. Index: status lookup (for OPEN alerts dashboard)
-- ---------------------------------------------------------------
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM user_indexes
   WHERE index_name = 'DBA_ALERT_LOG_STATUS_IX';

  IF v_count = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE INDEX dba_alert_log_status_ix ON dba_alert_log (status, created_at DESC)';
    DBMS_OUTPUT.PUT_LINE('Index dba_alert_log_status_ix created.');
  END IF;
END;
/

-- ---------------------------------------------------------------
-- 3. Index: database_name lookup
-- ---------------------------------------------------------------
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM user_indexes
   WHERE index_name = 'DBA_ALERT_LOG_DB_IX';

  IF v_count = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE INDEX dba_alert_log_db_ix ON dba_alert_log (database_name, status, created_at DESC)';
    DBMS_OUTPUT.PUT_LINE('Index dba_alert_log_db_ix created.');
  END IF;
END;
/

-- ---------------------------------------------------------------
-- 4. Index: severity lookup
-- ---------------------------------------------------------------
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM user_indexes
   WHERE index_name = 'DBA_ALERT_LOG_SEV_IX';

  IF v_count = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE INDEX dba_alert_log_sev_ix ON dba_alert_log (severity, status, created_at DESC)';
    DBMS_OUTPUT.PUT_LINE('Index dba_alert_log_sev_ix created.');
  END IF;
END;
/

COMMIT;

PROMPT
PROMPT ================================================================
PROMPT  dba_alert_log is ready.
PROMPT
PROMPT  Severity mapping (applied by the application layer):
PROMPT    P1  : ORA-00600, ORA-07445, ORA-01157, ORA-00257,
PROMPT          ORA-19809, ORA-00313, ORA-19502, ORA-27072
PROMPT    P2  : ORA-04031, ORA-01555, ORA-01652, ORA-01653,
PROMPT          ORA-01691, ORA-01692, ORA-12170
PROMPT    INFO: all other ORA- codes
PROMPT
PROMPT  Lifecycle: OPEN -> ACKNOWLEDGED -> RESOLVED
PROMPT  Dedup   : uk_dba_alert_log (database_name, originating_timestamp, message_text)
PROMPT ================================================================
