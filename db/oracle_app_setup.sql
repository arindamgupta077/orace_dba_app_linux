SET DEFINE OFF;

--------------------------------------------------------------------------------
-- 1) Run this block as SYS or SYSTEM once to create the schema user.
--------------------------------------------------------------------------------
-- CREATE USER APP_DBA IDENTIFIED BY Password123;
-- GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE TRIGGER TO APP_DBA;
-- ALTER USER APP_DBA QUOTA UNLIMITED ON USERS;

--------------------------------------------------------------------------------
-- 2) Connect as APP_DBA and run the remaining commands.
--------------------------------------------------------------------------------
-- CONNECT APP_DBA/Password123@localhost:1522/TEST;

--------------------------------------------------------------------------------
-- Helper procedures for safe drops
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE drop_table_if_exists(p_table VARCHAR2) IS
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE ' || p_table || ' CASCADE CONSTRAINTS PURGE';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

CREATE OR REPLACE PROCEDURE drop_sequence_if_exists(p_seq VARCHAR2) IS
BEGIN
  EXECUTE IMMEDIATE 'DROP SEQUENCE ' || p_seq;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2289 THEN RAISE; END IF;
END;
/

--------------------------------------------------------------------------------
-- Drop all existing application tables in reverse-dependency order
--------------------------------------------------------------------------------
BEGIN drop_table_if_exists('datapump_job_history'); END;
/
BEGIN drop_table_if_exists('datapump_impdp_templates'); END;
/
BEGIN drop_table_if_exists('datapump_expdp_templates'); END;
/
BEGIN drop_table_if_exists('app_run_recommendations'); END;
/
BEGIN drop_table_if_exists('app_run_findings'); END;
/
BEGIN drop_table_if_exists('app_run_security_privileges'); END;
/
BEGIN drop_table_if_exists('app_run_invalid_objects'); END;
/
BEGIN drop_table_if_exists('app_run_alerts'); END;
/
BEGIN drop_table_if_exists('app_run_backups'); END;
/
BEGIN drop_table_if_exists('app_run_locks'); END;
/
BEGIN drop_table_if_exists('app_run_sql_metrics'); END;
/
BEGIN drop_table_if_exists('app_run_sessions'); END;
/
BEGIN drop_table_if_exists('app_run_tablespaces'); END;
/
BEGIN drop_table_if_exists('app_run_trend_points'); END;
/
BEGIN drop_table_if_exists('app_run_metrics'); END;
/
BEGIN drop_table_if_exists('app_security_posture_reports'); END;
/
BEGIN drop_table_if_exists('app_rman_job_history'); END;
/
BEGIN drop_table_if_exists('performance_run_all_hist'); END;
/
BEGIN drop_table_if_exists('app_perf_long_queries'); END;
/
BEGIN drop_table_if_exists('app_perf_locks'); END;
/
BEGIN drop_table_if_exists('app_perf_sessions'); END;
/
BEGIN drop_table_if_exists('app_perf_invalid_objects'); END;
/
BEGIN drop_table_if_exists('app_perf_session_longops'); END;
/
BEGIN drop_table_if_exists('app_perf_wait_events'); END;
/
BEGIN drop_table_if_exists('app_perf_cpu_usage'); END;
/
BEGIN drop_table_if_exists('app_perf_top_sql'); END;
/
BEGIN drop_table_if_exists('app_perf_run_summary'); END;
/
BEGIN drop_table_if_exists('app_password_resets'); END;
/
BEGIN drop_table_if_exists('app_password_reset_attempts'); END;
/
BEGIN drop_table_if_exists('app_filesystem_drive_utilization'); END;
/
BEGIN drop_table_if_exists('app_webhook_logs'); END;
/
BEGIN drop_table_if_exists('app_backup_status_checks'); END;
/
BEGIN drop_table_if_exists('app_db_status_checks'); END;
/
BEGIN drop_table_if_exists('app_backup_template'); END;
/
BEGIN drop_table_if_exists('app_handovers'); END;
/
BEGIN drop_table_if_exists('app_shift_sessions'); END;
/
BEGIN drop_table_if_exists('dba_alert_log'); END;
/
BEGIN drop_table_if_exists('app_dashboard_schedules'); END;
/
BEGIN drop_table_if_exists('dashboard_history'); END;
/
BEGIN drop_table_if_exists('app_change_audit_log'); END;
/
BEGIN drop_table_if_exists('app_approval_history'); END;
/
BEGIN drop_table_if_exists('app_approval_requests'); END;
/
BEGIN drop_table_if_exists('app_protected_actions'); END;
/
BEGIN drop_table_if_exists('app_db_monitoring_incidents'); END;
/
BEGIN drop_table_if_exists('app_database_catalog'); END;
/
BEGIN drop_table_if_exists('db_owner_mapping'); END;
/
BEGIN drop_table_if_exists('database_inventory'); END;
/
BEGIN drop_table_if_exists('app_alert_notifications'); END;
/
BEGIN drop_table_if_exists('app_request_history'); END;
/
BEGIN drop_table_if_exists('app_audit_logs'); END;
/
BEGIN drop_table_if_exists('app_user_preferences'); END;
/
BEGIN drop_table_if_exists('app_sessions'); END;
/
BEGIN drop_table_if_exists('app_users'); END;
/

BEGIN drop_sequence_if_exists('database_inventory_seq'); END;
/
BEGIN drop_sequence_if_exists('db_owner_mapping_seq'); END;
/
BEGIN drop_sequence_if_exists('app_security_posture_reports_seq'); END;
/

PROMPT All existing tables and sequences dropped.

--------------------------------------------------------------------------------
-- 3) Create sequences
--------------------------------------------------------------------------------
CREATE SEQUENCE database_inventory_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE db_owner_mapping_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE app_security_posture_reports_seq START WITH 1 INCREMENT BY 1 NOCACHE;

--------------------------------------------------------------------------------
-- 4) Create Application Schema Tables
--------------------------------------------------------------------------------

