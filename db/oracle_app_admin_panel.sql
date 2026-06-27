SET DEFINE ON;
WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

--------------------------------------------------------------------------------
-- Admin Panel migration
-- Run as the application schema owner that owns APP_USERS.
--------------------------------------------------------------------------------

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE app_users DROP CONSTRAINT app_users_role_ck';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2443 THEN
      RAISE;
    END IF;
END;
/

ALTER TABLE app_users MODIFY (role DEFAULT 'client');

UPDATE app_users
SET role = CASE role
  WHEN 'admin' THEN 'app_admin'
  WHEN 'operator' THEN 'client'
  ELSE role
END
WHERE role IN ('admin', 'operator');

ALTER TABLE app_users ADD CONSTRAINT app_users_role_ck
  CHECK (role IN ('app_admin', 'dba_admin', 'client', 'auditor'));

DECLARE
  v_column_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_column_count
  FROM user_tab_columns
  WHERE table_name = 'APP_USERS'
    AND column_name = 'MUST_CHANGE_PASSWORD';

  IF v_column_count = 0 THEN
    EXECUTE IMMEDIATE q'[ALTER TABLE app_users ADD (must_change_password CHAR(1) DEFAULT 'N' NOT NULL)]';
  END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE app_users DROP CONSTRAINT app_users_must_change_pw_ck';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2443 THEN
      RAISE;
    END IF;
END;
/

ALTER TABLE app_users ADD CONSTRAINT app_users_must_change_pw_ck
  CHECK (must_change_password IN ('Y', 'N'));

--------------------------------------------------------------------------------
-- Bootstrap requested admin user.
-- Replace the value prompted for INITIAL_PASSWORD when SQL*Plus asks for it.
--------------------------------------------------------------------------------

ACCEPT initial_password CHAR PROMPT 'Initial password for jasonroy908@gmail.com: ' HIDE

MERGE INTO app_users dst
USING (
  SELECT
    'JSON ROY' AS username,
    'jasonroy908@gmail.com' AS email,
    LOWER(RAWTOHEX(SYS_GUID())) AS salt_value,
    '&initial_password' AS initial_password
  FROM dual
) src
ON (LOWER(dst.email) = src.email)
WHEN MATCHED THEN
  UPDATE SET
    dst.username = src.username,
    dst.password_salt = src.salt_value,
    dst.password_hash = LOWER(RAWTOHEX(STANDARD_HASH(src.salt_value || ':' || src.initial_password, 'SHA256'))),
    dst.api_token_hash = NULL,
    dst.role = 'app_admin',
    dst.is_active = 'Y',
    dst.must_change_password = 'Y',
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
    must_change_password,
    failed_login_count
  )
  VALUES (
    src.username,
    src.email,
    src.salt_value,
    LOWER(RAWTOHEX(STANDARD_HASH(src.salt_value || ':' || src.initial_password, 'SHA256'))),
    NULL,
    'app_admin',
    'Y',
    'Y',
    0
  );

COMMIT;

PROMPT Admin Panel migration complete.
