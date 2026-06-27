SET DEFINE OFF;

PROMPT Dropping existing password reset objects (if any)...

--------------------------------------------------------------------------------
-- 0) Drop existing objects in reverse dependency order
--    Each block silently ignores "object does not exist" errors so the script
--    works on a fresh schema as well as on re-runs.
--------------------------------------------------------------------------------

-- Drop the PL/SQL package (spec + body)
BEGIN
  EXECUTE IMMEDIATE 'DROP PACKAGE app_auth_reset_pkg';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -4043 THEN RAISE; END IF;   -- ORA-04043: object does not exist
END;
/

-- Drop reset tables (CASCADE CONSTRAINTS removes FK references)
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE app_password_resets CASCADE CONSTRAINTS';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -942 THEN RAISE; END IF;    -- ORA-00942: table does not exist
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE app_password_reset_attempts CASCADE CONSTRAINTS';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -942 THEN RAISE; END IF;
END;
/

-- Drop constraints this script adds to app_users
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE app_users DROP CONSTRAINT app_users_username_upper_ck';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2443 AND SQLCODE != -942 THEN RAISE; END IF;  -- constraint/table not found
END;
/

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE app_users DROP CONSTRAINT app_users_email_lower_ck';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2443 AND SQLCODE != -942 THEN RAISE; END IF;
END;
/

-- Drop the unique email index this script adds to app_users
BEGIN
  EXECUTE IMMEDIATE 'DROP INDEX app_users_email_luk';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1418 THEN RAISE; END IF;   -- ORA-01418: index does not exist
END;
/

-- Drop the email column this script adds to app_users (optional — remove if you
-- want to preserve existing email data across re-runs)
-- BEGIN
--   EXECUTE IMMEDIATE 'ALTER TABLE app_users DROP COLUMN email';
-- EXCEPTION
--   WHEN OTHERS THEN
--     IF SQLCODE != -904 THEN RAISE; END IF;   -- ORA-00904: column does not exist
-- END;
-- /

PROMPT Drop phase complete.

WHENEVER SQLERROR EXIT FAILURE ROLLBACK;

PROMPT Installing secure password reset schema and PL/SQL package...

--------------------------------------------------------------------------------
-- 1) app_users email migration
--------------------------------------------------------------------------------

DECLARE
  v_column_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_column_count
  FROM user_tab_columns
  WHERE table_name = 'APP_USERS'
    AND column_name = 'EMAIL';

  IF v_column_count = 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_users ADD (email VARCHAR2(320))';
  END IF;
END;
/

DECLARE
  v_duplicate_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_duplicate_count
  FROM (
    SELECT UPPER(TRIM(username)) AS normalized_username
    FROM app_users
    GROUP BY UPPER(TRIM(username))
    HAVING COUNT(*) > 1
  );

  IF v_duplicate_count > 0 THEN
    RAISE_APPLICATION_ERROR(
      -20001,
      'Duplicate usernames would exist after upper-case normalization. Resolve duplicates before running this migration.'
    );
  END IF;

  SELECT COUNT(*)
  INTO v_duplicate_count
  FROM (
    SELECT LOWER(TRIM(NVL(email, username))) AS normalized_email
    FROM app_users
    GROUP BY LOWER(TRIM(NVL(email, username)))
    HAVING COUNT(*) > 1
  );

  IF v_duplicate_count > 0 THEN
    RAISE_APPLICATION_ERROR(
      -20002,
      'Duplicate email values would exist after lower-case normalization. Resolve duplicates before running this migration.'
    );
  END IF;
END;
/

UPDATE app_users
SET username = UPPER(TRIM(username)),
    email = LOWER(TRIM(NVL(email, username))),
    updated_at = SYSTIMESTAMP
WHERE username <> UPPER(TRIM(username))
   OR email IS NULL
   OR email <> LOWER(TRIM(email));
DECLARE
  v_nullable VARCHAR2(1);
BEGIN
  SELECT nullable
  INTO v_nullable
  FROM user_tab_columns
  WHERE table_name = 'APP_USERS'
    AND column_name = 'EMAIL';

  IF v_nullable = 'Y' THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_users MODIFY (email NOT NULL)';
  END IF;
END;
/

DECLARE
  v_constraint_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_constraint_count
  FROM user_constraints
  WHERE table_name = 'APP_USERS'
    AND constraint_name = 'APP_USERS_USERNAME_UPPER_CK';

  IF v_constraint_count = 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_users ADD CONSTRAINT app_users_username_upper_ck CHECK (username = UPPER(TRIM(username)))';
  END IF;
END;
/

