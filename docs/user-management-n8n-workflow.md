# User Management — n8n Workflow Guide

Complete n8n implementation guide for the Oracle DBA Portal User Management module.

---

## Overview & Architecture

All User Management actions are dispatched from the frontend through the existing webhook at:
```
POST  NEXT_PUBLIC_DBA_WEBHOOK_URL
```

Standard request payload:
```json
{
  "action": "<action_name>",
  "db": "ORCL",
  "params": { ... },
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Windows",
  "db_type": "Standalone"
}
```

### Workflow Entry Point
Your existing router workflow already routes by `action` value. Inside the **user_management** branch, add a second **Switch node** that routes to individual operation branches based on `{{ $json.action }}`.

---

## n8n Node Pattern (Applies to ALL operations)

Every operation follows this 4-node pattern:

```
Webhook → DDL Execute Node → Confirmation Query Node → Respond to Webhook
```

- **DDL Execute Node** — runs the structural change (CREATE USER, ALTER USER, etc.)
- **Confirmation Query Node** — runs a SELECT to prove the change succeeded
- **Respond to Webhook** — returns JSON in the standard `DbaResponse` envelope

### Standard Response Envelope
```json
{
  "status": "success",
  "request_id": "DBA-{{ $now.toISO() }}",
  "action": "{{ $json.action }}",
  "db_status": "healthy",
  "ai_summary": "Operation completed successfully.",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "rows": [ ...confirmation query results... ]
  },
  "raw_output": ""
}
```

---

## Section 1 — User Account Management

### 1A. `user_status` — Check Users Status

**Switch condition:** `$json.action === "user_status"`

**Oracle Node:**
```sql
SELECT username,
       account_status,
       expiry_date,
       profile
FROM   dba_users
ORDER BY username;
```

**Respond to Webhook:**
```js
// Code Node — build response
return [{
  json: {
    status: "success",
    request_id: `DBA-${Date.now()}`,
    action: "user_status",
    db_status: "healthy",
    ai_summary: `Found ${$input.all().length} database users.`,
    findings: [],
    recommendations: [],
    raw_data: {
      rows: $input.all().map(i => i.json)
    },
    raw_output: ""
  }
}];
```

---

### 1B. `create_user` — Create User

**Switch condition:** `$json.action === "create_user"`

**Params received:**
```json
{
  "username": "APP_USER",
  "password": "Password123",
  "default_tablespace": "USERS",
  "temp_tablespace": "TEMP",
  "profile": "APP_PROFILE",
  "quota": "500M"
}
```

> **Why `:bind_params` fail for DDL in n8n:**
> Oracle does NOT allow parameter binding for DDL statements (CREATE USER, ALTER USER, DROP USER, etc.).
> Even inside `EXECUTE IMMEDIATE`, the bind variables inside the SQL string are Oracle PL/SQL variables —
> not n8n bind parameters. n8n's Oracle node (built on `oracledb`) only supports bind parameters
> for DML (SELECT / INSERT / UPDATE / DELETE). For DDL, you must build the entire SQL string
> in a **Code Node** first and then pass it to the Oracle node as a raw expression.

---

#### Node 1 — Code Node: "Build CREATE USER SQL"

Add a **Code Node** immediately after the Switch. Paste this JavaScript:

```js
// ── Node: Build CREATE USER SQL ─────────────────────────────
const p = $json.params;

// ── Input validation ──────────────────────────────────────
if (!p.username || !p.password) {
  throw new Error('username and password are required');
}

// ── Sanitize inputs ───────────────────────────────────────
// Username: Oracle identifiers — letters, digits, _, $, # only
const username = p.username.toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');

// Password: escape any embedded single quotes (SQL injection guard)
const password = p.password.toString().replace(/'/g, "''");

// Tablespace / Profile names: alphanumeric + underscore only
const sanitizeId = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
const defaultTbs = sanitizeId(p.default_tablespace);
const tempTbs    = sanitizeId(p.temp_tablespace);
const profile    = sanitizeId(p.profile);

// Quota: digits + units + UNLIMITED keyword
const quota = (p.quota || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── Build CREATE USER statement ───────────────────────────
let createSql = `CREATE USER ${username} IDENTIFIED BY "${password}"`;
if (defaultTbs) createSql += ` DEFAULT TABLESPACE ${defaultTbs}`;
if (tempTbs)    createSql += ` TEMPORARY TABLESPACE ${tempTbs}`;
if (profile)    createSql += ` PROFILE ${profile}`;

// ── Build optional QUOTA statement ───────────────────────
let quotaSql = '';
if (quota) {
  const onTbs = defaultTbs || 'USERS';
  quotaSql = `\n  EXECUTE IMMEDIATE 'ALTER USER ${username} QUOTA ${quota} ON ${onTbs}';`;
}

// ── Wrap everything in a single PL/SQL block ──────────────
// This lets n8n run one round-trip to Oracle for both statements.
const plsql = `BEGIN\n  EXECUTE IMMEDIATE '${createSql}';${quotaSql}\nEND;`;

return [{
  json: {
    plsql_query:   plsql,
    confirm_user:  username,
    original_params: p
  }
}];
```