-- APP_USERS
CREATE TABLE app_users (
  user_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  username VARCHAR2(128 CHAR) NOT NULL,
  email VARCHAR2(320 CHAR) NOT NULL,
  psid VARCHAR2(64 CHAR),
  password_salt VARCHAR2(128 CHAR) NOT NULL,
  password_hash VARCHAR2(64 CHAR) NOT NULL,
  api_token_hash VARCHAR2(64 CHAR),
  role VARCHAR2(20 CHAR) DEFAULT 'client' NOT NULL,
  is_active CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  must_change_password CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  failed_login_count NUMBER DEFAULT 0 NOT NULL,
  locked_until TIMESTAMP(6),
  last_login_at TIMESTAMP(6),
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT app_users_pk PRIMARY KEY (user_id),
  CONSTRAINT app_users_username_uk UNIQUE (username),
  CONSTRAINT app_users_email_luk UNIQUE (email),
  CONSTRAINT app_users_role_ck CHECK (role IN ('app_admin', 'dba_admin', 'client', 'auditor')),
  CONSTRAINT app_users_is_active_ck CHECK (is_active IN ('Y', 'N')),
  CONSTRAINT app_users_must_change_pw_ck CHECK (must_change_password IN ('Y', 'N'))
);

CREATE OR REPLACE TRIGGER app_users_bu_trg
BEFORE UPDATE ON app_users
FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSTIMESTAMP;
END;
/

-- APP_SESSIONS
CREATE TABLE app_sessions (
  session_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  session_token_hash VARCHAR2(64 CHAR) NOT NULL,
  user_id NUMBER NOT NULL,
  auth_mode VARCHAR2(10 CHAR) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  revoked_at TIMESTAMP(6),
  ip_address VARCHAR2(64 CHAR),
  user_agent VARCHAR2(512 CHAR),
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT app_sessions_pk PRIMARY KEY (session_id),
  CONSTRAINT app_sessions_token_uk UNIQUE (session_token_hash),
  CONSTRAINT app_sessions_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
  CONSTRAINT app_sessions_auth_mode_ck CHECK (auth_mode IN ('jwt', 'token'))
);

CREATE INDEX app_sessions_user_ix ON app_sessions (user_id);
CREATE INDEX app_sessions_exp_ix ON app_sessions (expires_at);

-- APP_USER_PREFERENCES
CREATE TABLE app_user_preferences (
  user_id           NUMBER          NOT NULL,
  theme_preference  VARCHAR2(10 CHAR) DEFAULT 'light' NOT NULL,
  db_inventory_columns CLOB,
  created_at        TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at        TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT app_user_preferences_pk PRIMARY KEY (user_id),
  CONSTRAINT app_user_preferences_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
  CONSTRAINT app_user_preferences_theme_ck CHECK (theme_preference IN ('light', 'dark'))
);

CREATE INDEX app_user_preferences_theme_ix ON app_user_preferences (theme_preference);

CREATE OR REPLACE TRIGGER app_user_preferences_bu_trg
BEFORE UPDATE ON app_user_preferences
FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSTIMESTAMP;
END;
/

-- APP_AUDIT_LOGS
CREATE TABLE app_audit_logs (
  audit_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
  user_id NUMBER,
  actor VARCHAR2(128 CHAR) NOT NULL,
  action VARCHAR2(64 CHAR) NOT NULL,
  db_name VARCHAR2(64 CHAR),
  status VARCHAR2(32 CHAR) NOT NULL,
  detail CLOB,
  metadata_json CLOB,
  sql_command CLOB,
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT app_audit_logs_pk PRIMARY KEY (audit_id),
  CONSTRAINT app_audit_logs_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE SET NULL
);

CREATE INDEX app_audit_logs_created_ix ON app_audit_logs (created_at);
CREATE INDEX app_audit_logs_actor_ix ON app_audit_logs (actor);

-- APP_REQUEST_HISTORY
CREATE TABLE app_request_history (
  request_id VARCHAR2(64 CHAR) NOT NULL,
  user_id NUMBER,
  requested_by VARCHAR2(128 CHAR) NOT NULL,
  action VARCHAR2(64 CHAR) NOT NULL,
  db_name VARCHAR2(64 CHAR) NOT NULL,
  status VARCHAR2(32 CHAR) NOT NULL,
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  duration_ms NUMBER,
  payload_json CLOB NOT NULL,
  response_json CLOB,
  error_message VARCHAR2(2000 CHAR),
  external_request_id VARCHAR2(128 CHAR),
  CONSTRAINT app_request_history_pk PRIMARY KEY (request_id),
  CONSTRAINT app_request_history_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE SET NULL
);

CREATE INDEX app_request_history_created_ix ON app_request_history (created_at);
CREATE INDEX app_request_history_by_user_ix ON app_request_history (requested_by);

