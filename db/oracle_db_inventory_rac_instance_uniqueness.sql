SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

-- Run this after oracle_db_inventory_access_and_preferences.sql.
-- A RAC instance is one DATABASE_INVENTORY row. Database name + instance
-- name must be unique, while the same database name can occur for other nodes.

-- DATABASE_INVENTORY can no longer be the parent for a name-only foreign key
-- once it contains multiple RAC rows. APP_DATABASE_CATALOG holds one logical
-- row per database name and becomes the stable parent for schedules.
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tables WHERE table_name = 'APP_DATABASE_CATALOG';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_database_catalog (
        database_name VARCHAR2(128 CHAR) NOT NULL,
        created_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT pk_app_database_catalog PRIMARY KEY (database_name)
      )
    ]';
  END IF;
END;
/

MERGE INTO app_database_catalog catalog
USING (SELECT DISTINCT database_name FROM database_inventory) inventory
ON (catalog.database_name = inventory.database_name)
WHEN NOT MATCHED THEN
  INSERT (database_name) VALUES (inventory.database_name);
/

CREATE OR REPLACE TRIGGER trg_database_inventory_catalog_biu
BEFORE INSERT OR UPDATE OF database_name ON database_inventory
FOR EACH ROW
BEGIN
  MERGE INTO app_database_catalog catalog
  USING (SELECT :NEW.database_name AS database_name FROM dual) inventory
  ON (catalog.database_name = inventory.database_name)
  WHEN NOT MATCHED THEN
    INSERT (database_name) VALUES (inventory.database_name);
END;
/

DECLARE
  v_count NUMBER;
  PROCEDURE drop_constraint_if_exists(p_constraint_name VARCHAR2) IS
  BEGIN
    SELECT COUNT(*) INTO v_count FROM user_constraints
    WHERE table_name = 'DATABASE_INVENTORY' AND constraint_name = UPPER(p_constraint_name);
    IF v_count > 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE database_inventory DROP CONSTRAINT ' || p_constraint_name;
    END IF;
  END;

  PROCEDURE drop_index_if_exists(p_index_name VARCHAR2) IS
  BEGIN
    SELECT COUNT(*) INTO v_count FROM user_indexes
    WHERE table_name = 'DATABASE_INVENTORY' AND index_name = UPPER(p_index_name);
    IF v_count > 0 THEN
      EXECUTE IMMEDIATE 'DROP INDEX ' || p_index_name;
    END IF;
  END;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tab_columns
  WHERE table_name = 'DATABASE_INVENTORY' AND column_name = 'DATABASE_INSTANCE';
  IF v_count = 0 THEN
    RAISE_APPLICATION_ERROR(-20001, 'DATABASE_INSTANCE is missing. Run oracle_db_inventory_access_and_preferences.sql first.');
  END IF;

  -- Re-parent the only dependent foreign key identified by the diagnostic.
  -- This retains schedule data and its database-name validation.
  SELECT COUNT(*) INTO v_count FROM user_constraints
  WHERE table_name = 'APP_DASHBOARD_SCHEDULES'
    AND constraint_name = 'FK_DASH_SCHED_DB_INV';
  IF v_count > 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_dashboard_schedules DROP CONSTRAINT fk_dash_sched_db_inv';
  END IF;

  -- Legacy installations used either of these name-only uniqueness rules.
  -- Remove the constraint first (it may own its index), then any free index.
  drop_constraint_if_exists('UX_DATABASE_INVENTORY_NAME');
  drop_constraint_if_exists('UQ_DB_INVENTORY_NAME_CIS');
  drop_index_if_exists('UX_DATABASE_INVENTORY_NAME');
  drop_index_if_exists('UQ_DB_INVENTORY_NAME_CIS');

  SELECT COUNT(*) INTO v_count FROM user_indexes
  WHERE index_name = 'UX_DATABASE_INVENTORY_NAME_INSTANCE';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX ux_database_inventory_name_instance ON database_inventory (UPPER(database_name), UPPER(database_instance))';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_constraints
  WHERE table_name = 'DATABASE_INVENTORY'
    AND constraint_name = 'FK_DB_INVENTORY_CATALOG';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE database_inventory ADD CONSTRAINT fk_db_inventory_catalog FOREIGN KEY (database_name) REFERENCES app_database_catalog(database_name)';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_constraints
  WHERE table_name = 'APP_DASHBOARD_SCHEDULES'
    AND constraint_name = 'FK_DASH_SCHED_DB_CATALOG';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_dashboard_schedules ADD CONSTRAINT fk_dash_sched_db_catalog FOREIGN KEY (db_name) REFERENCES app_database_catalog(database_name)';
  END IF;
END;
/

-- Verification: only UX_DATABASE_INVENTORY_NAME_INSTANCE should remain from
-- the three listed names before adding another RAC node.
SELECT index_name, uniqueness
FROM user_indexes
WHERE table_name = 'DATABASE_INVENTORY'
  AND index_name IN ('UX_DATABASE_INVENTORY_NAME', 'UQ_DB_INVENTORY_NAME_CIS', 'UX_DATABASE_INVENTORY_NAME_INSTANCE')
ORDER BY index_name;

COMMIT;
PROMPT RAC instance and dashboard schedule migration complete.
