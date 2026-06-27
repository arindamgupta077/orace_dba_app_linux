SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

--------------------------------------------------------------------------------
-- DB Inventory Management migration
-- Run as the application schema owner that owns APP_USERS.
--------------------------------------------------------------------------------

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_sequences WHERE sequence_name = 'DATABASE_INVENTORY_SEQ';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE database_inventory_seq START WITH 1 INCREMENT BY 1 NOCACHE';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_sequences WHERE sequence_name = 'DB_OWNER_MAPPING_SEQ';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE db_owner_mapping_seq START WITH 1 INCREMENT BY 1 NOCACHE';
  END IF;
END;
/

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tables WHERE table_name = 'DATABASE_INVENTORY';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
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
        created_at        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        created_by        VARCHAR2(128 CHAR),
        updated_by        VARCHAR2(128 CHAR)
      )
    ]';
  END IF;
END;
/

DECLARE
  v_count NUMBER;
  PROCEDURE add_column_if_missing(p_column_name VARCHAR2, p_column_sql VARCHAR2) IS
  BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM user_tab_columns
    WHERE table_name = 'DATABASE_INVENTORY'
      AND column_name = UPPER(p_column_name);

    IF v_count = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE database_inventory ADD (' || p_column_sql || ')';
    END IF;
  END;
BEGIN
  add_column_if_missing('id', 'id NUMBER');
  add_column_if_missing('database_name', 'database_name VARCHAR2(128 CHAR)');
  add_column_if_missing('environment', 'environment VARCHAR2(40 CHAR)');
  add_column_if_missing('server_name', 'server_name VARCHAR2(128 CHAR)');
  add_column_if_missing('server_ip', 'server_ip VARCHAR2(45 CHAR)');
  add_column_if_missing('zone', q'[zone VARCHAR2(10 CHAR) DEFAULT 'SZ1']');
  add_column_if_missing('location', 'location VARCHAR2(160 CHAR)');
  add_column_if_missing('operating_system', 'operating_system VARCHAR2(30 CHAR)');
  add_column_if_missing('database_role', q'[database_role VARCHAR2(30 CHAR) DEFAULT 'Primary']');
  add_column_if_missing('database_type', q'[database_type VARCHAR2(40 CHAR) DEFAULT 'Standalone']');
  add_column_if_missing('status', q'[status VARCHAR2(20 CHAR) DEFAULT 'healthy']');
  add_column_if_missing('environment_label', 'environment_label VARCHAR2(20 CHAR)');
  add_column_if_missing('owner_id', 'owner_id NUMBER');
  add_column_if_missing('created_at', 'created_at TIMESTAMP DEFAULT SYSTIMESTAMP');
  add_column_if_missing('updated_at', 'updated_at TIMESTAMP DEFAULT SYSTIMESTAMP');
  add_column_if_missing('created_by', 'created_by VARCHAR2(128 CHAR)');
  add_column_if_missing('updated_by', 'updated_by VARCHAR2(128 CHAR)');
END;
/

UPDATE database_inventory SET created_at = SYSTIMESTAMP WHERE created_at IS NULL;
UPDATE database_inventory SET updated_at = SYSTIMESTAMP WHERE updated_at IS NULL;
UPDATE database_inventory SET database_role = 'Primary' WHERE database_role IS NULL;
UPDATE database_inventory SET database_type = 'Standalone' WHERE database_type IS NULL;
UPDATE database_inventory SET status = 'healthy' WHERE status IS NULL;
UPDATE database_inventory SET zone = 'SZ1' WHERE zone IS NULL;

