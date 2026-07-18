SET DEFINE OFF;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

-- Run as the schema owner after the original DB inventory and user-preferences scripts.
DECLARE
  v_count NUMBER;
  PROCEDURE add_column_if_missing(p_table VARCHAR2, p_column VARCHAR2, p_definition VARCHAR2) IS
  BEGIN
    SELECT COUNT(*) INTO v_count FROM user_tab_columns
    WHERE table_name = UPPER(p_table) AND column_name = UPPER(p_column);
    IF v_count = 0 THEN
      EXECUTE IMMEDIATE 'ALTER TABLE ' || p_table || ' ADD (' || p_definition || ')';
    END IF;
  END;
BEGIN
  add_column_if_missing('DATABASE_INVENTORY', 'DATABASE_INSTANCE', 'database_instance VARCHAR2(512 CHAR)');
  add_column_if_missing('DATABASE_INVENTORY', 'ENABLE_ACCESS', q'[enable_access CHAR(1 CHAR) DEFAULT 'Y']');
  add_column_if_missing('APP_USER_PREFERENCES', 'DB_INVENTORY_COLUMNS', 'db_inventory_columns CLOB');
END;
/

UPDATE database_inventory SET enable_access = 'Y'
WHERE enable_access IS NULL OR enable_access NOT IN ('Y', 'N');

ALTER TABLE database_inventory MODIFY (enable_access DEFAULT 'Y' NOT NULL);

DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_constraints
  WHERE table_name = 'DATABASE_INVENTORY' AND constraint_name = 'CK_DB_INVENTORY_TYPE';
  IF v_count > 0 THEN EXECUTE IMMEDIATE 'ALTER TABLE database_inventory DROP CONSTRAINT ck_db_inventory_type'; END IF;
  SELECT COUNT(*) INTO v_count FROM user_constraints
  WHERE table_name = 'DATABASE_INVENTORY' AND constraint_name = 'CK_DB_INVENTORY_ENABLE_ACCESS';
  IF v_count > 0 THEN EXECUTE IMMEDIATE 'ALTER TABLE database_inventory DROP CONSTRAINT ck_db_inventory_enable_access'; END IF;
  EXECUTE IMMEDIATE q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_type CHECK (database_type IN ('Standalone', 'RAC', 'Dataguard', 'Active Dataguard', 'RAC & Datagaurd'))]';
  EXECUTE IMMEDIATE q'[ALTER TABLE database_inventory ADD CONSTRAINT ck_db_inventory_enable_access CHECK (enable_access IN ('Y', 'N'))]';
END;
/

COMMIT;
PROMPT Database inventory access and preferences migration complete.
