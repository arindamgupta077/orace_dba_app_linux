# Tablespace Management — n8n Workflow Guide

Complete n8n implementation guide for the **Tablespace Management** module of the Oracle DBA Portal.

---

## Overview & Architecture

All Tablespace Management actions are dispatched from the frontend through the existing webhook at:
```
POST  NEXT_PUBLIC_DBA_WEBHOOK_URL
```

Standard request payload:
```json
{
  "action": "create_tablespace",
  "db": "ORCL",
  "params": {
    "tablespace_name": "MY_DATA",
    "size": "500M",
    "autoextend": "ON",
    "next": "100M",
    "maxsize": "10G"
  },
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Windows",
  "db_type": "Standalone"
}
```

### Workflow Entry Point

Your existing router workflow routes by `action` value. Inside the **tablespace** branch, add a **Switch node** that routes to individual operation branches based on `{{ $json.action }}`.

---

## n8n Node Pattern

Every operation follows this pattern:

```
Webhook → Get DB Path Node → Code Node (Build SQL) → Oracle Execute Node → Verify Node → Code Node (Build Response) → Respond to Webhook
```

---

## `create_tablespace` — Create New Tablespace

### Switch Condition

```
{{ $json.action === "create_tablespace" }}
```

### Params Received

```json
{
  "tablespace_name": "MY_DATA",
  "size": "500M",
  "autoextend": "ON",
  "next": "100M",
  "maxsize": "10G"
}
```

---

### Node 1 — Oracle Query Node: "Get DB Storage Path"

Before building the `CREATE TABLESPACE` statement, we need to know **where Oracle stores datafiles** on this instance. This node queries either the OMF destination or derives it from an existing tablespace.

- **Operation:** Execute Query
- **Query:**

```sql
SELECT
  NVL(
    (SELECT value FROM v$parameter WHERE name = 'db_create_file_dest'),
    (SELECT REGEXP_SUBSTR(file_name, '^.*[/\\]') FROM dba_data_files WHERE tablespace_name = 'USERS' AND ROWNUM = 1)
  ) AS data_dir
FROM dual
```

> **Logic:** If `db_create_file_dest` (Oracle Managed Files) is configured, use it. Otherwise, extract the directory from the `USERS` tablespace datafile path. One of these will always return a value on a standard Oracle install.

**Output fields produced:**

