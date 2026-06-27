-- ============================================================================
-- APP_DASHBOARD_SCHEDULES
-- Stores server-side auto-refresh schedules for the DBA dashboard.
-- The Next.js server-side scheduler (node-cron) reads this table on startup
-- and re-syncs every few minutes, so schedules survive browser sessions.
-- ============================================================================

CREATE TABLE APP_DASHBOARD_SCHEDULES (
  id            NUMBER         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  db_name       VARCHAR2(100)  NOT NULL,
  interval_min  NUMBER(6)      NOT NULL,        -- refresh interval in minutes (1–1440)
  is_active     NUMBER(1)      DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1)),
  created_by    VARCHAR2(100)  NOT NULL,
  created_at    TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at    TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  last_run_at   TIMESTAMP,
  next_run_at   TIMESTAMP,
  run_count     NUMBER(10)     DEFAULT 0 NOT NULL,
  last_status   VARCHAR2(20)   DEFAULT 'pending',
  CONSTRAINT uq_dash_sched_db UNIQUE (db_name)
);

COMMENT ON TABLE  APP_DASHBOARD_SCHEDULES IS 'Server-side dashboard auto-refresh schedules (one per DB)';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.db_name      IS 'Oracle DB identifier matching database_inventory.database_name';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.interval_min IS 'How often (in minutes) the scheduler fires refresh_dashboard to n8n';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.is_active    IS '1 = active, 0 = paused';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.last_run_at  IS 'Timestamp of most recent scheduler-triggered refresh';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.next_run_at  IS 'Estimated next execution time (informational)';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.run_count    IS 'Total number of scheduler-triggered refreshes';
COMMENT ON COLUMN APP_DASHBOARD_SCHEDULES.last_status  IS 'Result of the most recent run: pending | success | error';

-- Grant to application user (adjust schema prefix if needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON APP_DASHBOARD_SCHEDULES TO <app_user>;

COMMIT;
