SET DEFINE OFF;

-- ============================================================================
-- APP_SYSTEM_CONFIG
-- Stores global system configuration parameters such as the number of days
-- of performance trend data to send to n8n during the RUN ALL check_performance action.
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

COMMIT;