DECLARE
  v_constraint_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_constraint_count
  FROM user_constraints
  WHERE table_name = 'APP_USERS'
    AND constraint_name = 'APP_USERS_EMAIL_LOWER_CK';

  IF v_constraint_count = 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE app_users ADD CONSTRAINT app_users_email_lower_ck CHECK (email = LOWER(TRIM(email)))';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_index_count
  FROM user_indexes
  WHERE index_name = 'APP_USERS_EMAIL_LUK';

  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX app_users_email_luk ON app_users (LOWER(email))';
  END IF;
END;
/

--------------------------------------------------------------------------------
-- 2) Rate-limit/audit attempt log. This records every forgot-password request,
-- including unknown emails, without storing any reset token.
--------------------------------------------------------------------------------

DECLARE
  v_table_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_table_count
  FROM user_tables
  WHERE table_name = 'APP_PASSWORD_RESET_ATTEMPTS';

  IF v_table_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_password_reset_attempts (
        attempt_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
        requested_email VARCHAR2(320) NOT NULL,
        request_ip VARCHAR2(64),
        user_agent VARCHAR2(512),
        accepted CHAR(1) DEFAULT 'N' NOT NULL,
        created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT app_password_reset_attempts_pk PRIMARY KEY (attempt_id),
        CONSTRAINT app_password_reset_attempts_acc_ck CHECK (accepted IN ('Y', 'N')),
        CONSTRAINT app_password_reset_attempts_email_ck CHECK (requested_email = LOWER(TRIM(requested_email)))
      )
    ]';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_PW_RESET_ATT_EMAIL_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_pw_reset_att_email_ix ON app_password_reset_attempts (requested_email, created_at)';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_PW_RESET_ATT_IP_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_pw_reset_att_ip_ix ON app_password_reset_attempts (request_ip, created_at)';
  END IF;
END;
/

--------------------------------------------------------------------------------
-- 3) Reset token table. Only SHA-256 token hashes are stored.
--------------------------------------------------------------------------------

DECLARE
  v_table_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_table_count
  FROM user_tables
  WHERE table_name = 'APP_PASSWORD_RESETS';

  IF v_table_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_password_resets (
        reset_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
        user_id NUMBER NOT NULL,
        token_hash VARCHAR2(64) NOT NULL,
        requested_email VARCHAR2(320) NOT NULL,
        request_ip VARCHAR2(64),
        user_agent VARCHAR2(512),
        expires_at TIMESTAMP(6) NOT NULL,
        used_at TIMESTAMP(6),
        created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT app_password_resets_pk PRIMARY KEY (reset_id),
        CONSTRAINT app_password_resets_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id),
        CONSTRAINT app_password_resets_token_ck CHECK (REGEXP_LIKE(token_hash, '^[0-9a-f]{64}$')),
        CONSTRAINT app_password_resets_email_ck CHECK (requested_email = LOWER(TRIM(requested_email)))
      )
    ]';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_PASSWORD_RESETS_TOKEN_UK';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX app_password_resets_token_uk ON app_password_resets (token_hash)';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_PASSWORD_RESETS_USER_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_password_resets_user_ix ON app_password_resets (user_id, used_at, expires_at)';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_PASSWORD_RESETS_EMAIL_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_password_resets_email_ix ON app_password_resets (requested_email, created_at)';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_PASSWORD_RESETS_EXP_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_password_resets_exp_ix ON app_password_resets (expires_at)';
  END IF;
END;
/

--------------------------------------------------------------------------------
-- 4) Audit table fallback. The full application schema already creates this
-- table, but this keeps the reset package installable in lean auth-only schemas.
--------------------------------------------------------------------------------

DECLARE
  v_table_count NUMBER;
BEGIN
  SELECT COUNT(*)
  INTO v_table_count
  FROM user_tables
  WHERE table_name = 'APP_AUDIT_LOGS';

  IF v_table_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE app_audit_logs (
        audit_id NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY,
        user_id NUMBER,
        actor VARCHAR2(128) NOT NULL,
        action VARCHAR2(64) NOT NULL,
        db_name VARCHAR2(64),
        status VARCHAR2(32) NOT NULL,
        detail CLOB,
        metadata_json CLOB,
        created_at TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT app_audit_logs_pk PRIMARY KEY (audit_id),
        CONSTRAINT app_audit_logs_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id)
      )
    ]';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_AUDIT_LOGS_CREATED_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_audit_logs_created_ix ON app_audit_logs (created_at)';
  END IF;
END;
/

DECLARE
  v_index_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_index_count FROM user_indexes WHERE index_name = 'APP_AUDIT_LOGS_ACTOR_IX';
  IF v_index_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX app_audit_logs_actor_ix ON app_audit_logs (actor)';
  END IF;
