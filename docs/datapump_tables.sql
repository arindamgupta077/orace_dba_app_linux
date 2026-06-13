-- =======================================================================
-- Oracle Data Pump Template Tables
-- Run as DBA or schema owner (e.g. SYS or your app schema)
-- =======================================================================

-- -----------------------------------------------------------------------
-- 1. EXPDP Templates
-- -----------------------------------------------------------------------
CREATE TABLE DATAPUMP_EXPDP_TEMPLATES (
  TEMPLATE_ID       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TEMPLATE_NAME     VARCHAR2(100)  NOT NULL,
  DATABASE_NAME     VARCHAR2(50),
  CREATED_BY        VARCHAR2(50)   NOT NULL,
  CREATED_AT        TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  UPDATED_AT        TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  -- Full params as JSON (CLOB to hold unlimited size)
  PARAMS_JSON       CLOB           NOT NULL,
  -- Quick-access columns to avoid JSON parse for listing
  DUMP_TRANSFER_REQ VARCHAR2(3)    DEFAULT 'no'   CHECK (DUMP_TRANSFER_REQ IN ('yes','no')),
  TRANSFER_SERVER   VARCHAR2(100),
  COMPRESSION       VARCHAR2(20),
  SCHEMAS_LIST      VARCHAR2(2000), -- comma-separated quick view
  --
  CONSTRAINT uq_expdp_tmpl UNIQUE (TEMPLATE_NAME, DATABASE_NAME, CREATED_BY)
);

-- Auto-update UPDATED_AT on row change
CREATE OR REPLACE TRIGGER trg_expdp_tmpl_upd
BEFORE UPDATE ON DATAPUMP_EXPDP_TEMPLATES
FOR EACH ROW
BEGIN
  :NEW.UPDATED_AT := SYSTIMESTAMP;
END;
/

COMMENT ON TABLE DATAPUMP_EXPDP_TEMPLATES IS
  'Saved parameter templates for Oracle Data Pump export (EXPDP) operations';


-- -----------------------------------------------------------------------
-- 2. IMPDP Templates
-- -----------------------------------------------------------------------
CREATE TABLE DATAPUMP_IMPDP_TEMPLATES (
  TEMPLATE_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TEMPLATE_NAME       VARCHAR2(100)  NOT NULL,
  DATABASE_NAME       VARCHAR2(50),
  CREATED_BY          VARCHAR2(50)   NOT NULL,
  CREATED_AT          TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  UPDATED_AT          TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  PARAMS_JSON         CLOB           NOT NULL,
  -- Quick-access columns
  DROP_USER           VARCHAR2(3)    DEFAULT 'yes'  CHECK (DROP_USER IN ('yes','no')),
  TABLE_EXISTS_ACTION VARCHAR2(20),
  CONTENT_TYPE        VARCHAR2(20),
  SCHEMAS_LIST        VARCHAR2(2000),
  --
  CONSTRAINT uq_impdp_tmpl UNIQUE (TEMPLATE_NAME, DATABASE_NAME, CREATED_BY)
);

CREATE OR REPLACE TRIGGER trg_impdp_tmpl_upd
BEFORE UPDATE ON DATAPUMP_IMPDP_TEMPLATES
FOR EACH ROW
BEGIN
  :NEW.UPDATED_AT := SYSTIMESTAMP;
END;
/

COMMENT ON TABLE DATAPUMP_IMPDP_TEMPLATES IS
  'Saved parameter templates for Oracle Data Pump import (IMPDP) operations';


-- -----------------------------------------------------------------------
-- 3. Data Pump Job History (optional — for server-side audit trail)
-- -----------------------------------------------------------------------
CREATE TABLE DATAPUMP_JOB_HISTORY (
  JOB_ID          VARCHAR2(50)   PRIMARY KEY,
  OPERATION       VARCHAR2(10)   NOT NULL CHECK (OPERATION IN ('expdp','impdp')),
  DATABASE_NAME   VARCHAR2(50)   NOT NULL,
  STATUS          VARCHAR2(20)   NOT NULL CHECK (STATUS IN ('running','success','error','completed')),
  STARTED_AT      TIMESTAMP      NOT NULL,
  COMPLETED_AT    TIMESTAMP,
  DUMP_FILE       VARCHAR2(500),
  TRANSFER_STATUS VARCHAR2(500),
  MESSAGE         CLOB,
  REQUESTED_BY    VARCHAR2(50),
  PARAMS_JSON     CLOB,
  CREATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL
);

COMMENT ON TABLE DATAPUMP_JOB_HISTORY IS
  'Audit trail for all Data Pump (EXPDP/IMPDP) jobs triggered from the DBA AI Control Center';


-- -----------------------------------------------------------------------
-- 4. Useful queries for the DBA
-- -----------------------------------------------------------------------

-- List all EXPDP templates
SELECT TEMPLATE_NAME, DATABASE_NAME, CREATED_BY, SCHEMAS_LIST, COMPRESSION, CREATED_AT
FROM DATAPUMP_EXPDP_TEMPLATES
ORDER BY CREATED_AT DESC;

-- List all IMPDP templates
SELECT TEMPLATE_NAME, DATABASE_NAME, CREATED_BY, SCHEMAS_LIST, TABLE_EXISTS_ACTION, DROP_USER, CREATED_AT
FROM DATAPUMP_IMPDP_TEMPLATES
ORDER BY CREATED_AT DESC;

-- Recent job history
SELECT JOB_ID, OPERATION, DATABASE_NAME, STATUS, DUMP_FILE,
       STARTED_AT, COMPLETED_AT,
       ROUND((CAST(COMPLETED_AT AS DATE) - CAST(STARTED_AT AS DATE)) * 24 * 60, 1) AS DURATION_MIN
FROM DATAPUMP_JOB_HISTORY
ORDER BY STARTED_AT DESC
FETCH FIRST 20 ROWS ONLY;