**Output fields produced:**
| Field | Contents |
|---|---|
| `plsql_query` | The complete PL/SQL block to execute |
| `confirm_user` | Uppercased username for the confirmation query |

---

#### Node 2 — Oracle Node: "Execute CREATE USER"

- **Operation:** Execute Query
- **Query field:** `{{ $json.plsql_query }}`
- **Query Parameters:** *(leave empty — we already embedded values in the string)*

This runs the full PL/SQL block as a single Oracle call. Example of what the assembled string looks like:

```sql
BEGIN
  EXECUTE IMMEDIATE 'CREATE USER APP_USER IDENTIFIED BY "Password123" DEFAULT TABLESPACE USERS TEMPORARY TABLESPACE TEMP PROFILE APP_PROFILE';
  EXECUTE IMMEDIATE 'ALTER USER APP_USER QUOTA 500M ON USERS';
END;
```

---

#### Node 3 — Oracle Node: "Confirm User Created"

- **Operation:** Execute Query
- **Query:**
```sql
SELECT username,
       account_status,
       default_tablespace,
       temporary_tablespace,
       profile,
       TO_CHAR(created, 'YYYY-MM-DD HH24:MI:SS') AS created
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```
- No bind parameters needed — username is already sanitized.

---

#### Node 4 — Code Node: "Respond to Webhook"

```js
// ── Node: Respond to Webhook — create_user ───────────────
const row = $input.first().json;
const webhookData = $('Webhook').first().json;

return [{
  json: {
    status: "success",
    request_id: `DBA-${Date.now()}`,
    action: "create_user",
    db_status: "healthy",
    ai_summary: `User ${row.USERNAME || row.username} created successfully. Account status: ${row.ACCOUNT_STATUS || row.account_status}.`,
    findings: [],
    recommendations: [],
    raw_data: { rows: [row] },
    raw_output: ""
  }
}];
```

Then connect this to a **Respond to Webhook** node.

---

---

## The Two-Method Rule for n8n Oracle DDL

> **IMPORTANT — Read this before building any DDL node:**
>
> | Method | Syntax | Works for DDL? | Use when |
> |--------|--------|---------------|----------|
> | n8n expression | `{{ $json.params.username }}` | ✅ **Yes** | n8n substitutes the value BEFORE sending SQL to Oracle. Simple, safe for single statements. |
> | Oracle bind param | `:username` in Query Parameters tab | ❌ **No** for DDL | Oracle bind variables work only for DML (SELECT/INSERT/UPDATE/DELETE). Never use for DDL. |
> | Code Node string build | JavaScript → `$json.ddl` → Oracle Query `{{ $json.ddl }}` | ✅ **Yes** | Required when DDL has conditional clauses, multiple statements, or passwords needing escaping. |
>
> **Rule:** Use a **Code Node** whenever: (a) the statement is conditional, (b) you need to escape special characters (passwords), or (c) you are running multiple DDL statements in one block.
> For simple single-statement DDL, `{{ $json.params.xxx }}` in the Oracle node query field is sufficient.

---

### 1C. `unlock_user` — Unlock User

**Node 1 — Code Node: "Build unlock_user SQL"**
```js
const username = ($json.params.username || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
if (!username) throw new Error('username is required');
return [{ json: { ddl: `ALTER USER ${username} ACCOUNT UNLOCK`, confirm_user: username } }];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Unlock"**
```sql
SELECT username,
       account_status,
       lock_date
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success",
    request_id: `DBA-${Date.now()}`,
    action: "unlock_user",
    db_status: "healthy",
    ai_summary: `User ${row.USERNAME || row.username} unlocked. Status: ${row.ACCOUNT_STATUS || row.account_status}.`,
    findings: [],
    recommendations: [],
    raw_data: { rows: [row] },
    raw_output: ""
  }
}];
```

---

### 1D. `reset_password` — Reset Password

**Node 1 — Code Node: "Build reset_password SQL"**

> **Password always needs a Code Node** — passwords may contain `'`, `"`, `&` or other special characters
> that would break inline `{{ }}` expressions or SQL syntax. The Code Node escapes them safely.