| Field | Contents |
|---|---|
| `DATA_DIR` | Directory path for the new datafile (Oracle/n8n returns column names in **UPPERCASE**, e.g. `C:\U01\APP\ORACLE\ORADATA\ORCL\` or `+DATA`) |

> **Important:** The n8n Oracle node returns result columns in uppercase (`DATA_DIR`), not lowercase (`data_dir`). The Code Node below reads both forms.

---

### Node 2 — Code Node: "Build CREATE TABLESPACE SQL"

Add a **Code Node** after the "Get DB Storage Path" node. Paste this JavaScript:

```js
// ── Node: Build CREATE TABLESPACE SQL ───────────────────────

// ── Pull params from the original webhook payload ──────────
const webhookData = $('DBA Webhook Entry').first().json;
const p = webhookData.body.params;

// ── Resolve DATA_DIR from previous Oracle node ────────────
// Oracle returns uppercase column names (DATA_DIR). Also check
// lowercase and read directly from the named upstream node.
function resolveDataDir() {
  const sources = [
    $json,
    $('Get DB Storage Path').first()?.json
  ].filter(Boolean);

  for (const row of sources) {
    const value = row.DATA_DIR ?? row.data_dir;
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

// Join directory + filename; use forward slashes in SQL (Oracle accepts on Windows)
function joinDatafilePath(dir, filename) {
  const normalized = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${normalized}/${filename}`;
}

// ── Input validation ──────────────────────────────────────
if (!p.tablespace_name) {
  throw new Error('tablespace_name is required');
}
if (!p.size) {
  throw new Error('size is required');
}

// ── Sanitize inputs ───────────────────────────────────────
const sanitizeId = (v) => (v || '').toString().toUpperCase().replace(/[^A-Z0-9_$#]/g, '');
const sanitizeSize = (v) => {
  const raw = (v || '').toString().trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'UNLIMITED') return 'UNLIMITED';
  return raw.replace(/[^0-9MKGT]/g, '');
};

const tbsName = sanitizeId(p.tablespace_name);
const size = sanitizeSize(p.size);
const next = sanitizeSize(p.next);
const maxsize = sanitizeSize(p.maxsize);
const autoextend = (p.autoextend || 'OFF').toString().toUpperCase() === 'ON' ? 'ON' : 'OFF';

if (!tbsName) {
  throw new Error('tablespace_name is invalid after sanitization');
}
if (!size) {
  throw new Error('size is required');
}
if (autoextend === 'ON' && (!next || !maxsize)) {
  throw new Error('When Autoextend is ON, both next and maxsize are required');
}

// ── Derive datafile path ──────────────────────────────────
const rawDir = resolveDataDir();
let datafilePath;

if (rawDir.startsWith('+')) {
  datafilePath = rawDir;
} else if (rawDir.length > 0) {
  const filename = tbsName.toLowerCase() + '01.dbf';
  datafilePath = joinDatafilePath(rawDir, filename);
} else {
  throw new Error(
    'Could not determine datafile path. DATA_DIR was empty. ' +
    'Set db_create_file_dest or ensure USERS tablespace exists.'
  );
}

// ── Build CREATE TABLESPACE statement ─────────────────────
let sql;

if (rawDir.startsWith('+')) {
  sql = `CREATE TABLESPACE ${tbsName}\n` +
        `  DATAFILE SIZE ${size}`;
} else {
  sql = `CREATE TABLESPACE ${tbsName}\n` +
        `  DATAFILE '${datafilePath}' SIZE ${size}`;
}

if (autoextend === 'ON') {
  sql += `\n  AUTOEXTEND ON NEXT ${next} MAXSIZE ${maxsize}`;
} else {
  sql += `\n  AUTOEXTEND OFF`;
}

sql += `\n  EXTENT MANAGEMENT LOCAL\n  SEGMENT SPACE MANAGEMENT AUTO`;

// ── Build audit log entry ─────────────────────────────────
const auditEntry = {
  action:          'create_tablespace',
  tablespace_name: tbsName,
  sql_command:     sql,
  datafile_path:   datafilePath,
  requested_by:    webhookData.requested_by,
  db:              webhookData.db,
  executed_at:     new Date().toISOString()
};

return [{
  json: {
    create_sql:   sql,
    tbs_name:     tbsName,
    audit_entry:  auditEntry,
    original_params: p
  }
}];
```

**Output fields produced:**

| Field | Contents |
|---|---|
| `create_sql` | The complete `CREATE TABLESPACE` SQL string |
| `tbs_name` | Uppercased, sanitized tablespace name (used in verification) |
| `audit_entry` | Structured log object for your audit table |

**Example of what `create_sql` looks like at runtime (filesystem instance):**

```sql
CREATE TABLESPACE MY_DATA
  DATAFILE '/u01/app/oracle/oradata/ORCL/my_data01.dbf' SIZE 500M
  AUTOEXTEND ON NEXT 100M MAXSIZE 10G
  EXTENT MANAGEMENT LOCAL
  SEGMENT SPACE MANAGEMENT AUTO
```

**Example (ASM / OMF instance):**

```sql
CREATE TABLESPACE MY_DATA
  DATAFILE SIZE 500M
  AUTOEXTEND ON NEXT 100M MAXSIZE 10G
  EXTENT MANAGEMENT LOCAL
  SEGMENT SPACE MANAGEMENT AUTO
```

---

### Node 3 — Oracle Node: "Execute CREATE TABLESPACE"

- **Operation:** Execute Query
- **Query field:** `{{ $json.create_sql }}`
- **Query Parameters:** *(leave empty — values are already embedded in the string)*

> **Why no bind params?** Oracle DDL (CREATE TABLESPACE) does not support parameter binding. Values must be pre-embedded in the SQL string by the Code Node.

---

### Node 4 — Oracle Query Node: "Verify Tablespace Created"

After successful execution, confirm the tablespace exists and retrieve its configuration:

- **Operation:** Execute Query
- **Query:**

```sql
SELECT
  t.tablespace_name,
  t.status,
  t.contents,
  t.extent_management,
  t.segment_space_management,
  d.file_name,
  ROUND(d.bytes / 1024 / 1024)        AS size_mb,
  d.autoextensible                     AS autoextend,
  ROUND(d.increment_by * 8192 / 1024 / 1024) AS next_mb,
  CASE
    WHEN d.maxbytes = 0 THEN 'UNLIMITED'
    ELSE TO_CHAR(ROUND(d.maxbytes / 1024 / 1024 / 1024)) || 'G'
  END                                  AS maxsize
FROM dba_tablespaces t
JOIN dba_data_files d ON d.tablespace_name = t.tablespace_name
WHERE t.tablespace_name = '{{ $('Build CREATE TABLESPACE SQL').first().json.tbs_name }}'
```

---

### Node 5 — Code Node: "Build Response"

> **Same uppercase issue as Node 2:** Oracle returns `STATUS`, `FILE_NAME`, `SIZE_MB`, etc. The code below reads both cases and normalizes rows to lowercase for the frontend.

```js
// ── Node: Build CREATE TABLESPACE Response ───────────────────

// Read Oracle column regardless of uppercase/lowercase
function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key];
    const upper = key.toUpperCase();
    const lower = key.toLowerCase();
    if (row[upper] != null && row[upper] !== '') return row[upper];
    if (row[lower] != null && row[lower] !== '') return row[lower];
  }
  return '';
}

function normalizeRow(row) {
  return {
    tablespace_name:          pick(row, 'tablespace_name'),
    status:                   pick(row, 'status'),
    contents:                 pick(row, 'contents'),
    extent_management:        pick(row, 'extent_management'),
    segment_space_management: pick(row, 'segment_space_management'),
    file_name:                pick(row, 'file_name'),
    size_mb:                  pick(row, 'size_mb'),
    autoextend:               pick(row, 'autoextend'),
    next_mb:                  pick(row, 'next_mb'),
    maxsize:                  pick(row, 'maxsize')
  };
}

const buildNode = $('Build CREATE TABLESPACE SQL').first().json;
const tbsName   = buildNode.tbs_name;

const rows         = $input.all().map(i => normalizeRow(i.json));
const tbs          = rows[0] || {};
const tablespaceStatus = String(tbs.status || '').toUpperCase();

const success = rows.length > 0 && tablespaceStatus === 'ONLINE';

const autoextendLabel =
  String(tbs.autoextend || '').toUpperCase() === 'YES' ? 'ON' :
  String(tbs.autoextend || '').toUpperCase() === 'NO'  ? 'OFF' :
  String(tbs.autoextend || '');

const summary = success
  ? `Tablespace ${tbsName} created successfully. ` +
    `Datafile: ${tbs.file_name}. ` +
    `Size: ${tbs.size_mb} MB, Autoextend: ${autoextendLabel}, MaxSize: ${tbs.maxsize}.`
  : `CREATE TABLESPACE ${tbsName} was executed but the tablespace was not found in DBA_TABLESPACES. ` +
    `Please verify manually.`;

return [{
  json: {
    status:     success ? 'success' : 'error',
    request_id: `DBA-${Date.now()}`,
    action:     'create_tablespace',
    db_status:  success ? 'healthy' : 'warning',
    ai_summary: summary,
    findings:   [],
    recommendations: success ? [] : [{
      title:    'Manual verification required',
      detail:   `Run: SELECT * FROM dba_tablespaces WHERE tablespace_name = '${tbsName}';`,
      severity: 'warning'
    }],
    raw_data: {
      rows
    },
    raw_output: success
      ? `Tablespace ${tbsName} created.\nDatafile: ${tbs.file_name}\nSize: ${tbs.size_mb}MB\nAutoextend: ${autoextendLabel}\nMaxSize: ${tbs.maxsize}`
      : `CREATE TABLESPACE command executed but verification returned no rows.`
  }
}];
```

---

### Node 6 — Respond to Webhook

Connect the Code Node output directly to a **Respond to Webhook** node.

**Standard response envelope sent back to the frontend:**

```json
{
  "status": "success",
  "request_id": "DBA-1718123456789",
  "action": "create_tablespace",
  "db_status": "healthy",
  "ai_summary": "Tablespace MY_DATA created successfully. Datafile: /u01/.../my_data01.dbf. Size: 500 MB, Autoextend: YES, MaxSize: 10G.",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "rows": [
      {
        "tablespace_name": "MY_DATA",
        "status": "ONLINE",
        "contents": "PERMANENT",
        "extent_management": "LOCAL",
        "segment_space_management": "AUTO",
        "file_name": "/u01/app/oracle/oradata/ORCL/my_data01.dbf",
        "size_mb": 500,
        "autoextend": "YES",
        "next_mb": 100,
        "maxsize": "10G"
      }
    ]
  },
  "raw_output": "Tablespace MY_DATA created.\nDatafile: /u01/.../my_data01.dbf\n..."
}
```

---

## Complete n8n Branch: Node-by-Node Summary

```
Switch (action = "create_tablespace")
  │
  ▼
[Oracle Query] "Get DB Storage Path"
  → Queries v$parameter / dba_data_files for the datafile directory
  │
  ▼
[Code Node] "Build CREATE TABLESPACE SQL"
  → Sanitizes inputs, derives datafile path, builds DDL string
  → Output: { create_sql, tbs_name, audit_entry }
  │
  ▼
[Oracle Execute] "Execute CREATE TABLESPACE"
  → Runs {{ $json.create_sql }} as a raw DDL query
  │
  ▼
[Oracle Query] "Verify Tablespace Created"
  → Selects from dba_tablespaces JOIN dba_data_files
  → Confirms tablespace is ONLINE with correct settings
  │
  ▼
[Code Node] "Build Response"
  → Formats the DbaResponse envelope
  │
  ▼
[Respond to Webhook]
  → Returns JSON to frontend application
```

---

## Troubleshooting: "Could not determine datafile path"

If Node 1 returns `DATA_DIR: C:\U01\APP\ORACLE\ORADATA\ORCL\` but the Code Node still throws this error, the cause is almost always **case mismatch**:

| What Node 1 returns | What the old Code Node read | Result |
|---|---|---|
| `DATA_DIR` (uppercase) | `$json.data_dir` (lowercase) | `undefined` → error |

**Fix:** Use the updated Code Node above with `resolveDataDir()`, which reads `DATA_DIR`, `data_dir`, and the named upstream node `Get DB Storage Path`.

**Verify in n8n:** Run Node 1 alone and inspect the output JSON keys. You should see `DATA_DIR`, not `data_dir`.

**Windows paths:** The updated Code Node normalizes `C:\U01\...\ORCL\` to `C:/U01/.../ORCL/my_data01.dbf` in the SQL string. Oracle accepts forward slashes on Windows.

### Build Response reports error even though verification shows ONLINE

If **Execute SQL3** returns `STATUS: ONLINE` but the response node still fails, the cause is the same uppercase mismatch:

| Oracle returns | Old code read | Result |
|---|---|---|
| `STATUS: ONLINE` | `tbs.status` | `undefined` → `success = false` |

**Fix:** Use the updated **Build Response** Code Node with the `pick()` / `normalizeRow()` helpers above.

---

## Error Handling

Add an **Error Trigger** node connected to all Oracle nodes. If any Oracle node throws, route it to:

### Error Code Node: "Build Error Response"

```js
const msg = $json.message || $input.first().json?.message || 'Unknown Oracle error';

return [{
  json: {
    status:     'error',
    request_id: `DBA-${Date.now()}`,
    action:     'create_tablespace',
    db_status:  'critical',
    ai_summary: `Failed to create tablespace: ${msg}`,
    findings: [{
      title:    'CREATE TABLESPACE Failed',
      detail:   msg,
      severity: 'critical'
    }],
    recommendations: [],
    raw_data:   { rows: [] },
    raw_output: msg
  }
}];
```

---

## Common ORA Errors for `create_tablespace`

| ORA Code | Meaning | Fix |
|----------|---------|-----|
| `ORA-01543` | Tablespace already exists | Check existing tablespaces before creating |
| `ORA-01119` | Error creating database file | Datafile path does not exist or is not writable |
| `ORA-01144` | File size exceeds maximum | Reduce SIZE — max 32 GB per datafile on some file systems |
| `ORA-01180` | Cannot create datafile 1 | OMF path (`db_create_file_dest`) is not set |
| `ORA-65048` | Operation not allowed on CDB root | You are connected to the CDB root; specify a PDB |
| `ORA-01031` | Insufficient privileges | n8n Oracle user needs `CREATE TABLESPACE` privilege |

---

## Switch Node Configuration Update

Add the new case to the **Tablespace** sub-router Switch node:

| Case # | Value | Branch Name |
|--------|-------|-------------|
| 1 | `tablespace_check` | Tablespace Check |
| 2 | `create_tablespace` | Create New Tablespace |

---

## Required Oracle Privilege for n8n Service Account

```sql
GRANT CREATE TABLESPACE TO n8n_service_account;
```

Or if the n8n account already has `DBA` role, no extra grant is needed.

---

## Important Notes

1. **Datafile path derivation** — The "Get DB Storage Path" node uses `v$parameter` and `dba_data_files`. Make sure the n8n Oracle user has `SELECT` on both views (included in the `DBA` role).

2. **ASM environments** — When `db_create_file_dest` starts with `+` (disk group), the Code Node generates `DATAFILE SIZE {size}` without a filename, which is the correct OMF syntax for ASM.

3. **CDB / PDB environments** — If the database is a Container Database, ensure n8n connects to the correct **PDB** service name. Creating tablespaces in CDB$ROOT is not recommended.

4. **Naming convention** — The Code Node converts `tablespace_name` to uppercase and strips non-identifier characters. The generated datafile is `{tbs_name_lowercase}01.dbf`.

5. **`EXTENT MANAGEMENT LOCAL` + `SEGMENT SPACE MANAGEMENT AUTO`** — These are Oracle best-practice defaults for all new tablespaces since Oracle 10g.
