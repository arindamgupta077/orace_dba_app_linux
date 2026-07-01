SET DEFINE OFF;

--------------------------------------------------------------------------------
-- app_user_preferences.sql
--------------------------------------------------------------------------------
-- Creates the user profile / preference table used by the ITSS DBA Portal
-- to persist per-user UI settings.  Today the only persisted preference is
-- the theme (light / dark) chosen from the navbar toggle, but the table is
-- structured so additional profile columns (density, language, landing page,
-- notification opt-ins, ...) can be added later without a schema rewrite.
--
-- Run order:
--   1) Run oracle_app_setup.sql first (it creates app_users).
--   2) Run this script as the APP_DBA schema owner.
--
-- The script is idempotent — re-running it will recreate the table, helper
-- procedures and seed every existing user with a default 'dark' preference.
--------------------------------------------------------------------------------

PROMPT ---------------------------------------------------------------;
PROMPT app_user_preferences — user profile / preference table       ;
PROMPT ---------------------------------------------------------------;

--------------------------------------------------------------------------------
-- Helper: drop an object if it exists (suppresses the common ORA-xxxxx)
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE drop_table_if_exists(p_table VARCHAR2) IS
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE ' || p_table || ' CASCADE CONSTRAINTS PURGE';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -942 THEN RAISE; END IF;       -- ORA-00942: table or view does not exist
END;
/
CREATE OR REPLACE PROCEDURE drop_procedure_if_exists(p_proc VARCHAR2) IS
BEGIN
  EXECUTE IMMEDIATE 'DROP PROCEDURE ' || p_proc;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -4043 THEN RAISE; END IF;       -- ORA-04043: object does not exist
END;
/

BEGIN drop_procedure_if_exists('upsert_user_theme_preference'); END;
/
BEGIN drop_table_if_exists('app_user_preferences'); END;
/

PROMPT Dropped any previous app_user_preferences objects.

--------------------------------------------------------------------------------
-- 1) app_user_preferences table
--
--   user_id            FK -> app_users.user_id (also PK → one row per user)
--   theme_preference   'light' | 'dark'         (default 'dark' to preserve
--                                                 the app's pre-existing look)
--   created_at         row creation timestamp
--   updated_at         maintained by the BEFORE UPDATE trigger below
--------------------------------------------------------------------------------
CREATE TABLE app_user_preferences (
  user_id           NUMBER          NOT NULL,
  theme_preference  VARCHAR2(10)    DEFAULT 'dark' NOT NULL,
  created_at        TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at        TIMESTAMP(6)    DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT app_user_preferences_pk        PRIMARY KEY (user_id),
  CONSTRAINT app_user_preferences_user_fk   FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
  CONSTRAINT app_user_preferences_theme_ck  CHECK (theme_preference IN ('light', 'dark'))
);

CREATE INDEX app_user_preferences_theme_ix ON app_user_preferences (theme_preference);

COMMENT ON TABLE  app_user_preferences            IS 'Per-user UI profile / preferences for the ITSS DBA Portal.';
COMMENT ON COLUMN app_user_preferences.user_id           IS 'Owner user — references app_users.user_id.';
COMMENT ON COLUMN app_user_preferences.theme_preference  IS 'Portal colour theme: light or dark.';
COMMENT ON COLUMN app_user_preferences.created_at        IS 'Row creation timestamp (server time).';
COMMENT ON COLUMN app_user_preferences.updated_at        IS 'Last update timestamp (server time, maintained by trigger).';

--------------------------------------------------------------------------------
-- 2) Trigger to keep updated_at fresh on every UPDATE
--------------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER app_user_preferences_bu_trg
BEFORE UPDATE ON app_user_preferences
FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSTIMESTAMP;
END;
/

--------------------------------------------------------------------------------
-- 3) Helper PL/SQL procedure: upsert a user's theme preference
--    (called optionally from SQL*Plus / SQL Developer; the Next.js API
--     route uses an equivalent MERGE statement directly for connection
--     efficiency, but this procedure is handy for scripts and tests.)
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE upsert_user_theme_preference(
  p_user_id          IN NUMBER,
  p_theme_preference IN VARCHAR2
) IS
  v_theme VARCHAR2(10);
BEGIN
  v_theme := LOWER(TRIM(p_theme_preference));
  IF v_theme NOT IN ('light', 'dark') THEN
    RAISE_APPLICATION_ERROR(-20001, 'theme_preference must be either ''light'' or ''dark''');
  END IF;

  MERGE INTO app_user_preferences dst
  USING (
    SELECT p_user_id AS user_id FROM dual
  ) src
  ON (dst.user_id = src.user_id)
  WHEN MATCHED THEN
    UPDATE SET dst.theme_preference = v_theme
  WHEN NOT MATCHED THEN
    INSERT (user_id, theme_preference)
    VALUES (src.user_id, v_theme);
END;
/

--------------------------------------------------------------------------------
-- 4) Seed a default 'dark' preference row for every existing app_users row
--    so the repository's outer-join never returns a NULL theme.
--------------------------------------------------------------------------------
INSERT INTO app_user_preferences (user_id, theme_preference)
SELECT u.user_id, 'dark'
FROM   app_users u
WHERE  NOT EXISTS (
  SELECT 1 FROM app_user_preferences p WHERE p.user_id = u.user_id
);

COMMIT;

PROMPT ---------------------------------------------------------------;
PROMPT Verification: rows created per user                            ;
PROMPT ---------------------------------------------------------------;
SELECT u.username,
       p.theme_preference,
       TO_CHAR(p.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
FROM   app_users u
LEFT JOIN app_user_preferences p ON p.user_id = u.user_id
ORDER  BY u.username;

--------------------------------------------------------------------------------
-- 5) Clean up the local helper procedures (keep the table + trigger)
--------------------------------------------------------------------------------
DROP PROCEDURE drop_table_if_exists;
DROP PROCEDURE drop_procedure_if_exists;

PROMPT app_user_preferences table, trigger and seed data created successfully.