END;
/

--------------------------------------------------------------------------------
-- 5) PL/SQL package. n8n generates the raw token and password hash, then calls
-- this package to do all Oracle state changes atomically.
--------------------------------------------------------------------------------

CREATE OR REPLACE PACKAGE app_auth_reset_pkg AS
  c_generic_forgot_message CONSTANT VARCHAR2(200) := 'If the email exists, a reset link has been sent.';
  c_reset_success_message  CONSTANT VARCHAR2(200) := 'Password reset successful. You can now login.';
  c_reset_failure_message  CONSTANT VARCHAR2(200) := 'Invalid or expired reset link.';

  PROCEDURE request_password_reset(
    p_email IN VARCHAR2,
    p_token_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2,
    p_user_id OUT NUMBER,
    p_username OUT VARCHAR2,
    p_normalized_email OUT VARCHAR2,
    p_should_send OUT NUMBER
  );

  PROCEDURE reset_password(
    p_token_hash IN VARCHAR2,
    p_new_salt IN VARCHAR2,
    p_new_password_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2,
    p_success OUT NUMBER,
    p_message OUT VARCHAR2
  );

  FUNCTION request_password_reset_json(
    p_email IN VARCHAR2,
    p_token_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2
  ) RETURN CLOB;

  FUNCTION reset_password_json(
    p_token_hash IN VARCHAR2,
    p_new_salt IN VARCHAR2,
    p_new_password_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2
  ) RETURN CLOB;
END app_auth_reset_pkg;
/

