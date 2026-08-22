SET DEFINE OFF;

-- ============================================================================
-- APP_SYSTEM_CONFIG
-- Stores global system configuration parameters such as:
-- 1. Number of days of performance trend data to send to n8n during RUN ALL (check_performance).
-- 2. Security Posture Nessus scan report policies (outdated threshold, webhook limits, scanner intervals).
-- 3. Audit Log Retention Policy (retention period in days, automated purge toggle, purge run metrics).
-- ============================================================================

DECLARE
  table_exists NUMBER := 0;
BEGIN
  SELECT COUNT(*) INTO table_exists FROM user_tables WHERE UPPER(table_name) = 'APP_SYSTEM_CONFIG';
  IF table_exists = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE app_system_config (
        config_key    VARCHAR2(100) NOT NULL PRIMARY KEY,
        config_value  VARCHAR2(4000) NOT NULL,
        description   VARCHAR2(500),
        updated_by    VARCHAR2(100),
        updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
      )
    ';
  END IF;
END;
/

-- Seed default for PERF_RUN_ALL_TREND_DAYS if not already present
MERGE INTO app_system_config dst
USING (SELECT 'PERF_RUN_ALL_TREND_DAYS' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('PERF_RUN_ALL_TREND_DAYS', '3', 'Number of days of performance trend data sent to n8n on RUN ALL', 'SYSTEM');

-- Seed default for SECURITY_POSTURE_OUTDATED_AFTER_MINUTES (43200 min = 30 days)
MERGE INTO app_system_config dst
USING (SELECT 'SECURITY_POSTURE_OUTDATED_AFTER_MINUTES' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('SECURITY_POSTURE_OUTDATED_AFTER_MINUTES', '43200', 'Age in minutes at which an active security posture report is considered outdated', 'SYSTEM');

-- Seed default for SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS (7)
MERGE INTO app_system_config dst
USING (SELECT 'SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS', '7', 'Maximum number of overdue security posture webhook notifications sent per document', 'SYSTEM');

-- Seed default for SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS (24 hours)
MERGE INTO app_system_config dst
USING (SELECT 'SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS', '24', 'Interval in hours between consecutive overdue security posture webhook notifications', 'SYSTEM');

-- Seed default for SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES (240 min = 4 hours)
MERGE INTO app_system_config dst
USING (SELECT 'SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES', '240', 'Scheduler check interval in minutes for overdue security posture webhook notifications', 'SYSTEM');

-- Seed default for AUDIT_LOG_RETENTION_DAYS (1095 days = 3 years, range: 1 to 7 years)
MERGE INTO app_system_config dst
USING (SELECT 'AUDIT_LOG_RETENTION_DAYS' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('AUDIT_LOG_RETENTION_DAYS', '1095', 'Retention period in days (1 to 7 years, default 3 years) for application audit logs in APP_AUDIT_LOGS table', 'SYSTEM');

-- Seed default for AUDIT_LOG_AUTO_PURGE_ENABLED (TRUE)
MERGE INTO app_system_config dst
USING (SELECT 'AUDIT_LOG_AUTO_PURGE_ENABLED' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('AUDIT_LOG_AUTO_PURGE_ENABLED', 'TRUE', 'Whether the background scheduler automatically purges audit logs older than retention period', 'SYSTEM');

-- Seed default for AUDIT_LOG_LAST_PURGE_AT (NULL)
MERGE INTO app_system_config dst
USING (SELECT 'AUDIT_LOG_LAST_PURGE_AT' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('AUDIT_LOG_LAST_PURGE_AT', '', 'Timestamp of last audit log purge execution', 'SYSTEM');

-- Seed default for AUDIT_LOG_LAST_PURGED_COUNT (0)
MERGE INTO app_system_config dst
USING (SELECT 'AUDIT_LOG_LAST_PURGED_COUNT' AS config_key FROM dual) src
ON (dst.config_key = src.config_key)
WHEN NOT MATCHED THEN
  INSERT (config_key, config_value, description, updated_by)
  VALUES ('AUDIT_LOG_LAST_PURGED_COUNT', '0', 'Number of audit log records removed during last purge execution', 'SYSTEM');

COMMIT;
