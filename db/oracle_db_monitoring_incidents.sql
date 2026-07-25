SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

-- ============================================================
-- Database Monitoring Incidents Table
-- Tracks database availability incidents reported by n8n.
-- Lifecycle: DOWN → ACKNOWLEDGED → RESOLVED
-- ============================================================

DECLARE
  table_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO table_count
    FROM user_tables
   WHERE table_name = 'APP_DB_MONITORING_INCIDENTS';

  IF table_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_db_monitoring_incidents (
        incident_id     VARCHAR2(64)    NOT NULL,
        db_name         VARCHAR2(64)    NOT NULL,
        incident_status VARCHAR2(32)    DEFAULT 'DOWN' NOT NULL,
        first_reported  TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
        last_reported   TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
        report_count    NUMBER          DEFAULT 1 NOT NULL,
        acknowledged_by VARCHAR2(128),
        acknowledged_at TIMESTAMP(6),
        resolved_at     TIMESTAMP(6),
        created_at      TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
        updated_at      TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT app_db_monitoring_pk PRIMARY KEY (incident_id),
        CONSTRAINT app_db_monitoring_status_ck CHECK (incident_status IN ('DOWN','ACKNOWLEDGED','RESOLVED'))
      )
    ]';
  END IF;
END;
/

-- Index for fast lookup of active incidents by database name and status
DECLARE
  index_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO index_count
    FROM user_indexes
   WHERE index_name = 'APP_DB_MONITORING_DB_STATUS_IX';

  IF index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_db_monitoring_db_status_ix ON app_db_monitoring_incidents (db_name, incident_status)';
  END IF;
END;
/

-- Index for listing active incidents ordered by last_reported
DECLARE
  index_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO index_count
    FROM user_indexes
   WHERE index_name = 'APP_DB_MONITORING_STATUS_IX';

  IF index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_db_monitoring_status_ix ON app_db_monitoring_incidents (incident_status, last_reported)';
  END IF;
END;
/

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE TRIGGER app_db_monitoring_bu_trg
BEFORE UPDATE ON app_db_monitoring_incidents
FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSTIMESTAMP;
END;
/

COMMIT;
PROMPT Database monitoring incidents table is ready.