CREATE OR REPLACE PACKAGE BODY app_auth_reset_pkg AS
  c_expiry_minutes       CONSTANT PLS_INTEGER := 15;
  c_email_limit          CONSTANT PLS_INTEGER := 3;
  c_ip_limit             CONSTANT PLS_INTEGER := 20;
  c_rate_window_minutes  CONSTANT PLS_INTEGER := 15;

  FUNCTION normalize_email(p_email IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN LOWER(TRIM(p_email));
  END normalize_email;

  FUNCTION escape_json_str(p_str IN VARCHAR2) RETURN VARCHAR2 IS
    v_out VARCHAR2(4000);
  BEGIN
    IF p_str IS NULL THEN RETURN 'null'; END IF;
    v_out := REPLACE(p_str, '\', '\\');
    v_out := REPLACE(v_out, '"', '\"');
    v_out := REPLACE(v_out, CHR(10), '\n');
    v_out := REPLACE(v_out, CHR(13), '\r');
    v_out := REPLACE(v_out, CHR(9), '\t');
    RETURN '"' || v_out || '"';
  END escape_json_str;

  PROCEDURE write_audit(
    p_user_id IN NUMBER,
    p_actor IN VARCHAR2,
    p_action IN VARCHAR2,
    p_status IN VARCHAR2,
    p_detail IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2
  ) IS
    v_metadata VARCHAR2(4000);
  BEGIN
    v_metadata := '{"request_ip":' || escape_json_str(SUBSTR(NVL(p_request_ip, 'unknown'), 1, 64))
      || ',"user_agent":' || escape_json_str(SUBSTR(NVL(p_user_agent, 'unknown'), 1, 512)) || '}';

    INSERT INTO app_audit_logs (
      user_id,
      actor,
      action,
      status,
      detail,
      metadata_json
    ) VALUES (
      p_user_id,
      SUBSTR(NVL(p_actor, 'password-reset'), 1, 128),
      SUBSTR(p_action, 1, 64),
      SUBSTR(p_status, 1, 32),
      p_detail,
      v_metadata
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END write_audit;

  PROCEDURE request_password_reset(
    p_email IN VARCHAR2,
    p_token_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2,
    p_user_id OUT NUMBER,
    p_username OUT VARCHAR2,
    p_normalized_email OUT VARCHAR2,
    p_should_send OUT NUMBER
  ) IS
    v_now TIMESTAMP(6) := CAST(SYSTIMESTAMP AS TIMESTAMP);
    v_email VARCHAR2(320) := normalize_email(p_email);
    v_token_hash VARCHAR2(64) := LOWER(TRIM(p_token_hash));
    v_user_id NUMBER;
    v_username VARCHAR2(128);
    v_email_count NUMBER := 0;
    v_ip_count NUMBER := 0;
    v_attempt_id NUMBER;
  BEGIN
    p_user_id := NULL;
    p_username := NULL;
    p_normalized_email := v_email;
    p_should_send := 0;

    IF v_email IS NULL OR LENGTH(v_email) > 320 OR
       NOT REGEXP_LIKE(v_token_hash, '^[0-9a-f]{64}$') THEN
      write_audit(NULL, v_email, 'password_reset_request', 'rejected', 'Invalid forgot-password payload.', p_request_ip, p_user_agent);
      COMMIT;
      RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_email_count
    FROM app_password_reset_attempts
    WHERE requested_email = v_email
      AND created_at > v_now - NUMTODSINTERVAL(c_rate_window_minutes, 'MINUTE');

    IF p_request_ip IS NOT NULL THEN
      SELECT COUNT(*)
      INTO v_ip_count
      FROM app_password_reset_attempts
      WHERE request_ip = SUBSTR(p_request_ip, 1, 64)
        AND created_at > v_now - NUMTODSINTERVAL(c_rate_window_minutes, 'MINUTE');
    END IF;

    INSERT INTO app_password_reset_attempts (
      requested_email,
      request_ip,
      user_agent,
      accepted,
      created_at
    ) VALUES (
      v_email,
      SUBSTR(p_request_ip, 1, 64),
      SUBSTR(p_user_agent, 1, 512),
      'N',
      v_now
    ) RETURNING attempt_id INTO v_attempt_id;

    IF v_email_count >= c_email_limit OR v_ip_count >= c_ip_limit THEN
      write_audit(NULL, v_email, 'password_reset_request', 'rate_limited', 'Password reset request rate-limited.', p_request_ip, p_user_agent);
      COMMIT;
      RETURN;
    END IF;

    BEGIN
      SELECT user_id, username
      INTO v_user_id, v_username
      FROM app_users
      WHERE email = v_email
        AND is_active = 'Y'
      FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        write_audit(NULL, v_email, 'password_reset_request', 'accepted', 'Forgot-password request accepted for generic response.', p_request_ip, p_user_agent);
        COMMIT;
        RETURN;
    END;

    UPDATE app_password_resets
    SET used_at = v_now
    WHERE user_id = v_user_id
      AND used_at IS NULL;

    INSERT INTO app_password_resets (
      user_id,
      token_hash,
      requested_email,
      request_ip,
      user_agent,
      expires_at,
      created_at
    ) VALUES (
      v_user_id,
      v_token_hash,
      v_email,
      SUBSTR(p_request_ip, 1, 64),
      SUBSTR(p_user_agent, 1, 512),
      v_now + NUMTODSINTERVAL(c_expiry_minutes, 'MINUTE'),
      v_now
    );

    UPDATE app_password_reset_attempts
    SET accepted = 'Y'
    WHERE attempt_id = v_attempt_id;

    write_audit(v_user_id, v_username, 'password_reset_request', 'accepted', 'Password reset token issued.', p_request_ip, p_user_agent);

    p_user_id := v_user_id;
    p_username := v_username;
    p_normalized_email := v_email;
    p_should_send := 1;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END request_password_reset;

  PROCEDURE reset_password(
    p_token_hash IN VARCHAR2,
    p_new_salt IN VARCHAR2,
    p_new_password_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2,
    p_success OUT NUMBER,
    p_message OUT VARCHAR2
  ) IS
    v_now TIMESTAMP(6) := CAST(SYSTIMESTAMP AS TIMESTAMP);
    v_token_hash VARCHAR2(64) := LOWER(TRIM(p_token_hash));
    v_new_salt VARCHAR2(128) := TRIM(p_new_salt);
    v_new_password_hash VARCHAR2(64) := LOWER(TRIM(p_new_password_hash));
    v_sessions_table_count NUMBER := 0;
    v_reset_id NUMBER;
    v_user_id NUMBER;
    v_expires_at TIMESTAMP(6);
    v_used_at TIMESTAMP(6);
    v_username VARCHAR2(128);
  BEGIN
    p_success := 0;
    p_message := c_reset_failure_message;

    IF NOT REGEXP_LIKE(v_token_hash, '^[0-9a-f]{64}$') OR
       v_new_salt IS NULL OR LENGTH(v_new_salt) > 128 OR
       NOT REGEXP_LIKE(v_new_password_hash, '^[0-9a-f]{64}$') THEN
      write_audit(NULL, 'password-reset', 'password_reset_complete', 'failed', 'Invalid reset-password payload.', p_request_ip, p_user_agent);
      COMMIT;
      RETURN;
    END IF;

    BEGIN
      SELECT reset_id, user_id, expires_at, used_at
      INTO v_reset_id, v_user_id, v_expires_at, v_used_at
      FROM app_password_resets
      WHERE token_hash = v_token_hash
      FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        write_audit(NULL, 'password-reset', 'password_reset_complete', 'failed', 'Invalid reset token.', p_request_ip, p_user_agent);
        COMMIT;
        RETURN;
    END;

    IF v_used_at IS NOT NULL OR v_expires_at <= v_now THEN
      write_audit(v_user_id, 'password-reset', 'password_reset_complete', 'failed', 'Expired or already-used reset token.', p_request_ip, p_user_agent);
      COMMIT;
      RETURN;
    END IF;

    BEGIN
      SELECT username
      INTO v_username
      FROM app_users
      WHERE user_id = v_user_id
        AND is_active = 'Y'
      FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        write_audit(v_user_id, 'password-reset', 'password_reset_complete', 'failed', 'Reset token belongs to an inactive or missing user.', p_request_ip, p_user_agent);
        COMMIT;
        RETURN;
    END;

    UPDATE app_users
    SET password_salt = v_new_salt,
        password_hash = v_new_password_hash,
        failed_login_count = 0,
        locked_until = NULL,
        updated_at = SYSTIMESTAMP
    WHERE user_id = v_user_id;

    UPDATE app_password_resets
    SET used_at = v_now
    WHERE reset_id = v_reset_id;

    UPDATE app_password_resets
    SET used_at = v_now
    WHERE user_id = v_user_id
      AND used_at IS NULL;

    SELECT COUNT(*)
    INTO v_sessions_table_count
    FROM user_tables
    WHERE table_name = 'APP_SESSIONS';

    IF v_sessions_table_count > 0 THEN
      EXECUTE IMMEDIATE
        'UPDATE app_sessions SET revoked_at = :revoked_at WHERE user_id = :user_id AND revoked_at IS NULL'
        USING v_now, v_user_id;
    END IF;

    write_audit(v_user_id, v_username, 'password_reset_complete', 'success', 'Password reset completed.', p_request_ip, p_user_agent);

    p_success := 1;
    p_message := c_reset_success_message;
    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      p_success := 0;
      p_message := c_reset_failure_message;
  END reset_password;

  FUNCTION request_password_reset_json(
    p_email IN VARCHAR2,
    p_token_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2
  ) RETURN CLOB IS
    PRAGMA AUTONOMOUS_TRANSACTION;
    v_user_id NUMBER;
    v_username VARCHAR2(128);
    v_email VARCHAR2(320);
    v_should_send NUMBER;
    v_user_id_str VARCHAR2(40);
  BEGIN
    request_password_reset(
      p_email => p_email,
      p_token_hash => p_token_hash,
      p_request_ip => p_request_ip,
      p_user_agent => p_user_agent,
      p_user_id => v_user_id,
      p_username => v_username,
      p_normalized_email => v_email,
      p_should_send => v_should_send
    );

    IF v_user_id IS NULL THEN
      v_user_id_str := 'null';
    ELSE
      v_user_id_str := TO_CHAR(v_user_id);
    END IF;

    RETURN '{"success":true'
      || ',"message":' || escape_json_str(c_generic_forgot_message)
      || ',"shouldSend":' || CASE WHEN v_should_send = 1 THEN 'true' ELSE 'false' END
      || ',"userId":' || v_user_id_str
      || ',"username":' || escape_json_str(v_username)
      || ',"email":' || escape_json_str(v_email)
      || '}';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RETURN '{"success":true'
        || ',"message":' || escape_json_str(c_generic_forgot_message)
        || ',"shouldSend":false}';
  END request_password_reset_json;

  FUNCTION reset_password_json(
    p_token_hash IN VARCHAR2,
    p_new_salt IN VARCHAR2,
    p_new_password_hash IN VARCHAR2,
    p_request_ip IN VARCHAR2,
    p_user_agent IN VARCHAR2
  ) RETURN CLOB IS
    PRAGMA AUTONOMOUS_TRANSACTION;
    v_success NUMBER;
    v_message VARCHAR2(200);
  BEGIN
    reset_password(
      p_token_hash => p_token_hash,
      p_new_salt => p_new_salt,
      p_new_password_hash => p_new_password_hash,
      p_request_ip => p_request_ip,
      p_user_agent => p_user_agent,
      p_success => v_success,
      p_message => v_message
    );

    RETURN '{"success":' || CASE WHEN v_success = 1 THEN 'true' ELSE 'false' END
      || ',"message":' || escape_json_str(v_message)
      || '}';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RETURN '{"success":false'
        || ',"message":' || escape_json_str(c_reset_failure_message)
        || '}';
  END reset_password_json;
END app_auth_reset_pkg;
/

COMMIT;

PROMPT Secure password reset installation completed.