-- DATABASE_INVENTORY
CREATE TABLE database_inventory (
  id                NUMBER NOT NULL,
  database_name     VARCHAR2(128 CHAR) NOT NULL,
  environment       VARCHAR2(40 CHAR) NOT NULL,
  server_name       VARCHAR2(128 CHAR),
  server_ip         VARCHAR2(45 CHAR),
  zone              VARCHAR2(10 CHAR) DEFAULT 'SZ1' NOT NULL,
  location          VARCHAR2(160 CHAR),
  operating_system  VARCHAR2(30 CHAR) NOT NULL,
  database_role     VARCHAR2(30 CHAR) DEFAULT 'Primary' NOT NULL,
  database_type     VARCHAR2(40 CHAR) DEFAULT 'Standalone' NOT NULL,
  status            VARCHAR2(20 CHAR) DEFAULT 'healthy' NOT NULL,
  environment_label VARCHAR2(20 CHAR) NOT NULL,
  owner_id          NUMBER NOT NULL,
  server_type       VARCHAR2(10 CHAR) DEFAULT 'Physical' NOT NULL,
  db_version        VARCHAR2(40 CHAR),
  db_edition        VARCHAR2(40 CHAR),
  database_instance VARCHAR2(512 CHAR),
  enable_access     CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  db_port           NUMBER DEFAULT 1521 NOT NULL,
  division          VARCHAR2(10 CHAR) DEFAULT 'PCPB' NOT NULL,
  created_at        TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at        TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  created_by        VARCHAR2(128 CHAR),
  updated_by        VARCHAR2(128 CHAR),
  CONSTRAINT database_inventory_pk PRIMARY KEY (id),
  CONSTRAINT database_inventory_owner_fk FOREIGN KEY (owner_id) REFERENCES app_users(user_id),
  CONSTRAINT database_inventory_dbname_uk UNIQUE (database_name),
  CONSTRAINT database_inventory_role_ck CHECK (database_role IN ('Primary', 'Standby', 'Data Guard', 'RAC')),
  CONSTRAINT database_inventory_type_ck CHECK (database_type IN ('Standalone', 'RAC', 'Exadata', 'Container (CDB)')),
  CONSTRAINT database_inventory_status_ck CHECK (status IN ('healthy', 'warning', 'critical', 'offline')),
  CONSTRAINT database_inventory_stype_ck CHECK (server_type IN ('Physical', 'Virtual', 'Cloud')),
  CONSTRAINT database_inventory_access_ck CHECK (enable_access IN ('Y', 'N')),
  CONSTRAINT database_inventory_div_ck CHECK (division IN ('PCPB', 'SME', 'CORP', 'RETAIL', 'INFRA'))
);

CREATE INDEX db_inv_owner_ix ON database_inventory (owner_id);
CREATE INDEX db_inv_env_ix ON database_inventory (environment);

