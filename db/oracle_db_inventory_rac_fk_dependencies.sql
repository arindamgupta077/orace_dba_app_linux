SET PAGESIZE 200
SET LINESIZE 240

-- Read-only diagnostic. Run as APP_DBA and send the result back before
-- removing UQ_DB_INVENTORY_NAME_CIS. It identifies every child foreign key
-- that currently depends on the name-only parent key.

COLUMN child_columns FORMAT A80
COLUMN parent_columns FORMAT A80

SELECT
  fk.table_name AS child_table,
  fk.constraint_name AS child_foreign_key,
  fk.status,
  LISTAGG(fkc.column_name, ', ') WITHIN GROUP (ORDER BY fkc.position) AS child_columns,
  parent.constraint_name AS parent_key,
  LISTAGG(pkc.column_name, ', ') WITHIN GROUP (ORDER BY pkc.position) AS parent_columns
FROM user_constraints fk
JOIN user_constraints parent
  ON parent.constraint_name = fk.r_constraint_name
JOIN user_cons_columns fkc
  ON fkc.constraint_name = fk.constraint_name
JOIN user_cons_columns pkc
  ON pkc.constraint_name = parent.constraint_name
 AND pkc.position = fkc.position
WHERE fk.constraint_type = 'R'
  AND parent.table_name = 'DATABASE_INVENTORY'
  AND parent.constraint_name = 'UQ_DB_INVENTORY_NAME_CIS'
GROUP BY fk.table_name, fk.constraint_name, fk.status, parent.constraint_name
ORDER BY fk.table_name, fk.constraint_name;

-- Also show the parent-key definition for confirmation.
SELECT constraint_name, constraint_type, status, validated
FROM user_constraints
WHERE table_name = 'DATABASE_INVENTORY'
  AND constraint_name = 'UQ_DB_INVENTORY_NAME_CIS';
