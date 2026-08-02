SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

DECLARE
  table_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO table_count
    FROM user_tables
   WHERE table_name = 'APP_ALERT_NOTIFICATIONS';

  IF table_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_alert_notifications (
        alert_id VARCHAR2(64) NOT NULL,
        source_name VARCHAR2(64) DEFAULT 'n8n' NOT NULL,
        alert_type VARCHAR2(64) DEFAULT 'tablespace' NOT NULL,
        db_name VARCHAR2(64) NOT NULL,
        tablespace_name VARCHAR2(128),
        object_name VARCHAR2(128),
        severity VARCHAR2(32) NOT NULL,
        alert_status VARCHAR2(32) DEFAULT 'pending_approval' NOT NULL,
        message_text CLOB NOT NULL,
        utilization_pct NUMBER,
        threshold_pct NUMBER,
        critical_pct NUMBER,
        used_gb NUMBER,
        free_gb NUMBER,
        extend_size_gb NUMBER,
        datafile_name VARCHAR2(512),
        workflow_run_id VARCHAR2(128),
        approval_url VARCHAR2(2000),
        reject_url VARCHAR2(2000),
        callback_url VARCHAR2(2000),
        created_by VARCHAR2(128) DEFAULT 'n8n' NOT NULL,
        approved_by VARCHAR2(128),
        created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
        updated_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
        approved_at TIMESTAMP(6),
        completed_at TIMESTAMP(6),
        metadata_json CLOB,
        is_read CHAR(1) DEFAULT 'N' NOT NULL,
        read_at TIMESTAMP(6) WITH TIME ZONE,
        read_by VARCHAR2(100 CHAR),
        CONSTRAINT app_alert_notifications_pk PRIMARY KEY (alert_id),
        CONSTRAINT app_alert_notifications_sev_ck CHECK (severity IN ('info', 'warning', 'critical', 'error')),
        CONSTRAINT app_alert_notifications_status_ck CHECK (alert_status IN ('pending_approval', 'approved', 'rejected', 'completed', 'failed', 'acknowledged'))
      )
    ]';
  END IF;
END;
/

DECLARE
  v_count NUMBER;
  PROCEDURE add_col(p_col VARCHAR2, p_sql VARCHAR2) IS
  BEGIN
    SELECT COUNT(*) INTO v_count FROM user_tab_columns WHERE table_name = 'APP_ALERT_NOTIFICATIONS' AND column_name = UPPER(p_col);
    IF v_count = 0 THEN EXECUTE IMMEDIATE p_sql; END IF;
  END;
BEGIN
  add_col('is_read', q'[ALTER TABLE app_alert_notifications ADD (is_read CHAR(1) DEFAULT 'N' NOT NULL)]');
  add_col('read_at', 'ALTER TABLE app_alert_notifications ADD (read_at TIMESTAMP(6) WITH TIME ZONE)');
  add_col('read_by', 'ALTER TABLE app_alert_notifications ADD (read_by VARCHAR2(100 CHAR))');
END;
/

DECLARE
  constraint_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO constraint_count
    FROM user_constraints
   WHERE constraint_name = 'APP_ALERT_NOTIFICATIONS_TYPE_CK';

  IF constraint_count > 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_alert_notifications DROP CONSTRAINT app_alert_notifications_type_ck';
  END IF;
END;
/

DECLARE
  index_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO index_count
    FROM user_indexes
   WHERE index_name = 'APP_ALERT_NOTIFICATIONS_DB_IX';

  IF index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_alert_notifications_db_ix ON app_alert_notifications (db_name, alert_type, alert_status)';
  END IF;
END;
/

DECLARE
  index_count NUMBER;
BEGIN
  SELECT COUNT(*)
    INTO index_count
    FROM user_indexes
   WHERE index_name = 'APP_ALERT_NOTIFICATIONS_CREATED_IX';

  IF index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_alert_notifications_created_ix ON app_alert_notifications (created_at)';
  END IF;
END;
/

CREATE OR REPLACE TRIGGER app_alert_notifications_bu_trg
BEFORE UPDATE ON app_alert_notifications
FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSTIMESTAMP;
END;
/

COMMIT;
PROMPT Alert notifications table is ready.