-- DB_OWNER_MAPPING
CREATE TABLE db_owner_mapping (
  mapping_id    NUMBER NOT NULL,
  database_id   NUMBER NOT NULL,
  owner_user_id NUMBER NOT NULL,
  assigned_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  assigned_by   VARCHAR2(128 CHAR),
  CONSTRAINT db_owner_mapping_pk PRIMARY KEY (mapping_id),
  CONSTRAINT db_owner_mapping_db_fk FOREIGN KEY (database_id) REFERENCES database_inventory(id) ON DELETE CASCADE,
  CONSTRAINT db_owner_mapping_owner_fk FOREIGN KEY (owner_user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
  CONSTRAINT db_owner_mapping_uk UNIQUE (database_id, owner_user_id)
);

-- APP_DATABASE_CATALOG (RAC / Multi-Instance metadata)
CREATE TABLE app_database_catalog (
  id            NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  database_name VARCHAR2(128 CHAR) NOT NULL UNIQUE,
  is_rac        CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  instances_cnt NUMBER DEFAULT 1 NOT NULL,
  created_at    TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

-- APP_ALERT_NOTIFICATIONS
CREATE TABLE app_alert_notifications (
  alert_id VARCHAR2(64 CHAR) NOT NULL,
  source_name VARCHAR2(64 CHAR) DEFAULT 'n8n' NOT NULL,
  alert_type VARCHAR2(64 CHAR) DEFAULT 'tablespace' NOT NULL,
  db_name VARCHAR2(64 CHAR) NOT NULL,
  tablespace_name VARCHAR2(128 CHAR),
  object_name VARCHAR2(128 CHAR),
  severity VARCHAR2(32 CHAR) NOT NULL,
  alert_status VARCHAR2(32 CHAR) DEFAULT 'pending_approval' NOT NULL,
  message_text CLOB NOT NULL,
  utilization_pct NUMBER,
  threshold_pct NUMBER,
  critical_pct NUMBER,
  used_gb NUMBER,
  free_gb NUMBER,
  extend_size_gb NUMBER,
  datafile_name VARCHAR2(512 CHAR),
  workflow_run_id VARCHAR2(128 CHAR),
  approval_url VARCHAR2(2000 CHAR),
  reject_url VARCHAR2(2000 CHAR),
  callback_url VARCHAR2(2000 CHAR),
  created_by VARCHAR2(128 CHAR) DEFAULT 'n8n' NOT NULL,
  approved_by VARCHAR2(128 CHAR),
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  approved_at TIMESTAMP(6),
  completed_at TIMESTAMP(6),
  metadata_json CLOB,
  is_read CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  read_at TIMESTAMP(6) WITH TIME ZONE,
  read_by VARCHAR2(100 CHAR),
  CONSTRAINT app_alert_notifications_pk PRIMARY KEY (alert_id),
  CONSTRAINT app_alert_notifications_sev_ck CHECK (severity IN ('info', 'warning', 'critical', 'error')),
  CONSTRAINT app_alert_notifications_status_ck CHECK (alert_status IN ('pending_approval', 'approved', 'rejected', 'completed', 'failed', 'acknowledged'))
);

CREATE INDEX app_alert_notif_db_ix ON app_alert_notifications (db_name, alert_type, alert_status);
CREATE INDEX app_alert_notif_created_ix ON app_alert_notifications (created_at);

-- APP_DB_MONITORING_INCIDENTS
CREATE TABLE app_db_monitoring_incidents (
  incident_id     VARCHAR2(64 CHAR) NOT NULL,
  db_name         VARCHAR2(64 CHAR) NOT NULL,
  incident_status VARCHAR2(32 CHAR) DEFAULT 'DOWN' NOT NULL,
  first_reported  TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  last_reported   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  report_count    NUMBER DEFAULT 1 NOT NULL,
  acknowledged_by VARCHAR2(128 CHAR),
  acknowledged_at TIMESTAMP(6),
  resolved_at     TIMESTAMP(6),
  created_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  is_read         CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  read_at         TIMESTAMP(6) WITH TIME ZONE,
  read_by         VARCHAR2(100 CHAR),
  CONSTRAINT app_db_monitoring_pk PRIMARY KEY (incident_id),
  CONSTRAINT app_db_monitoring_status_ck CHECK (incident_status IN ('DOWN','ACKNOWLEDGED','RESOLVED'))
);

CREATE INDEX app_db_mon_db_status_ix ON app_db_monitoring_incidents (db_name, incident_status);
CREATE INDEX app_db_mon_status_ix ON app_db_monitoring_incidents (incident_status, last_reported);

-- APP_PROTECTED_ACTIONS
CREATE TABLE app_protected_actions (
  action_id    NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  action_name  VARCHAR2(64 CHAR) NOT NULL UNIQUE,
  display_name VARCHAR2(128 CHAR) NOT NULL,
  category     VARCHAR2(64 CHAR) DEFAULT 'user_management' NOT NULL,
  risk_level   VARCHAR2(16 CHAR) DEFAULT 'high' NOT NULL,
  description  VARCHAR2(500 CHAR),
  is_active    CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  created_by   VARCHAR2(128 CHAR),
  created_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by   VARCHAR2(128 CHAR),
  updated_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT ck_prot_action_active CHECK (is_active IN ('Y','N')),
  CONSTRAINT ck_prot_action_risk CHECK (risk_level IN ('low','medium','high','critical'))
);

-- APP_APPROVAL_REQUESTS
CREATE TABLE app_approval_requests (
  request_id          VARCHAR2(64 CHAR) NOT NULL,
  action_name         VARCHAR2(64 CHAR) NOT NULL,
  display_name        VARCHAR2(128 CHAR) NOT NULL,
  db_name             VARCHAR2(128 CHAR) NOT NULL,
  environment         VARCHAR2(20 CHAR) NOT NULL,
  requester_user_id   NUMBER NOT NULL,
  requester_username  VARCHAR2(128 CHAR) NOT NULL,
  request_status      VARCHAR2(20 CHAR) DEFAULT 'pending' NOT NULL,
  risk_level          VARCHAR2(16 CHAR) DEFAULT 'high' NOT NULL,
  reviewer_user_id    NUMBER,
  reviewer_username   VARCHAR2(128 CHAR),
  reviewer_comment    VARCHAR2(2000 CHAR),
  reviewed_at         TIMESTAMP(6),
  webhook_payload     CLOB NOT NULL,
  request_params      CLOB,
  execution_status    VARCHAR2(20 CHAR),
  execution_response  CLOB,
  executed_at         TIMESTAMP(6),
  expires_at          TIMESTAMP(6),
  created_at          TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at          TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  is_read             CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  read_at             TIMESTAMP(6) WITH TIME ZONE,
  read_by             VARCHAR2(100 CHAR),
  CONSTRAINT pk_app_approval_requests PRIMARY KEY (request_id),
  CONSTRAINT ck_app_approval_req_status CHECK (request_status IN ('pending','approved','rejected','expired')),
  CONSTRAINT ck_app_approval_req_risk CHECK (risk_level IN ('low','medium','high','critical'))
);

CREATE INDEX ix_approval_req_status ON app_approval_requests (request_status, created_at DESC);
CREATE INDEX ix_approval_req_user ON app_approval_requests (requester_user_id, created_at DESC);

-- APP_APPROVAL_HISTORY
CREATE TABLE app_approval_history (
  history_id       NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  request_id       VARCHAR2(64 CHAR) NOT NULL,
  action_name      VARCHAR2(64 CHAR) NOT NULL,
  actor_user_id    NUMBER,
  actor_username   VARCHAR2(128 CHAR) NOT NULL,
  event_type       VARCHAR2(32 CHAR) NOT NULL,
  previous_status  VARCHAR2(20 CHAR),
  new_status       VARCHAR2(20 CHAR) NOT NULL,
  comment_text     VARCHAR2(2000 CHAR),
  created_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_app_approval_hist_req FOREIGN KEY (request_id) REFERENCES app_approval_requests(request_id) ON DELETE CASCADE
);

-- APP_CHANGE_AUDIT_LOG
CREATE TABLE app_change_audit_log (
  change_id     NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  target_type   VARCHAR2(64 CHAR) NOT NULL,
  target_id     VARCHAR2(128 CHAR) NOT NULL,
  action        VARCHAR2(64 CHAR) NOT NULL,
  actor_username VARCHAR2(128 CHAR) NOT NULL,
  details_json  CLOB,
  created_at    TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX ix_change_audit_target ON app_change_audit_log (target_type, target_id);
CREATE INDEX ix_change_audit_created ON app_change_audit_log (created_at DESC);

-- DASHBOARD_HISTORY & SCHEDULES
CREATE TABLE dashboard_history (
  id           NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  db_name      VARCHAR2(64 CHAR) NOT NULL,
  payload_json CLOB NOT NULL,
  created_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX ix_dashboard_history_db ON dashboard_history (db_name, created_at DESC);

CREATE TABLE app_dashboard_schedules (
  id           NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  db_name      VARCHAR2(64 CHAR) NOT NULL UNIQUE,
  interval_min NUMBER DEFAULT 15 NOT NULL,
  is_active    CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  last_run_at  TIMESTAMP(6),
  next_run_at  TIMESTAMP(6),
  run_count    NUMBER DEFAULT 0 NOT NULL,
  last_status  VARCHAR2(32 CHAR),
  created_by   VARCHAR2(128 CHAR),
  created_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

-- DBA_ALERT_LOG
CREATE TABLE dba_alert_log (
  id           NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  db_name      VARCHAR2(64 CHAR) NOT NULL,
  alert_level  VARCHAR2(32 CHAR) NOT NULL,
  message      CLOB NOT NULL,
  logged_at    TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  created_at   TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX ix_dba_alert_log_db ON dba_alert_log (db_name, logged_at DESC);

-- APP_SHIFT_SESSIONS & APP_HANDOVERS
CREATE TABLE app_shift_sessions (
  session_id    NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  user_id       NUMBER NOT NULL,
  username      VARCHAR2(128 CHAR) NOT NULL,
  email         VARCHAR2(320 CHAR) NOT NULL,
  shift_number  NUMBER NOT NULL,
  shift_date    DATE NOT NULL,
  login_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  logout_at     TIMESTAMP(6),
  status        VARCHAR2(16 CHAR) DEFAULT 'ACTIVE' NOT NULL,
  is_active     CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  created_by    VARCHAR2(128 CHAR),
  created_at    TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by    VARCHAR2(128 CHAR),
  updated_at    TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  is_read       CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  read_at       TIMESTAMP(6),
  read_by       VARCHAR2(100 CHAR),
  logout_is_read CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  logout_read_at TIMESTAMP(6),
  logout_read_by VARCHAR2(100 CHAR),
  late_comment  VARCHAR2(1000 CHAR),
  emergency_comment VARCHAR2(1000 CHAR),
  CONSTRAINT fk_shift_session_user FOREIGN KEY (user_id) REFERENCES app_users(user_id),
  CONSTRAINT ck_shift_session_shift CHECK (shift_number IN (1,2,3,4)),
  CONSTRAINT ck_shift_session_status CHECK (status IN ('ACTIVE','CLOSED'))
);

CREATE INDEX ix_shift_session_user ON app_shift_sessions (user_id, login_at);

CREATE TABLE app_handovers (
  handover_id      NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  session_id       NUMBER NOT NULL,
  author_user_id   NUMBER NOT NULL,
  author_username  VARCHAR2(128 CHAR) NOT NULL,
  shift_number     NUMBER NOT NULL,
  shift_date       DATE NOT NULL,
  handover_text    CLOB NOT NULL,
  status           VARCHAR2(16 CHAR) DEFAULT 'PENDING' NOT NULL,
  ack_user_id      NUMBER,
  ack_username     VARCHAR2(128 CHAR),
  ack_at           TIMESTAMP(6),
  override_reason  VARCHAR2(500 CHAR),
  is_override      CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  created_by       VARCHAR2(128 CHAR),
  created_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by       VARCHAR2(128 CHAR),
  updated_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  is_read          CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  read_at          TIMESTAMP(6) WITH TIME ZONE,
  read_by          VARCHAR2(100 CHAR),
  CONSTRAINT fk_handover_session FOREIGN KEY (session_id) REFERENCES app_shift_sessions(session_id)
);

-- APP_BACKUP_TEMPLATE, STATUS CHECKS & WEBHOOK LOGS
CREATE TABLE app_backup_template (
  backup_id      NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  database_id    NUMBER NOT NULL,
  backup_name    VARCHAR2(128 CHAR) NOT NULL,
  scheduled_time VARCHAR2(10 CHAR) NOT NULL,
  backup_type    VARCHAR2(40 CHAR) DEFAULT 'RMAN Full' NOT NULL,
  is_active      CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  created_by     VARCHAR2(128 CHAR),
  created_at     TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by     VARCHAR2(128 CHAR),
  updated_at     TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_backup_tpl_db FOREIGN KEY (database_id) REFERENCES database_inventory(id) ON DELETE CASCADE
);

CREATE TABLE app_db_status_checks (
  check_id         NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  database_id      NUMBER NOT NULL,
  shift_number     NUMBER NOT NULL,
  shift_date       DATE NOT NULL,
  status           VARCHAR2(16 CHAR) NOT NULL,
  checked_by       NUMBER NOT NULL,
  checked_username VARCHAR2(128 CHAR) NOT NULL,
  checked_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  comment_text     VARCHAR2(1000 CHAR),
  created_by       VARCHAR2(128 CHAR),
  created_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by       VARCHAR2(128 CHAR),
  updated_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_db_check_db FOREIGN KEY (database_id) REFERENCES database_inventory(id) ON DELETE CASCADE
);

CREATE TABLE app_backup_status_checks (
  check_id         NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  backup_id        NUMBER NOT NULL,
  database_id      NUMBER NOT NULL,
  shift_number     NUMBER NOT NULL,
  shift_date       DATE NOT NULL,
  status           VARCHAR2(16 CHAR) NOT NULL,
  checked_by       NUMBER NOT NULL,
  checked_username VARCHAR2(128 CHAR) NOT NULL,
  checked_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  comment_text     VARCHAR2(1000 CHAR),
  created_by       VARCHAR2(128 CHAR),
  created_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by       VARCHAR2(128 CHAR),
  updated_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_bk_check_tpl FOREIGN KEY (backup_id) REFERENCES app_backup_template(backup_id) ON DELETE CASCADE,
  CONSTRAINT fk_bk_check_db FOREIGN KEY (database_id) REFERENCES database_inventory(id) ON DELETE CASCADE
);

CREATE TABLE app_webhook_logs (
  log_id         NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  event_type     VARCHAR2(64 CHAR) NOT NULL,
  request_payload CLOB,
  response_body  CLOB,
  status_code    NUMBER,
  created_at     TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

-- APP_FILESYSTEM_DRIVE_UTILIZATION
CREATE TABLE app_filesystem_drive_utilization (
  drive_id       NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id   VARCHAR2(128 CHAR) NOT NULL,
  db_name        VARCHAR2(64 CHAR) NOT NULL,
  filesystem     VARCHAR2(255 CHAR) NOT NULL,
  size_gb        NUMBER,
  used_gb        NUMBER,
  avail_gb       NUMBER,
  pct_used       NUMBER,
  mount_point    VARCHAR2(255 CHAR),
  created_at     TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

-- PASSWORD RESET TABLES
CREATE TABLE app_password_reset_attempts (
  attempt_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_email VARCHAR2(320 CHAR) NOT NULL,
  request_ip VARCHAR2(64 CHAR),
  user_agent VARCHAR2(512 CHAR),
  accepted CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_password_resets (
  reset_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  user_id NUMBER NOT NULL,
  token_hash VARCHAR2(64 CHAR) NOT NULL UNIQUE,
  requested_email VARCHAR2(320 CHAR) NOT NULL,
  request_ip VARCHAR2(64 CHAR),
  user_agent VARCHAR2(512 CHAR),
  expires_at TIMESTAMP(6) NOT NULL,
  used_at TIMESTAMP(6),
  created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_pw_reset_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

-- PERFORMANCE TUNING TABLES
CREATE TABLE app_perf_run_summary (
  perf_run_id         NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id        VARCHAR2(128 CHAR) NOT NULL UNIQUE,
  external_request_id VARCHAR2(128 CHAR),
  requested_by        VARCHAR2(128 CHAR) NOT NULL,
  db_name             VARCHAR2(64 CHAR) NOT NULL,
  run_status          VARCHAR2(32 CHAR) DEFAULT 'success' NOT NULL,
  ai_summary          CLOB,
  llm_output          CLOB,
  raw_output          CLOB,
  created_at          TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_top_sql (
  top_sql_row_id      NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id        VARCHAR2(128 CHAR) NOT NULL,
  requested_by        VARCHAR2(128 CHAR) NOT NULL,
  db_name             VARCHAR2(64 CHAR) NOT NULL,
  sql_id              VARCHAR2(32 CHAR),
  plan_hash_value     NUMBER,
  parsing_schema_name VARCHAR2(128 CHAR),
  module_name         VARCHAR2(255 CHAR),
  executions          NUMBER,
  elapsed_sec         NUMBER,
  cpu_sec             NUMBER,
  buffer_gets         NUMBER,
  disk_reads          NUMBER,
  rows_processed      NUMBER,
  sql_text            CLOB,
  raw_row_json        CLOB,
  created_at          TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_cpu_usage (
  cpu_row_id              NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id            VARCHAR2(128 CHAR) NOT NULL,
  requested_by            VARCHAR2(128 CHAR) NOT NULL,
  db_name                 VARCHAR2(64 CHAR) NOT NULL,
  num_cpus                NUMBER,
  current_total_cpu_util  NUMBER,
  user_cpu_util           NUMBER,
  system_cpu_util         NUMBER,
  busy_time               NUMBER,
  idle_time               NUMBER,
  raw_row_json            CLOB,
  created_at              TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_wait_events (
  wait_event_row_id  NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id       VARCHAR2(128 CHAR) NOT NULL,
  requested_by       VARCHAR2(128 CHAR) NOT NULL,
  db_name            VARCHAR2(64 CHAR) NOT NULL,
  event_name         VARCHAR2(255 CHAR),
  wait_class         VARCHAR2(128 CHAR),
  total_waits        NUMBER,
  time_waited_sec    NUMBER,
  avg_wait_cs        NUMBER,
  raw_row_json       CLOB,
  created_at         TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_session_longops (
  longops_row_id   NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id     VARCHAR2(128 CHAR) NOT NULL,
  requested_by     VARCHAR2(128 CHAR) NOT NULL,
  db_name          VARCHAR2(64 CHAR) NOT NULL,
  sid              NUMBER,
  serial_num       NUMBER,
  db_username      VARCHAR2(128 CHAR),
  sql_id           VARCHAR2(32 CHAR),
  operation_name   VARCHAR2(255 CHAR),
  pct_done         NUMBER,
  elapsed_min      NUMBER,
  eta_min          NUMBER,
  raw_row_json     CLOB,
  created_at       TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_invalid_objects (
  invalid_row_id  NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id    VARCHAR2(128 CHAR) NOT NULL,
  requested_by    VARCHAR2(128 CHAR) NOT NULL,
  db_name         VARCHAR2(64 CHAR) NOT NULL,
  owner_name      VARCHAR2(128 CHAR),
  object_type     VARCHAR2(128 CHAR),
  object_name     VARCHAR2(255 CHAR),
  object_status   VARCHAR2(32 CHAR),
  last_ddl_time   TIMESTAMP(6),
  raw_row_json    CLOB,
  created_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_sessions (
  session_row_id  NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id    VARCHAR2(128 CHAR) NOT NULL,
  requested_by    VARCHAR2(128 CHAR) NOT NULL,
  db_name         VARCHAR2(64 CHAR) NOT NULL,
  sid             NUMBER,
  serial_num      NUMBER,
  db_username     VARCHAR2(128 CHAR),
  os_user         VARCHAR2(128 CHAR),
  machine_name    VARCHAR2(255 CHAR),
  program_name    VARCHAR2(255 CHAR),
  sql_id          VARCHAR2(32 CHAR),
  event_name      VARCHAR2(255 CHAR),
  session_state   VARCHAR2(32 CHAR),
  session_status  VARCHAR2(32 CHAR),
  seconds_in_wait NUMBER,
  last_call_et    NUMBER,
  raw_row_json    CLOB,
  created_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_locks (
  lock_row_id     NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id    VARCHAR2(128 CHAR) NOT NULL,
  requested_by    VARCHAR2(128 CHAR) NOT NULL,
  db_name         VARCHAR2(64 CHAR) NOT NULL,
  waiter_sid      NUMBER,
  waiter_serial   NUMBER,
  waiter_user     VARCHAR2(128 CHAR),
  waiter_sql_id   VARCHAR2(32 CHAR),
  blocker_sid     NUMBER,
  blocker_serial  NUMBER,
  blocker_user    VARCHAR2(128 CHAR),
  blocker_sql_id  VARCHAR2(32 CHAR),
  waiting_min     NUMBER,
  event_name      VARCHAR2(255 CHAR),
  raw_row_json    CLOB,
  created_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_perf_long_queries (
  long_query_row_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  run_group_id      VARCHAR2(128 CHAR) NOT NULL,
  requested_by      VARCHAR2(128 CHAR) NOT NULL,
  db_name           VARCHAR2(64 CHAR) NOT NULL,
  sid               NUMBER,
  serial_num        NUMBER,
  db_username       VARCHAR2(128 CHAR),
  machine_name      VARCHAR2(255 CHAR),
  running_seconds   NUMBER,
  sql_id            VARCHAR2(32 CHAR),
  sql_text          CLOB,
  raw_row_json      CLOB,
  created_at        TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE performance_run_all_hist (
  run_id          NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  db_name         VARCHAR2(64 CHAR) NOT NULL,
  environment     VARCHAR2(40 CHAR),
  os              VARCHAR2(30 CHAR),
  refreshed_by    VARCHAR2(128 CHAR) NOT NULL,
  metrics_payload CLOB NOT NULL,
  ai_summary      CLOB,
  created_at      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

-- APP_RMAN_JOB_HISTORY
CREATE TABLE app_rman_job_history (
  job_id        VARCHAR2(64 CHAR) NOT NULL PRIMARY KEY,
  database_name VARCHAR2(128 CHAR) NOT NULL,
  backup_type   VARCHAR2(64 CHAR) NOT NULL,
  status        VARCHAR2(32 CHAR) NOT NULL,
  started_at    TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  completed_at  TIMESTAMP(6),
  ai_summary    CLOB,
  raw_output    CLOB,
  params_json   CLOB,
  requested_by  VARCHAR2(128 CHAR)
);

-- APP_SECURITY_POSTURE_REPORTS
CREATE TABLE app_security_posture_reports (
  report_id             NUMBER NOT NULL PRIMARY KEY,
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
  is_active             CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
  replaced_at           TIMESTAMP WITH TIME ZONE,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  outdated_webhook_sent_at     TIMESTAMP WITH TIME ZONE,
  outdated_webhook_claimed_at  TIMESTAMP WITH TIME ZONE,
  outdated_webhook_send_count  NUMBER DEFAULT 0 NOT NULL,
  outdated_webhook_next_send_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_security_posture_db FOREIGN KEY (database_id) REFERENCES database_inventory(id) ON DELETE CASCADE,
  CONSTRAINT fk_security_posture_user FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);

-- RUN CHECK RESULTS TABLES
CREATE TABLE app_run_metrics (
  metric_row_id         NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  metric_name           VARCHAR2(128 CHAR)   NOT NULL,
  metric_value_number   NUMBER,
  metric_value_text     VARCHAR2(4000 CHAR),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_trend_points (
  trend_row_id          NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  point_label           VARCHAR2(128 CHAR),
  point_name            VARCHAR2(128 CHAR)   NOT NULL,
  point_value_number    NUMBER,
  point_value_text      VARCHAR2(4000 CHAR),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_tablespaces (
  tablespace_row_id     NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  db_name               VARCHAR2(64 CHAR),
  tablespace_name       VARCHAR2(128 CHAR),
  used_gb               NUMBER,
  free_gb               NUMBER,
  pct_used              NUMBER,
  tablespace_status     VARCHAR2(32 CHAR),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_sessions (
  session_row_id        NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  sid                   NUMBER,
  serial_num            NUMBER,
  db_username           VARCHAR2(128 CHAR),
  machine_name          VARCHAR2(255 CHAR),
  program_name          VARCHAR2(255 CHAR),
  session_status        VARCHAR2(32 CHAR),
  wait_event            VARCHAR2(255 CHAR),
  seconds_in_wait       NUMBER,
  sql_id                VARCHAR2(32 CHAR),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_sql_metrics (
  sql_row_id            NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  sql_id                VARCHAR2(32 CHAR),
  module_name           VARCHAR2(255 CHAR),
  executions            NUMBER,
  elapsed_ms            NUMBER,
  cpu_ms                NUMBER,
  buffer_gets           NUMBER,
  sql_text              CLOB,
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_locks (
  lock_row_id           NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  blocker_sid           NUMBER,
  waiter_sid            NUMBER,
  lock_object           VARCHAR2(255 CHAR),
  wait_minutes          NUMBER,
  lock_mode             VARCHAR2(64 CHAR),
  lock_payload_json     CLOB,
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_backups (
  backup_row_id         NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  backup_external_id    VARCHAR2(128 CHAR),
  backup_type           VARCHAR2(64 CHAR),
  started_at            TIMESTAMP(6),
  duration_min          NUMBER,
  backup_status         VARCHAR2(32 CHAR),
  compression_ratio     NUMBER,
  size_gb               NUMBER,
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_alerts (
  alert_row_id          NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  alert_timestamp       TIMESTAMP(6),
  severity              VARCHAR2(32 CHAR),
  message_text          CLOB,
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_invalid_objects (
  invalid_row_id        NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  owner_name            VARCHAR2(128 CHAR),
  object_name           VARCHAR2(255 CHAR),
  object_type           VARCHAR2(128 CHAR),
  object_status         VARCHAR2(32 CHAR),
  last_ddl_time         TIMESTAMP(6),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_security_privileges (
  privilege_row_id      NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  grantee_name          VARCHAR2(128 CHAR),
  privilege_name        VARCHAR2(255 CHAR),
  risk_level            VARCHAR2(32 CHAR),
  payload_json          CLOB,
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_findings (
  finding_row_id        NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  title                 VARCHAR2(500 CHAR),
  detail                CLOB,
  severity              VARCHAR2(32 CHAR),
  object_name           VARCHAR2(255 CHAR),
  metric_name           VARCHAR2(128 CHAR),
  metric_value          VARCHAR2(512 CHAR),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE app_run_recommendations (
  recommendation_row_id NUMBER          GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  requested_by          VARCHAR2(128 CHAR)   NOT NULL,
  title                 VARCHAR2(500 CHAR),
  detail                CLOB,
  severity              VARCHAR2(32 CHAR),
  suggested_action      VARCHAR2(64 CHAR),
  created_at            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL
);

-- DATAPUMP TABLES
CREATE TABLE datapump_expdp_templates (
  template_id        NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  template_name      VARCHAR2(128 CHAR) NOT NULL,
  database_name      VARCHAR2(128 CHAR),
  created_by         VARCHAR2(128 CHAR) NOT NULL,
  created_at         TIMESTAMP(6) WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  params_json        CLOB,
  dump_transfer_req  VARCHAR2(10 CHAR) DEFAULT 'no',
  transfer_server    VARCHAR2(128 CHAR),
  compression        VARCHAR2(50 CHAR),
  schemas_list       VARCHAR2(4000 CHAR)
);

CREATE TABLE datapump_impdp_templates (
  template_id        NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
  template_name      VARCHAR2(128 CHAR) NOT NULL,
  database_name      VARCHAR2(128 CHAR),
  created_by         VARCHAR2(128 CHAR) NOT NULL,
  created_at         TIMESTAMP(6) WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  params_json        CLOB,
  drop_user          VARCHAR2(10 CHAR) DEFAULT 'no',
  table_exists_action VARCHAR2(50 CHAR),
  content_type       VARCHAR2(50 CHAR),
  schemas_list       VARCHAR2(4000 CHAR)
);

CREATE TABLE datapump_job_history (
  job_id          VARCHAR2(50 CHAR) NOT NULL PRIMARY KEY,
  operation       VARCHAR2(20 CHAR) NOT NULL,
  database_name   VARCHAR2(128 CHAR) NOT NULL,
  status          VARCHAR2(20 CHAR) DEFAULT 'running' NOT NULL,
  started_at      TIMESTAMP(6) WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  completed_at    TIMESTAMP(6) WITH TIME ZONE,
  dump_file       VARCHAR2(500 CHAR),
  transfer_status VARCHAR2(500 CHAR),
  message         CLOB,
  requested_by    VARCHAR2(128 CHAR),
  params_json     CLOB
);

--------------------------------------------------------------------------------
-- 5) Helper Procedures & Triggers
--------------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE upsert_user_theme_preference (
  p_user_id IN NUMBER,
  p_theme   IN VARCHAR2
) IS
BEGIN
  MERGE INTO app_user_preferences dst
  USING (
    SELECT p_user_id AS user_id, LOWER(TRIM(p_theme)) AS theme_preference
    FROM dual
  ) src
  ON (dst.user_id = src.user_id)
  WHEN MATCHED THEN
    UPDATE SET dst.theme_preference = src.theme_preference, dst.updated_at = SYSTIMESTAMP
  WHEN NOT MATCHED THEN
    INSERT (user_id, theme_preference)
    VALUES (src.user_id, src.theme_preference);
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

--------------------------------------------------------------------------------
-- 6) Bootstrap Initial Seed Data
--------------------------------------------------------------------------------

-- Admin User (username: ARINDAM, password: Password123, token: Password123)
MERGE INTO app_users dst
USING (
  SELECT
    'ARINDAM' AS username,
    'arindam@example.local' AS email,
    'LOCAL-DEV-SALT-2026' AS salt_value
  FROM dual
) src
ON (dst.username = src.username)
WHEN MATCHED THEN
  UPDATE SET
    dst.password_salt = src.salt_value,
    dst.email = src.email,
    dst.password_hash = LOWER(RAWTOHEX(STANDARD_HASH(src.salt_value || ':Password123', 'SHA256'))),
    dst.api_token_hash = LOWER(RAWTOHEX(STANDARD_HASH(src.salt_value || ':Password123', 'SHA256'))),
    dst.role = 'dba_admin',
    dst.is_active = 'Y',
    dst.must_change_password = 'N',
    dst.failed_login_count = 0,
    dst.locked_until = NULL
WHEN NOT MATCHED THEN
  INSERT (
    username,
    email,
    password_salt,
    password_hash,
    api_token_hash,
    role,
    is_active,
    must_change_password
  )
  VALUES (
    src.username,
    src.email,
    src.salt_value,
    LOWER(RAWTOHEX(STANDARD_HASH(src.salt_value || ':Password123', 'SHA256'))),
    LOWER(RAWTOHEX(STANDARD_HASH(src.salt_value || ':Password123', 'SHA256'))),
    'dba_admin',
    'Y',
    'N'
  );

-- Protected Actions Default List
MERGE INTO app_protected_actions dst
USING (
  SELECT 'CREATE_USER' AS action_name, 'Create User' AS display_name, 'user_management' AS category, 'high' AS risk_level, 'Creates a new user in the application' AS description FROM dual UNION ALL
  SELECT 'DELETE_USER', 'Delete User', 'user_management', 'critical', 'Deletes a user account' FROM dual UNION ALL
  SELECT 'RESET_PASSWORD', 'Reset Password', 'user_management', 'medium', 'Resets a user password' FROM dual UNION ALL
  SELECT 'KILL_SESSION', 'Kill DB Session', 'database_admin', 'high', 'Terminates an active database session' FROM dual UNION ALL
  SELECT 'ALTER_TABLESPACE', 'Alter Tablespace', 'database_admin', 'high', 'Resizes or adds datafiles to a tablespace' FROM dual UNION ALL
  SELECT 'EXECUTE_RMAN', 'Execute RMAN Job', 'database_admin', 'critical', 'Triggers an RMAN backup or restore operation' FROM dual UNION ALL
  SELECT 'DASHBOARD_SCHEDULE', 'Dashboard Schedule', 'monitoring', 'medium', 'Configures server-side auto-refresh schedules for database dashboard' FROM dual
) src
ON (dst.action_name = src.action_name)
WHEN NOT MATCHED THEN
  INSERT (action_name, display_name, category, risk_level, description)
  VALUES (src.action_name, src.display_name, src.category, src.risk_level, src.description);

COMMIT;

--------------------------------------------------------------------------------
-- 7) Clean up temporary helper procedures
--------------------------------------------------------------------------------
DROP PROCEDURE drop_table_if_exists;
DROP PROCEDURE drop_sequence_if_exists;

PROMPT Complete Oracle application schema created successfully.
