SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

-- Run this after oracle_db_inventory_access_and_preferences.sql.
-- A RAC instance is one DATABASE_INVENTORY row. Database name + instance
-- name must be unique, while the same database name can occur for other nodes.
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tab_columns
  WHERE table_name = 'DATABASE_INVENTORY' AND column_name = 'DATABASE_INSTANCE';
  IF v_count = 0 THEN
    RAISE_APPLICATION_ERROR(-20001, 'DATABASE_INSTANCE is missing. Run oracle_db_inventory_access_and_preferences.sql first.');
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes
  WHERE index_name = 'UX_DATABASE_INVENTORY_NAME';
  IF v_count > 0 THEN
    EXECUTE IMMEDIATE 'DROP INDEX ux_database_inventory_name';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_indexes
  WHERE index_name = 'UX_DATABASE_INVENTORY_NAME_INSTANCE';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX ux_database_inventory_name_instance ON database_inventory (UPPER(database_name), UPPER(database_instance))';
  END IF;
END;
/

COMMIT;
PROMPT RAC instance uniqueness migration complete.