DECLARE
  PROCEDURE modify_ignore_existing(p_sql VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE != -1442 THEN
        RAISE;
      END IF;
  END;
BEGIN
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (id NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (database_name NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (environment NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (operating_system NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (zone NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (database_role NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (database_type NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (status NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (environment_label NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (owner_id NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (created_at NOT NULL)');
  modify_ignore_existing('ALTER TABLE database_inventory MODIFY (updated_at NOT NULL)');
END;
/

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tables WHERE table_name = 'DB_OWNER_MAPPING';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE db_owner_mapping (
        id          NUMBER NOT NULL,
        owner_id    NUMBER NOT NULL,
        database_id NUMBER NOT NULL,
        assigned_by VARCHAR2(128 CHAR),
        assigned_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        is_active   CHAR(1 CHAR) DEFAULT 'Y' NOT NULL
      )
    ]';
  END IF;
END;
/

DECLARE
  v_count NUMBER;
  PROCEDURE add_column_if_missing(p_column_name VARCHAR2, p_column_sql VARCHAR2) IS
  BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM user_tab_columns
    WHERE table_name = 'DB_OWNER_MAPPING'
      AND column_name = UPPER(p_column_name);

    IF v_count = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE db_owner_mapping ADD (' || p_column_sql || ')';
    END IF;
  END;
BEGIN
  add_column_if_missing('id', 'id NUMBER');
  add_column_if_missing('owner_id', 'owner_id NUMBER');
  add_column_if_missing('database_id', 'database_id NUMBER');
  add_column_if_missing('assigned_by', 'assigned_by VARCHAR2(128 CHAR)');
  add_column_if_missing('assigned_at', 'assigned_at TIMESTAMP DEFAULT SYSTIMESTAMP');
  add_column_if_missing('is_active', q'[is_active CHAR(1 CHAR) DEFAULT 'Y']');
END;
/

UPDATE db_owner_mapping SET assigned_at = SYSTIMESTAMP WHERE assigned_at IS NULL;
UPDATE db_owner_mapping SET is_active = 'Y' WHERE is_active IS NULL;

DECLARE
  PROCEDURE modify_ignore_existing(p_sql VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE != -1442 THEN
        RAISE;
      END IF;
  END;
BEGIN
  modify_ignore_existing('ALTER TABLE db_owner_mapping MODIFY (id NOT NULL)');
  modify_ignore_existing('ALTER TABLE db_owner_mapping MODIFY (owner_id NOT NULL)');
  modify_ignore_existing('ALTER TABLE db_owner_mapping MODIFY (database_id NOT NULL)');
  modify_ignore_existing('ALTER TABLE db_owner_mapping MODIFY (assigned_at NOT NULL)');
  modify_ignore_existing('ALTER TABLE db_owner_mapping MODIFY (is_active NOT NULL)');
END;
/

DECLARE
  PROCEDURE add_constraint_ignore_exists(p_sql VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE NOT IN (-2260, -2261, -2264, -2275) THEN
        RAISE;
      END IF;
  END;
BEGIN
  -- Drop existing status, env_label, and location check constraints to allow updating checks
  DECLARE
    PROCEDURE drop_constraint_if_exists(p_table VARCHAR2, p_constraint VARCHAR2) IS
    BEGIN
      EXECUTE IMMEDIATE 'ALTER TABLE ' || p_table || ' DROP CONSTRAINT ' || p_constraint;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -2443 THEN
          RAISE;
        END IF;
    END;
  BEGIN
    drop_constraint_if_exists('database_inventory', 'ck_db_inventory_status');
    drop_constraint_if_exists('database_inventory', 'ck_db_inventory_env_label');
    drop_constraint_if_exists('database_inventory', 'ck_db_inventory_location');
    drop_constraint_if_exists('database_inventory', 'ck_db_inventory_zone');
  END;

  -- Set default active status for rows matching old statuses (for upgrade safety)
  EXECUTE IMMEDIATE q'[UPDATE database_inventory SET status = 'active' WHERE status NOT IN ('active', 'inactive', 'decomissioned')]';
  EXECUTE IMMEDIATE q'[UPDATE database_inventory SET environment_label = 'DEV' WHERE environment_label NOT IN ('PROD', 'DEV', 'UAT', 'DR')]';
  EXECUTE IMMEDIATE q'[UPDATE database_inventory SET location = 'SDC' WHERE location NOT IN ('SDC', 'KDC') OR location IS NULL]';
  EXECUTE IMMEDIATE q'[UPDATE database_inventory SET zone = 'SZ1' WHERE zone NOT IN ('SZ1', 'SZ2', 'LAN') OR zone IS NULL]';
  COMMIT;

  add_constraint_ignore_exists('ALTER TABLE database_inventory ADD CONSTRAINT pk_database_inventory PRIMARY KEY (id)');
  add_constraint_ignore_exists('ALTER TABLE database_inventory ADD CONSTRAINT fk_db_inventory_owner FOREIGN KEY (owner_id) REFERENCES app_users (user_id)');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_os CHECK (operating_system IN ('Linux', 'Windows'))]');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_role CHECK (database_role IN ('Primary', 'Standby', 'Reporting'))]');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_type CHECK (database_type IN ('Standalone', 'RAC', 'Dataguard', 'Active Dataguard'))]');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_status CHECK (status IN ('active', 'inactive', 'decomissioned'))]');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_env_label CHECK (environment_label IN ('PROD', 'DEV', 'UAT', 'DR'))]');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_location CHECK (location IN ('SDC', 'KDC'))]');
  add_constraint_ignore_exists(q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_zone CHECK (zone IN ('SZ1', 'SZ2', 'LAN'))]');

  add_constraint_ignore_exists('ALTER TABLE db_owner_mapping ADD CONSTRAINT pk_db_owner_mapping PRIMARY KEY (id)');
  add_constraint_ignore_exists('ALTER TABLE db_owner_mapping ADD CONSTRAINT fk_db_owner_mapping_owner FOREIGN KEY (owner_id) REFERENCES app_users (user_id)');
  add_constraint_ignore_exists('ALTER TABLE db_owner_mapping ADD CONSTRAINT fk_db_owner_mapping_database FOREIGN KEY (database_id) REFERENCES database_inventory (id) ON DELETE CASCADE');
  add_constraint_ignore_exists(q'[ALTER TABLE db_owner_mapping ADD CONSTRAINT ck_db_owner_mapping_active CHECK (is_active IN ('Y', 'N'))]');
END;
/

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'UX_DATABASE_INVENTORY_NAME';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX ux_database_inventory_name ON database_inventory (UPPER(database_name))';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_DB_INVENTORY_OWNER';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_db_inventory_owner ON database_inventory (owner_id)';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_DB_INVENTORY_STATUS';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_db_inventory_status ON database_inventory (status)';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_DB_OWNER_MAPPING_OWNER';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_db_owner_mapping_owner ON db_owner_mapping (owner_id)';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'IX_DB_OWNER_MAPPING_DB';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX ix_db_owner_mapping_db ON db_owner_mapping (database_id)';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes WHERE index_name = 'UX_DB_OWNER_MAPPING_ACTIVE';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE UNIQUE INDEX ux_db_owner_mapping_active
      ON db_owner_mapping (
        CASE WHEN is_active = 'Y' THEN database_id END
      )
    ]';
  END IF;
END;
/

CREATE OR REPLACE TRIGGER trg_database_inventory_biu
BEFORE INSERT OR UPDATE ON database_inventory
FOR EACH ROW
BEGIN
  IF INSERTING THEN
    IF :NEW.id IS NULL THEN
      :NEW.id := database_inventory_seq.NEXTVAL;
    END IF;
    IF :NEW.created_at IS NULL THEN
      :NEW.created_at := SYSTIMESTAMP;
    END IF;
  END IF;

  :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_db_owner_mapping_bi
BEFORE INSERT ON db_owner_mapping
FOR EACH ROW
BEGIN
  IF :NEW.id IS NULL THEN
    :NEW.id := db_owner_mapping_seq.NEXTVAL;
  END IF;
  IF :NEW.assigned_at IS NULL THEN
    :NEW.assigned_at := SYSTIMESTAMP;
  END IF;
  IF :NEW.is_active IS NULL THEN
    :NEW.is_active := 'Y';
  END IF;
END;
/

COMMIT;

PROMPT DB Inventory migration complete.
PROMPT Add databases from the DB Inventory admin page and assign each one to an active client user.
