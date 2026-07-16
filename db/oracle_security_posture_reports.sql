SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

--------------------------------------------------------------------------------
-- Security Posture Management / Nessus report metadata
-- Run as the schema owner of DATABASE_INVENTORY and APP_USERS.
--------------------------------------------------------------------------------

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_sequences WHERE sequence_name = 'APP_SECURITY_POSTURE_REPORTS_SEQ';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE app_security_posture_reports_seq START WITH 1 INCREMENT BY 1 NOCACHE';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_tables WHERE table_name = 'APP_SECURITY_POSTURE_REPORTS';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_security_posture_reports (
        report_id             NUMBER NOT NULL,
        database_id           NUMBER NOT NULL,
        original_filename     VARCHAR2(255 CHAR) NOT NULL,
        stored_filename       VARCHAR2(255 CHAR) NOT NULL,
        file_path             VARCHAR2(1000 CHAR) NOT NULL,
        file_size_bytes       NUMBER(19) NOT NULL,
        mime_type             VARCHAR2(100 CHAR) NOT NULL,
        uploaded_by           VARCHAR2(128 CHAR) NOT NULL,
        uploaded_by_user_id   NUMBER NOT NULL,
        uploaded_at           TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        processing_status     VARCHAR2(20 CHAR) DEFAULT 'UPLOADED' NOT NULL,
        ai_summary            CLOB,
        ai_model              VARCHAR2(200 CHAR),
        summary_generated_at  TIMESTAMP WITH TIME ZONE,
        error_message         CLOB,
        is_active             CHAR(1) DEFAULT 'Y' NOT NULL,
        replaced_at           TIMESTAMP WITH TIME ZONE,
        created_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        updated_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
      )
    ]';
  END IF;
END;
/

DECLARE
  v_count NUMBER;
  PROCEDURE add_column_if_missing(p_column VARCHAR2, p_sql VARCHAR2) IS
  BEGIN
    SELECT COUNT(*) INTO v_count
    FROM user_tab_columns
    WHERE table_name = 'APP_SECURITY_POSTURE_REPORTS' AND column_name = UPPER(p_column);
    IF v_count = 0 THEN EXECUTE IMMEDIATE p_sql; END IF;
  END;
BEGIN
  add_column_if_missing('OUTDATED_WEBHOOK_SENT_AT',
    'ALTER TABLE app_security_posture_reports ADD (outdated_webhook_sent_at TIMESTAMP WITH TIME ZONE)');
  add_column_if_missing('OUTDATED_WEBHOOK_CLAIMED_AT',
    'ALTER TABLE app_security_posture_reports ADD (outdated_webhook_claimed_at TIMESTAMP WITH TIME ZONE)');
END;
/

DECLARE
  v_count NUMBER;
  PROCEDURE add_constraint_if_missing(p_name VARCHAR2, p_sql VARCHAR2) IS
  BEGIN
    SELECT COUNT(*) INTO v_count FROM user_constraints WHERE constraint_name = UPPER(p_name);
    IF v_count = 0 THEN EXECUTE IMMEDIATE p_sql; END IF;
  END;
BEGIN
  add_constraint_if_missing('PK_APP_SECURITY_POSTURE_REPORTS',
    'ALTER TABLE app_security_posture_reports ADD CONSTRAINT pk_app_security_posture_reports PRIMARY KEY (report_id)');
  add_constraint_if_missing('FK_SECURITY_POSTURE_DB',
    'ALTER TABLE app_security_posture_reports ADD CONSTRAINT fk_security_posture_db FOREIGN KEY (database_id) REFERENCES database_inventory(id)');
  add_constraint_if_missing('FK_SECURITY_POSTURE_USER',
    'ALTER TABLE app_security_posture_reports ADD CONSTRAINT fk_security_posture_user FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(user_id)');
  add_constraint_if_missing('CK_SECURITY_POSTURE_STATUS',
    q'[ALTER TABLE app_security_posture_reports ADD CONSTRAINT ck_security_posture_status CHECK (processing_status IN ('UPLOADED','PROCESSING','COMPLETED','FAILED'))]');
  add_constraint_if_missing('CK_SECURITY_POSTURE_ACTIVE',
    q'[ALTER TABLE app_security_posture_reports ADD CONSTRAINT ck_security_posture_active CHECK (is_active IN ('Y','N'))]');
END;
/

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'UX_SECURITY_POSTURE_ACTIVE_DB';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[CREATE UNIQUE INDEX ux_security_posture_active_db ON app_security_posture_reports (CASE WHEN is_active = 'Y' THEN database_id END)]';
  END IF;
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_SECURITY_POSTURE_DB_UPLOAD';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_security_posture_db_upload ON app_security_posture_reports (database_id, uploaded_at DESC)';
  END IF;
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_SECURITY_POSTURE_OUTDATED_NOTIFY';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_security_posture_outdated_notify ON app_security_posture_reports (is_active, outdated_webhook_sent_at, uploaded_at)';
  END IF;
END;
/

CREATE OR REPLACE TRIGGER trg_security_posture_reports_biu
BEFORE INSERT OR UPDATE ON app_security_posture_reports
FOR EACH ROW
BEGIN
  IF INSERTING AND :NEW.report_id IS NULL THEN
    :NEW.report_id := app_security_posture_reports_seq.NEXTVAL;
  END IF;
  IF INSERTING AND :NEW.uploaded_at IS NULL THEN
    :NEW.uploaded_at := SYSTIMESTAMP;
  END IF;
  :NEW.updated_at := SYSTIMESTAMP;
END;
/

-- n8n uses these statements after extracting the PDF and generating its answer:
-- UPDATE app_security_posture_reports SET processing_status = 'PROCESSING', error_message = NULL WHERE report_id = :document_id AND is_active = 'Y';
-- UPDATE app_security_posture_reports SET processing_status = 'COMPLETED', ai_summary = :summary, ai_model = :model, summary_generated_at = SYSTIMESTAMP, error_message = NULL WHERE report_id = :document_id AND is_active = 'Y';
-- UPDATE app_security_posture_reports SET processing_status = 'FAILED', error_message = :message WHERE report_id = :document_id AND is_active = 'Y';

COMMIT;