```js
const p = $json.params;
const username = (p.username || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
if (!username) throw new Error('username is required');
if (!p.password) throw new Error('password is required');

// Escape single quotes in the password (SQL string safety)
const escapedPassword = p.password.toString().replace(/'/g, "''");

return [{
  json: {
    ddl: `ALTER USER ${username} IDENTIFIED BY "${escapedPassword}"`,
    confirm_user: username
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Password Reset"**
```sql
SELECT username,
       account_status,
       expiry_date,
       last_login
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success",
    request_id: `DBA-${Date.now()}`,
    action: "reset_password",
    db_status: "healthy",
    ai_summary: `Password reset for ${row.USERNAME || row.username}. Account status: ${row.ACCOUNT_STATUS || row.account_status}.`,
    findings: [],
    recommendations: [],
    raw_data: { rows: [row] },
    raw_output: ""
  }
}];
```

---

### 1E. `change_default_tbs` — Change Default Tablespace

**Node 1 — Code Node: "Build change_default_tbs SQL"**
```js
const sanitize = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
const username  = sanitize($json.params.username);
const tablespace = sanitize($json.params.tablespace);
if (!username || !tablespace) throw new Error('username and tablespace are required');
return [{
  json: {
    ddl: `ALTER USER ${username} DEFAULT TABLESPACE ${tablespace}`,
    confirm_user: username
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Default TBS"**
```sql
SELECT username, default_tablespace
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success",
    request_id: `DBA-${Date.now()}`,
    action: "change_default_tbs",
    db_status: "healthy",
    ai_summary: `Default tablespace for ${row.USERNAME || row.username} changed to ${row.DEFAULT_TABLESPACE || row.default_tablespace}.`,
    findings: [],
    recommendations: [],
    raw_data: { rows: [row] },
    raw_output: ""
  }
}];
```

---

### 1F. `change_temp_tbs` — Change Temporary Tablespace

**Node 1 — Code Node: "Build change_temp_tbs SQL"**
```js
const sanitize = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
const username   = sanitize($json.params.username);
const tablespace = sanitize($json.params.tablespace);
if (!username || !tablespace) throw new Error('username and tablespace are required');
return [{
  json: {
    ddl: `ALTER USER ${username} TEMPORARY TABLESPACE ${tablespace}`,
    confirm_user: username
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Temp TBS"**
```sql
SELECT username, temporary_tablespace
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "change_temp_tbs",
    db_status: "healthy",
    ai_summary: `Temporary tablespace for ${row.USERNAME || row.username} changed to ${row.TEMPORARY_TABLESPACE || row.temporary_tablespace}.`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

### 1G. `change_quota` — Change Quota

**Node 1 — Code Node: "Build change_quota SQL"**
```js
const sanitize    = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
const sanitizeQta = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
const username   = sanitize($json.params.username);
const tablespace = sanitize($json.params.tablespace);
const quota      = sanitizeQta($json.params.quota);  // e.g. 1G, 500M, UNLIMITED
if (!username || !tablespace || !quota) throw new Error('username, tablespace, and quota are required');
return [{
  json: {
    ddl: `ALTER USER ${username} QUOTA ${quota} ON ${tablespace}`,
    confirm_user: username,
    confirm_tbs: tablespace
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Quota"**
```sql
SELECT username,
       tablespace_name,
       max_bytes,
       bytes AS used_bytes
FROM   dba_ts_quotas
WHERE  username       = '{{ $json.confirm_user }}'
AND    tablespace_name = '{{ $json.confirm_tbs }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "change_quota",
    db_status: "healthy",
    ai_summary: `Quota updated for ${row.USERNAME || row.username} on ${row.TABLESPACE_NAME || row.tablespace_name}. Max bytes: ${row.MAX_BYTES || row.max_bytes}.`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

### 1H. `assign_profile` — Assign Profile

**Node 1 — Code Node: "Build assign_profile SQL"**
```js
const sanitize = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
const username = sanitize($json.params.username);
const profile  = sanitize($json.params.profile);
if (!username || !profile) throw new Error('username and profile are required');
return [{
  json: {
    ddl: `ALTER USER ${username} PROFILE ${profile}`,
    confirm_user: username
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Profile Assignment"**
```sql
SELECT username, profile
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "assign_profile",
    db_status: "healthy",
    ai_summary: `Profile ${row.PROFILE || row.profile} assigned to ${row.USERNAME || row.username}.`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

### 1I. `rename_user` — Rename User

> **Note:** `ALTER USER … RENAME TO` requires **Oracle 19c RU 19.27+ or Oracle 21c+**.
> Run `SELECT * FROM v$version` first to confirm. On older versions, use Data Pump export/import.

**Node 1 — Code Node: "Build rename_user SQL"**
```js
const sanitize   = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
const username    = sanitize($json.params.username);
const newUsername = sanitize($json.params.new_username);
if (!username || !newUsername) throw new Error('username and new_username are required');
return [{
  json: {
    ddl: `ALTER USER ${username} RENAME TO ${newUsername}`,
    confirm_user: newUsername
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Rename"**
```sql
SELECT username,
       account_status,
       TO_CHAR(created, 'YYYY-MM-DD') AS created
FROM   dba_users
WHERE  username = '{{ $json.confirm_user }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "rename_user",
    db_status: "healthy",
    ai_summary: `User renamed. New username: ${row.USERNAME || row.username}. Status: ${row.ACCOUNT_STATUS || row.account_status}.`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

### 1J. `drop_user` — Drop User

**Node 1 — Code Node: "Build drop_user SQL"**
```js
const username = ($json.params.username || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
if (!username) throw new Error('username is required');
return [{
  json: {
    ddl: `DROP USER ${username} CASCADE`,
    dropped_user: username
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Drop"**
```sql
SELECT COUNT(*) AS user_exists
FROM   dba_users
WHERE  username = '{{ $json.dropped_user }}'
```
*(Expect `user_exists = 0` to confirm the user was dropped.)*

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row      = $input.first().json;
const exists   = parseInt(row.USER_EXISTS ?? row.user_exists ?? "1");
const dropped  = exists === 0;
return [{
  json: {
    status: dropped ? "success" : "error",
    request_id: `DBA-${Date.now()}`,
    action: "drop_user",
    db_status: dropped ? "healthy" : "critical",
    ai_summary: dropped
      ? `User ${ $('Build drop_user SQL').first().json.dropped_user } has been permanently dropped.`
      : `User still exists after DROP — check Oracle alert log.`,
    findings: [],
    recommendations: [],
    raw_data: { rows: [row] },
    raw_output: ""
  }
}];
```

---

## Section 1 — Lookup / Helper Actions

These are called by the frontend when the user opens a dropdown.

### `schema_list` — List All Users (already in your workflow)

```sql
SELECT username
FROM   dba_users
ORDER BY username;
```

Return as `raw_data.schemas` (string array) OR `raw_data.rows`.

### `list_tbs` — List All Permanent Tablespaces

```sql
SELECT tablespace_name
FROM   dba_tablespaces
WHERE  contents = 'PERMANENT'
AND    status   = 'ONLINE'
ORDER BY tablespace_name;
```

### `list_temp_tbs` — List All Temporary Tablespaces

```sql
SELECT tablespace_name
FROM   dba_tablespaces
WHERE  contents = 'TEMPORARY'
AND    status   = 'ONLINE'
ORDER BY tablespace_name;
```

### `list_profile` — List All Profiles

```sql
SELECT DISTINCT profile
FROM   dba_profiles
ORDER BY profile;
```

### `fetch_roles` — List All Roles

```sql
SELECT role
FROM   dba_roles
ORDER BY role;
```

### `list_objects` — List Objects by Owner

```sql
SELECT object_name
FROM   dba_objects
WHERE  owner = UPPER('{{ $json.params.owner }}')
AND    object_type NOT IN ('INDEX','INDEX PARTITION','TABLE PARTITION','TABLE SUBPARTITION')
ORDER BY object_type, object_name;
```

---

## Section 2 — Profile Management

### 2A. `view_profiles` — View All Profile Parameters

```sql
SELECT profile,
       resource_name,
       limit
FROM   dba_profiles
ORDER BY profile, resource_name;
```

---

### 2B. `create_profile` — Create Profile

**Params received:**
```json
{
  "profile_name": "APP_PROFILE",
  "SESSIONS_PER_USER": "3",
  "CPU_PER_SESSION": "UNLIMITED",
  "CPU_PER_CALL": "UNLIMITED",
  "CONNECT_TIME": "480",
  "IDLE_TIME": "30",
  "LOGICAL_READS_PER_SESSION": "UNLIMITED",
  "LOGICAL_READS_PER_CALL": "UNLIMITED",
  "PRIVATE_SGA": "UNLIMITED",
  "COMPOSITE_LIMIT": "UNLIMITED",
  "FAILED_LOGIN_ATTEMPTS": "5",
  "PASSWORD_LIFE_TIME": "90",
  "PASSWORD_GRACE_TIME": "7",
  "PASSWORD_REUSE_TIME": "365",
  "PASSWORD_REUSE_MAX": "5",
  "PASSWORD_VERIFY_FUNCTION": "ora12c_verify_function",
  "PASSWORD_LOCK_TIME": "1",
  "PASSWORD_ROLLOVER_TIME": "1",
  "INACTIVE_ACCOUNT_TIME": "90"
}
```

**Node 1 — Code Node: "Build CREATE PROFILE SQL"**
```js
// ── Node: Build CREATE PROFILE SQL ──────────────────────────
const p = $json.params;

// Allowed profile parameter keys — whitelist to avoid injection
const ALLOWED_PARAMS = [
  "SESSIONS_PER_USER", "CPU_PER_SESSION", "CPU_PER_CALL", "CONNECT_TIME",
  "IDLE_TIME", "LOGICAL_READS_PER_SESSION", "LOGICAL_READS_PER_CALL",
  "PRIVATE_SGA", "COMPOSITE_LIMIT", "FAILED_LOGIN_ATTEMPTS",
  "PASSWORD_LIFE_TIME", "PASSWORD_GRACE_TIME", "PASSWORD_REUSE_TIME",
  "PASSWORD_REUSE_MAX", "PASSWORD_VERIFY_FUNCTION", "PASSWORD_LOCK_TIME",
  "PASSWORD_ROLLOVER_TIME", "INACTIVE_ACCOUNT_TIME"
];

// Sanitize profile name: alphanumeric + underscore only
const profileName = (p.profile_name || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
if (!profileName) throw new Error('profile_name is required');

// Build LIMIT clauses for non-empty params only
const limitLines = ALLOWED_PARAMS
  .filter(k => p[k] != null && String(p[k]).trim() !== '')
  .map(k => {
    // Sanitize values: digits, letters, underscore (covers UNLIMITED, function names, numbers)
    const val = String(p[k]).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    return `  ${k.padEnd(30)} ${val}`;
  })
  .join('\n');

if (!limitLines) throw new Error('At least one profile parameter is required');

const ddl = `CREATE PROFILE ${profileName} LIMIT\n${limitLines}`;

return [{
  json: {
    ddl,
    confirm_profile: profileName
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Profile Created"**
```sql
SELECT profile,
       resource_name,
       limit
FROM   dba_profiles
WHERE  profile = '{{ $json.confirm_profile }}'
ORDER BY resource_name
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const rows = $input.all().map(i => i.json);
return [{
  json: {
    status: "success",
    request_id: `DBA-${Date.now()}`,
    action: "create_profile",
    db_status: "healthy",
    ai_summary: `Profile ${ $('Build CREATE PROFILE SQL').first().json.confirm_profile } created with ${rows.length} parameter(s).`,
    findings: [],
    recommendations: [],
    raw_data: { rows },
    raw_output: ""
  }
}];
```

---

### 2C. `alter_profile` — Alter Profile

**Params:**
```json
{
  "profile_name": "APP_PROFILE",
  "resource_name": "PASSWORD_LIFE_TIME",
  "limit": "180"
}
```

**Node 1 — Code Node: "Build alter_profile SQL"**
```js
const sanitize = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
const profileName    = sanitize($json.params.profile_name);
const resourceName   = sanitize($json.params.resource_name);
const limitVal       = sanitize($json.params.limit);

if (!profileName || !resourceName || !limitVal) {
  throw new Error('profile_name, resource_name, and limit are required');
}

return [{
  json: {
    ddl: `ALTER PROFILE ${profileName} LIMIT ${resourceName} ${limitVal}`,
    confirm_profile:  profileName,
    confirm_resource: resourceName
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Alter Profile"**
```sql
SELECT profile,
       resource_name,
       limit
FROM   dba_profiles
WHERE  profile       = '{{ $json.confirm_profile }}'
AND    resource_name = '{{ $json.confirm_resource }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "alter_profile",
    db_status: "healthy",
    ai_summary: `Profile ${row.PROFILE || row.profile}: ${row.RESOURCE_NAME || row.resource_name} set to ${row.LIMIT || row.limit}.`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

### 2D. `drop_profile` — Drop Profile

**Node 1 — Code Node: "Build drop_profile SQL"**
```js
const profileName = ($json.params.profile_name || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
if (!profileName) throw new Error('profile_name is required');
// Prevent dropping Oracle built-in profiles
if (['DEFAULT', 'ORA_STIG_PROFILE'].includes(profileName)) {
  throw new Error(`Cannot drop built-in Oracle profile: ${profileName}`);
}
return [{ json: { ddl: `DROP PROFILE ${profileName}`, dropped_profile: profileName } }];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Drop Profile"**
```sql
SELECT COUNT(*) AS profile_exists
FROM   dba_profiles
WHERE  profile = '{{ $json.dropped_profile }}'
```
*(Expect `profile_exists = 0`)*

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row     = $input.first().json;
const exists  = parseInt(row.PROFILE_EXISTS ?? row.profile_exists ?? "1");
const dropped = exists === 0;
return [{
  json: {
    status: dropped ? "success" : "error",
    request_id: `DBA-${Date.now()}`,
    action: "drop_profile",
    db_status: dropped ? "healthy" : "critical",
    ai_summary: dropped
      ? `Profile ${ $('Build drop_profile SQL').first().json.dropped_profile } has been dropped.`
      : `Profile still exists after DROP — check Oracle logs.`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

## Section 3 — Privilege Management

### 3A. `system_privilege` — Grant / Revoke System Privileges

**Params received:**
```json
{
  "username": "APP_USER",
  "operation": "GRANT",
  "system_privilege": ["CREATE SESSION", "CREATE TABLE", "CREATE VIEW"]
}
```

**Node 1 — Code Node: "Build system_privilege SQL"**
```js
// ── Node: Build system_privilege SQL ────────────────────────
const ALLOWED_OPS   = ['GRANT', 'REVOKE'];
const ALLOWED_PRIVS = [
  'CREATE SESSION', 'CREATE TABLE', 'CREATE VIEW', 'CREATE PROCEDURE',
  'CREATE USER', 'ALTER USER', 'DROP USER', 'ALTER SYSTEM',
  'SELECT ANY TABLE', 'EXECUTE ANY PROCEDURE'
];

const p         = $json.params;
const operation = (p.operation || '').toString().toUpperCase().trim();
const username  = (p.username  || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');

if (!ALLOWED_OPS.includes(operation)) throw new Error(`Invalid operation: ${operation}`);
if (!username) throw new Error('username is required');

// Validate and whitelist each privilege
const rawPrivs = Array.isArray(p.system_privilege) ? p.system_privilege : [p.system_privilege];
const privs = rawPrivs
  .map(v => (v || '').toString().toUpperCase().trim())
  .filter(v => ALLOWED_PRIVS.includes(v));

if (privs.length === 0) throw new Error('No valid system privileges selected');

// Build a single PL/SQL block that runs one GRANT/REVOKE per privilege
const targetClause = operation === 'REVOKE' ? 'FROM' : 'TO';
const execLines = privs
  .map(priv => `  EXECUTE IMMEDIATE '${operation} ${priv} ${targetClause} ${username}';`)
  .join('\n');

const ddl = `BEGIN\n${execLines}\nEND;`;

return [{ json: { ddl, confirm_user: username, operation, privs } }];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm System Privileges"**
```sql
SELECT privilege,
       admin_option
FROM   dba_sys_privs
WHERE  grantee = '{{ $json.confirm_user }}'
ORDER BY privilege
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const rows = $input.all().map(i => i.json);
const build = $('Build system_privilege SQL').first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "system_privilege",
    db_status: "healthy",
    ai_summary: `${build.operation} completed for ${build.confirm_user}. Active privileges: ${rows.map(r => r.PRIVILEGE || r.privilege).join(', ')}.`,
    findings: [], recommendations: [], raw_data: { rows }, raw_output: ""
  }
}];
```

---

### 3B. `object_privilege` — Grant / Revoke Object Privileges

**Params received:**
```json
{
  "username": "APP_USER",
  "operation": "GRANT",
  "owner_name": "SCOTT",
  "object_name": "EMP",
  "object_privilege": ["SELECT", "INSERT", "UPDATE"]
}
```

**Node 1 — Code Node: "Build object_privilege SQL"**
```js
// ── Node: Build object_privilege SQL ────────────────────────
const ALLOWED_OPS   = ['GRANT', 'REVOKE'];
const ALLOWED_PRIVS = ['SELECT','INSERT','UPDATE','DELETE','EXECUTE','REFERENCES','ALTER'];

const p          = $json.params;
const sanitize   = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_$#.]/g, '');
const operation  = (p.operation || '').toString().toUpperCase().trim();
const username   = (p.username   || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
const ownerName  = sanitize(p.owner_name);
const objectName = sanitize(p.object_name);

if (!ALLOWED_OPS.includes(operation)) throw new Error(`Invalid operation: ${operation}`);
if (!username || !ownerName || !objectName) throw new Error('username, owner_name, and object_name are required');

// Whitelist privileges
const rawPrivs = Array.isArray(p.object_privilege) ? p.object_privilege : [p.object_privilege];
const privs = rawPrivs
  .map(v => (v || '').toString().toUpperCase().trim())
  .filter(v => ALLOWED_PRIVS.includes(v));

if (privs.length === 0) throw new Error('No valid object privileges selected');

const targetClause = operation === 'REVOKE' ? 'FROM' : 'TO';
const ddl = `${operation} ${privs.join(', ')} ON ${ownerName}.${objectName} ${targetClause} ${username}`;

return [{ json: { ddl, confirm_user: username, owner_name: ownerName, object_name: objectName } }];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Object Privileges"**
```sql
SELECT privilege,
       owner,
       table_name,
       grantor,
       grantable
FROM   dba_tab_privs
WHERE  grantee    = '{{ $json.confirm_user }}'
AND    owner      = '{{ $json.owner_name }}'
AND    table_name = '{{ $json.object_name }}'
ORDER BY privilege
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const rows  = $input.all().map(i => i.json);
const build = $('Build object_privilege SQL').first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "object_privilege",
    db_status: "healthy",
    ai_summary: `Object privileges updated on ${build.owner_name}.${build.object_name} for ${build.confirm_user}.`,
    findings: [], recommendations: [], raw_data: { rows }, raw_output: ""
  }
}];
```

---

### 3C. `create_role` — Create Role

**Node 1 — Code Node: "Build create_role SQL"**
```js
const roleName = ($json.params.role_name || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
if (!roleName) throw new Error('role_name is required');
return [{ json: { ddl: `CREATE ROLE ${roleName}`, confirm_role: roleName } }];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Role Created"**
```sql
SELECT role,
       role_id,
       authentication_type
FROM   dba_roles
WHERE  role = '{{ $json.confirm_role }}'
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const row = $input.first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "create_role",
    db_status: "healthy",
    ai_summary: `Role ${row.ROLE || row.role} created (ID: ${row.ROLE_ID || row.role_id}).`,
    findings: [], recommendations: [], raw_data: { rows: [row] }, raw_output: ""
  }
}];
```

---

### 3D. `role_to_user` — Grant / Revoke Role to User

**Params:**
```json
{
  "username": "APP_USER",
  "role": "DEVELOPER_ROLE",
  "operation": "GRANT"
}
```

**Node 1 — Code Node: "Build role_to_user SQL"**
```js
const ALLOWED_OPS = ['GRANT', 'REVOKE'];
const sanitize    = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
const operation   = (($json.params.operation || '')).toString().toUpperCase().trim();
const username    = sanitize($json.params.username);
const roleName    = sanitize($json.params.role);

if (!ALLOWED_OPS.includes(operation)) throw new Error(`Invalid operation: ${operation}`);
if (!username || !roleName) throw new Error('username and role are required');

const targetClause = operation === 'REVOKE' ? 'FROM' : 'TO';

return [{
  json: {
    ddl: `${operation} ${roleName} ${targetClause} ${username}`,
    confirm_user: username,
    operation
  }
}];
```

**Node 2 — Oracle Node: "Execute DDL"**
- Query: `{{ $json.ddl }}`

**Node 3 — Oracle Node: "Confirm Role Assignment"**
```sql
SELECT granted_role,
       admin_option,
       default_role
FROM   dba_role_privs
WHERE  grantee = '{{ $json.confirm_user }}'
ORDER BY granted_role
```

**Node 4 — Code Node: "Respond to Webhook"**
```js
const rows  = $input.all().map(i => i.json);
const build = $('Build role_to_user SQL').first().json;
return [{
  json: {
    status: "success", request_id: `DBA-${Date.now()}`, action: "role_to_user",
    db_status: "healthy",
    ai_summary: `Roles for ${build.confirm_user}: ${rows.map(r => r.GRANTED_ROLE || r.granted_role).join(', ')}.`,
    findings: [], recommendations: [], raw_data: { rows }, raw_output: ""
  }
}];
```

---

## Error Handling in n8n

### Pattern: Error Branch on EVERY Oracle Execute Node

For each Oracle node in the workflow, enable **Continue On Fail = ON**. Then add an **IF node** after the Oracle node that checks:
- True branch: `{{ !$json.error }}` → proceed to Confirmation Query
- False branch: `{{ !!$json.error }}` → go to Error Response Code Node

**Error Response Code Node** (attach to every error branch, then to Respond to Webhook):
```js
// ── Universal Error Handler ───────────────────────────────
// Works for Oracle node errors (oracledb driver errors)
const oraError = $json.error || {};
const msg = oraError.message || oraError.description || JSON.stringify(oraError) || "Unknown Oracle error";

// Try to extract ORA- error code (e.g. ORA-01920: user name 'X' does not exist)
const oraCode = (msg.match(/ORA-\d+/) || [])[0] || "";

return [{
  json: {
    status: "error",
    request_id: `DBA-${Date.now()}`,
    action: $('Webhook').first().json.action || "unknown",
    db_status: "critical",
    ai_summary: `DDL failed${oraCode ? ` [${oraCode}]` : ''}: ${msg}`,
    findings: [{
      title: "DDL Execution Failed",
      detail: msg,
      severity: "critical"
    }],
    recommendations: [{
      title: "Check Oracle Alert Log",
      detail: "Review the Oracle alert log and DBA_AUDIT_TRAIL for details.",
      severity: "critical"
    }],
    raw_data: { rows: [] },
    raw_output: msg
  }
}];
```

Route the output of this Code Node to a **Respond to Webhook** node so the frontend always gets a response.

### Common ORA Errors & Meanings

| ORA Code | Meaning | Frontend Fix |
|----------|---------|-------------|
| `ORA-01920` | Username already exists | Check user_status first |
| `ORA-01918` | User does not exist | Verify spelling / case |
| `ORA-00959` | Tablespace does not exist | Refresh tablespace dropdown |
| `ORA-02380` | Profile does not exist | Refresh profile dropdown |
| `ORA-00990` | Missing or invalid privilege | Verify privilege name whitelist |
| `ORA-01045` | User lacks CREATE SESSION | Grant CREATE SESSION first |
| `ORA-28003` | Password verification failed | Password does not meet policy |

---

## Complete Switch Node Configuration

In the **User Management** sub-router, create a Switch node with the following `{{ $json.action }}` cases:

| Case # | Value                | Branch Name                    |
|--------|----------------------|--------------------------------|
| 1      | `user_status`        | Check Users Status             |
| 2      | `create_user`        | Create User                    |
| 3      | `unlock_user`        | Unlock User                    |
| 4      | `reset_password`     | Reset Password                 |
| 5      | `change_default_tbs` | Change Default Tablespace      |
| 6      | `change_temp_tbs`    | Change Temporary Tablespace    |
| 7      | `change_quota`       | Change Quota                   |
| 8      | `assign_profile`     | Assign Profile                 |
| 9      | `rename_user`        | Rename User                    |
| 10     | `drop_user`          | Drop User                      |
| 11     | `schema_list`        | List Schemas/Users             |
| 12     | `list_tbs`           | List Tablespaces               |
| 13     | `list_temp_tbs`      | List Temp Tablespaces          |
| 14     | `list_profile`       | List Profiles                  |
| 15     | `fetch_roles`        | Fetch Roles                    |
| 16     | `list_objects`       | List Objects by Owner          |
| 17     | `view_profiles`      | View All Profile Parameters    |
| 18     | `create_profile`     | Create Profile                 |
| 19     | `alter_profile`      | Alter Profile                  |
| 20     | `drop_profile`       | Drop Profile                   |
| 21     | `system_privilege`   | Grant/Revoke System Privileges |
| 22     | `object_privilege`   | Grant/Revoke Object Privileges |
| 23     | `create_role`        | Create Role                    |
| 24     | `role_to_user`       | Grant/Revoke Role to User      |

---

## Oracle Database Connection Setup in n8n

1. Navigate to **Credentials → New → Oracle Database**
2. Set `host`, `port` (1521 or 1522), `service_name` (e.g. `ORCL`), `user` (e.g. `SYS`), `password`
3. For DDL operations, the n8n Oracle service account needs `DBA` role or at minimum:
   - `CREATE USER`, `ALTER USER`, `DROP USER`
   - `CREATE PROFILE`, `ALTER PROFILE`, `DROP PROFILE`
   - `GRANT ANY PRIVILEGE`, `GRANT ANY ROLE`
   - `SELECT ON DBA_USERS`, `SELECT ON DBA_PROFILES`, `SELECT ON DBA_ROLES`

---

## Important Notes

1. **`rename_user`** requires Oracle 19c Database Update 19.27+ or Oracle 21c+. On older versions, Oracle does not support `ALTER USER … RENAME TO`. As a workaround, use Data Pump export/import.

2. **`drop_user`** uses `CASCADE` — this permanently drops all objects owned by the user. Add a **Wait for Approval** step in n8n (HTTP Request node to your app's approval endpoint) before executing.

3. **Quota values** must be valid Oracle quota formats: `500M`, `1G`, `UNLIMITED`, or `0` (revoke quota).

4. **Password Verify Function** — `ora12c_verify_function` must exist in the database. If using Oracle 21c, use `ora21c_verify_function`. If none, use `NULL`.

5. **Parameterized vs. dynamic SQL** — For security, build DDL in Code nodes and log them to `app_audit_logs` before execution.

6. **`schema_list`** is already in your existing workflow. Ensure the `raw_data.schemas` or `raw_data.rows[].username` field is populated so the frontend can extract usernames for dropdowns.
