# DB Start / Stop — Audit Compliance n8n Workflow Guide

Complete n8n implementation guide for **Oracle audit compliance checks** integrated into the
`stop_database` and `start_database` actions in the Oracle DBA Portal
(`General Admin → Database Control`).

> **Scope:** PRODUCTION databases only (`environment === "PROD"`).  
> All other environments (DEV, UAT, DR) bypass the audit gate and follow the original
> start / stop flow unchanged.

---

## Background & Purpose

Oracle PROD databases run with a **read-only pfile** (no spfile).  
This prevents anyone from using `ALTER SYSTEM` to change parameters dynamically.
To **prove** this control is always in place, five audit parameters are captured
**before every shutdown** and **verified before every open** — entirely inside n8n.

**Architecture:**
- n8n fetches the 5 audit parameter values from `V$PARAMETER` and returns them to the app inside the webhook response (`raw_data.audit_snapshot`).
- The **application** receives these values and inserts one row into the Oracle `db_reboot_history` table.
- n8n does **not** write to any database. No Postgres node is required.

### The Five Audit Parameters

| Parameter | Expected Value | Why it matters |
|---|---|---|
| **Date & Time** (`SYSDATE`) | Current timestamp | Timestamped evidence trail |
| **spfile** | *blank / empty* | Blank = no spfile → dynamic `ALTER SYSTEM` changes are impossible |
| **audit_sys_operations** | `TRUE` | SYS operations are audited |
| **audit_trail** | `DB, EXTENDED` | Full DB audit trail with bind variables |
| **db_name** | Any non-empty value | Identifies the database |

A compliance check **fails** if any of:
- `spfile` value is **not blank**
- `audit_sys_operations` ≠ `TRUE`
- `audit_trail` ≠ `DB, EXTENDED` (or `DB_EXTENDED`)

---

## Architecture Overview

### Stop Database — Pre-Shutdown Audit

```
App → Webhook (action="stop_database", environment="PROD")
         │
    [IF] environment === "PROD"?
    ├── NO  (DEV/UAT/DR) → existing SSH Shutdown → Respond
    └── YES (PROD)
              │
         [Oracle Node] Query V$PARAMETER for 5 audit params (DB is OPEN)
              │
         [SSH Node] Execute SHUTDOWN <option>  ← existing node
              │
         [Code Node] Build response — embed audit snapshot in raw_data.audit_snapshot
              │
         [Respond to Webhook]
                        │
                   App receives response
                   → extracts raw_data.audit_snapshot
                   → inserts into Oracle db_reboot_history (event_type = PRE_SHUTDOWN)
```

### Start Database — Post-Mount Audit + Compliance Gate

```
App → Webhook (action="start_database", environment="PROD")
         │
    [IF] environment === "PROD"?
    ├── NO  (DEV/UAT/DR) → existing SSH STARTUP → Respond
    └── YES (PROD)
              │
         [SSH Node] STARTUP MOUNT  (instance → MOUNT state)
              │
         [Oracle Node] Query V$PARAMETER for 5 audit params (DB in MOUNT)
              │
         [Code Node] Validate compliance → build verdict + failure list
              │
         [IF Node] All params compliant?
         │
         ├── YES ──► [SSH Node] ALTER DATABASE OPEN
         │                │
         │           [Code Node] Build success response
         │                │
         │           [Respond ✅]   ← App inserts POST_MOUNT_COMPLIANT row
         │
         └── NO  ──► [SSH Node] SHUTDOWN ABORT
                          │
                     [Code Node] Build failure response (status: "error")
                          │
                     [Respond ❌]   ← App inserts POST_MOUNT_FAILED row
```

---

## Webhook Payload Reference

The app sends this JSON for both actions (no changes needed):

```json
{
  "action": "stop_database",
  "db": "ORCL",
  "params": { "shutdown_option": "IMMEDIATE" },
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Linux",
  "db_type": "Standalone"
}
```

**n8n expression shortcuts:**

| Value needed | n8n Expression |
|---|---|
| Action | `{{ $json.body.action }}` |
| DB name | `{{ $json.body.db }}` |
| Environment | `{{ $json.body.environment }}` |
| Shutdown option | `{{ $json.body.params.shutdown_option ?? 'IMMEDIATE' }}` |

---

## Required n8n Credential

**Oracle DB credential** — must be able to connect to the PROD database while it is in **MOUNT state** (for the `start_database` branch). This typically requires the **SYSDBA role**. The application schema user cannot connect in MOUNT state.

No Postgres credential is needed. The application handles all database writes.

---

## Node-by-Node Implementation

---

### ══ STOP DATABASE BRANCH ═══════════════════════════════════════════

#### Entry Point

In your **main Switch node**, the existing `stop_database` case routes here.
Insert the new nodes *before* the existing SSH Shutdown node.

---

#### Stop Node 1 — IF Node: `IF — PROD Only [Stop]`

| Setting | Value |
|---|---|
| Name | `IF — PROD Only [Stop]` |
| Condition | `{{ $json.body.environment === "PROD" }}` |
| TRUE | → Stop Node 2 (Oracle fetch) |
| FALSE | → *existing SSH Shutdown node* (bypass audit) |

---

#### Stop Node 2 — Oracle Database Node: `Oracle — Fetch Audit Params [Pre-Shutdown]`

| Setting | Value |
|---|---|
| Name | `Oracle — Fetch Audit Params [Pre-Shutdown]` |
| Credential | Your PROD Oracle credential |
| Operation | Execute Query |
| Continue On Fail | `true` |

**Query:**

```sql
SELECT
  TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')               AS CAPTURED_AT,
  (SELECT VALUE FROM V$PARAMETER WHERE NAME = 'spfile')          AS SPFILE_VALUE,
  (SELECT VALUE FROM V$PARAMETER WHERE NAME = 'audit_sys_operations') AS AUDIT_SYS_OPS,
  (SELECT VALUE FROM V$PARAMETER WHERE NAME = 'audit_trail')     AS AUDIT_TRAIL,
  (SELECT VALUE FROM V$PARAMETER WHERE NAME = 'db_name')         AS DB_NAME
FROM DUAL
```

> **Why `V$PARAMETER` and not `SHOW PARAMETER`?**  
> `SHOW PARAMETER` is a SQL*Plus interactive command — it is **not valid SQL** and will fail
> in the n8n Oracle node. `V$PARAMETER` is the underlying view; it works perfectly in any SQL context.

**Expected output (compliant DB):**

```json
{
  "CAPTURED_AT": "2026-08-05T19:52:05Z",
  "SPFILE_VALUE": "",
  "AUDIT_SYS_OPS": "TRUE",
  "AUDIT_TRAIL": "DB, EXTENDED",
  "DB_NAME": "ORCL"
}
```

---

#### Stop Node 3 — SSH Node: `SSH — Shutdown Database` *(existing node)*

Wire Stop Node 2 output → existing SSH Shutdown node. No changes.

**Command reference:**

```bash
echo "SHUTDOWN {{ $('Webhook').first().json.body.params.shutdown_option ?? 'IMMEDIATE' }};" \
  | sqlplus -S / as sysdba
```

---

#### Stop Node 4 — Code Node: `Code — Build Stop Response`

| Setting | Value |
|---|---|
| Name | `Code — Build Stop Response` |
| Language | JavaScript |
| Mode | Run Once for All Items |

**Code:**

```javascript
// Audit snapshot from Oracle node (may be empty if DB was not reachable)
const oracleRow = $('Oracle — Fetch Audit Params [Pre-Shutdown]').first()?.json ?? {};
const body      = $('Webhook').first().json.body;
const sshOutput = $input.first().json.stdout ?? $input.first().json.stderr ?? "(no output)";

// Pass the raw V$PARAMETER values exactly as returned by the Oracle node.
// The application will extract these from raw_data.audit_snapshot and
// insert them into the Oracle db_reboot_history table.
const auditSnapshot = {
  CAPTURED_AT:    oracleRow.CAPTURED_AT  ?? new Date().toISOString(),
  SPFILE_VALUE:   oracleRow.SPFILE_VALUE ?? "",
  AUDIT_SYS_OPS:  oracleRow.AUDIT_SYS_OPS  ?? "",
  AUDIT_TRAIL:    oracleRow.AUDIT_TRAIL    ?? "",
  DB_NAME:        oracleRow.DB_NAME        ?? body.db ?? ""
};

return [{
  json: {
    status:      "success",
    request_id:  `stop-${Date.now()}`,
    action:      "stop_database",
    db_status:   "unknown",
    ai_summary:  `Database ${body.db} shutdown (${body.params?.shutdown_option ?? "IMMEDIATE"}) executed. Audit snapshot captured.`,
    findings:    [],
    recommendations: [],
    raw_output:  sshOutput,
    raw_data: {
      // ← The app reads this field to insert into db_reboot_history
      audit_snapshot: auditSnapshot
    }
  }
}];
```

---

#### Stop Node 5 — Respond to Webhook *(existing node)*

Wire Stop Node 4 → Respond to Webhook. Return `{{ $json }}` with HTTP status `200`.

---

### ══ START DATABASE BRANCH ══════════════════════════════════════════

#### Entry Point

In your **main Switch node**, the existing `start_database` case routes here.

---

#### Start Node 1 — IF Node: `IF — PROD Only [Start]`

| Setting | Value |
|---|---|
| Name | `IF — PROD Only [Start]` |
| Condition | `{{ $json.body.environment === "PROD" }}` |
| TRUE | → Start Node 2 (SSH STARTUP MOUNT) |
| FALSE | → *existing SSH STARTUP node* (bypass audit) |

---

#### Start Node 2 — SSH Node: `SSH — STARTUP MOUNT`

| Setting | Value |
|---|---|
| Name | `SSH — STARTUP MOUNT` |
| Continue On Fail | `false` |

**Command:**

```bash
echo "STARTUP MOUNT;" | sqlplus -S / as sysdba
```

**Why MOUNT first?** In MOUNT state `V$PARAMETER` is fully populated — all 5 audit parameters are visible. The database is not yet open to users, so the compliance check is safe.

---

#### Start Node 3 — SSH Node: `SSH — Fetch Audit Params [Post-Mount]`

| Setting | Value |
|---|---|
| Name | `SSH — Fetch Audit Params [Post-Mount]` |
| Credential | Your SSH credential |
| Command | Execute Command (PowerShell or Bash) |
| Continue On Fail | `true` |

> **Why SSH instead of Oracle DB node in MOUNT mode?**  
> In MOUNT state, standard Oracle JDBC/thin connections via port 1521 fail to execute SQL statements. Running `sqlplus -s / as sysdba` over SSH connects via OS authentication and executes SQL directly against `V$PARAMETER` while the instance is mounted.

**PowerShell Command:**

```powershell
$env:ORACLE_SID='{{ $('Webhook').first().json.body.db }}'; @("SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF ECHO OFF TRIMSPOOL ON", "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD""T""HH24:MI:SS""Z""') || '|||' || NVL((SELECT VALUE FROM V`$PARAMETER WHERE NAME = 'spfile'), '') || '|||' || NVL((SELECT VALUE FROM V`$PARAMETER WHERE NAME = 'audit_sys_operations'), '') || '|||' || NVL((SELECT VALUE FROM V`$PARAMETER WHERE NAME = 'audit_trail'), '') || '|||' || NVL((SELECT VALUE FROM V`$PARAMETER WHERE NAME = 'db_name'), '') FROM DUAL;", "EXIT;") | sqlplus -s / as sysdba
```

*(Linux Bash command equivalent if target OS is Linux):*

```bash
ORACLE_SID={{ $('Webhook').first().json.body.db }} sqlplus -s / as sysdba << 'EOF'
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF ECHO OFF TRIMSPOOL ON
SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '|||' || NVL((SELECT VALUE FROM V$PARAMETER WHERE NAME = 'spfile'), '') || '|||' || NVL((SELECT VALUE FROM V$PARAMETER WHERE NAME = 'audit_sys_operations'), '') || '|||' || NVL((SELECT VALUE FROM V$PARAMETER WHERE NAME = 'audit_trail'), '') || '|||' || NVL((SELECT VALUE FROM V$PARAMETER WHERE NAME = 'db_name'), '') FROM DUAL;
EXIT;
EOF
```

---

#### Start Node 4 — Code Node: `Code — Validate Audit Compliance`

| Setting | Value |
|---|---|
| Name | `Code — Validate Audit Compliance` |
| Language | JavaScript |

**Code:**

```javascript
const sshItem = $input.first()?.json ?? {};
const stdout  = sshItem.stdout ?? "";
const body    = $('Webhook').first().json.body;

// Parse sqlplus stdout output separated by '|||'
// Replacing newlines handles sqlplus line wrapping across lines cleanly
const cleanStdout = stdout.replace(/[\r\n]+/g, "").trim();
const parts       = cleanStdout.split("|||");

const capturedAt  = (parts[0] ?? "").trim() || new Date().toISOString();
const spfileValue = (parts[1] ?? "").trim();
const auditSysOps = (parts[2] ?? "").trim().toUpperCase();
const auditTrail  = (parts[3] ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const dbName      = (parts[4] ?? body.db ?? "").trim();

// ── Compliance rules ──────────────────────────────────────────────
const spfileCompliant  = spfileValue === "";
const sysOpsCompliant  = auditSysOps === "TRUE";
const trailCompliant   = ["DB, EXTENDED", "DB_EXTENDED"].includes(auditTrail);
const isCompliant      = spfileCompliant && sysOpsCompliant && trailCompliant;

// ── Human-readable failures ───────────────────────────────────────
const failures = [];
if (!spfileCompliant)
  failures.push(`spfile="${spfileValue}" — must be blank (prevents dynamic param changes)`);
if (!sysOpsCompliant)
  failures.push(`audit_sys_operations="${auditSysOps}" — expected TRUE`);
if (!trailCompliant)
  failures.push(`audit_trail="${auditTrail}" — expected "DB, EXTENDED"`);

// The raw values are passed to both branches via this structure.
// The app reads raw_data.audit_snapshot and writes to db_reboot_history.
const auditSnapshot = {
  CAPTURED_AT:   capturedAt,
  SPFILE_VALUE:  spfileValue,
  AUDIT_SYS_OPS: auditSysOps,
  AUDIT_TRAIL:   auditTrail,
  DB_NAME:       dbName
};

return [{ json: { auditSnapshot, isCompliant, failures, body } }];
```

---

#### Start Node 5 — IF Node: `IF — Audit Compliant? [Start Gate]`

| Setting | Value |
|---|---|
| Name | `IF — Audit Compliant? [Start Gate]` |
| Condition | `{{ $json.isCompliant === true }}` |
| TRUE | → Start Node 6 (ALTER DATABASE OPEN) |
| FALSE | → Start Node 8 (Emergency SHUTDOWN ABORT) |

---

### ─── TRUE PATH (Compliant) ───────────────────────────────────────────

#### Start Node 6 — SSH Node: `SSH — ALTER DATABASE OPEN`

```bash
echo "ALTER DATABASE OPEN;" | sqlplus -S / as sysdba
```

---

#### Start Node 7 — Code Node: `Code — Build Start Success Response`

```javascript
const { auditSnapshot, body } = $('Code — Validate Audit Compliance').first().json;
const sshOutput = $input.first().json.stdout ?? "(no output)";

return [{
  json: {
    status:      "success",
    request_id:  `start-${Date.now()}`,
    action:      "start_database",
    db_status:   "healthy",
    ai_summary:  `✅ Database ${body.db} is now OPEN. All 5 audit compliance parameters verified.`,
    findings:    [],
    recommendations: [],
    raw_output:  sshOutput,
    raw_data: {
      // ← App reads this to insert POST_MOUNT_COMPLIANT row in db_reboot_history
      audit_snapshot: auditSnapshot
    }
  }
}];
```

---

### ─── FALSE PATH (Non-Compliant) ────────────────────────────────────

#### Start Node 8 — SSH Node: `SSH — Emergency SHUTDOWN ABORT`

| Setting | Value |
|---|---|
| Continue On Fail | `true` ← critical: must not block the error response |

```bash
echo "SHUTDOWN ABORT;" | sqlplus -S / as sysdba
```

> **Why ABORT?** The DB is in MOUNT state — no users are connected, no transactions open.  
> ABORT is instantaneous. The next startup will auto-recover via redo logs.

---

#### Start Node 9 — Code Node: `Code — Build Start Failure Response`

```javascript
const { auditSnapshot, failures, body } = $('Code — Validate Audit Compliance').first().json;

const failureLines = failures.map((f, i) => `  ${i + 1}. ${f}`).join("\n");

const rawOutput = [
  "╔══════════════════════════════════════════════════════════════╗",
  "║          ⛔  STARTUP ABORTED — AUDIT COMPLIANCE FAILURE      ║",
  "╚══════════════════════════════════════════════════════════════╝",
  "",
  `  Database    : ${body.db}`,
  `  Environment : ${body.environment}`,
  `  Checked at  : ${auditSnapshot.CAPTURED_AT}`,
  "",
  "FAILED COMPLIANCE CHECKS:",
  failureLines,
  "",
  "AUDIT PARAMETERS CAPTURED:",
  `  spfile               = ${auditSnapshot.SPFILE_VALUE || "(blank)"}`,
  `  audit_sys_operations = ${auditSnapshot.AUDIT_SYS_OPS}`,
  `  audit_trail          = ${auditSnapshot.AUDIT_TRAIL}`,
  `  db_name              = ${auditSnapshot.DB_NAME}`,
  "",
  "NOTE: A blank value of spfile prevents dynamic changes of DB params.",
  "",
  "ACTION TAKEN : SHUTDOWN ABORT issued. Database is now DOWN.",
  "NEXT STEPS   : Fix the init.ora / pfile on the server and retry."
].join("\n");

return [{
  json: {
    // Return HTTP 200 with status:"error" — the app renders this in the
    // Console Output panel as a red error block with the full failure report.
    // Returning HTTP 4xx/5xx would hide the detailed message behind a generic error.
    status:      "error",
    request_id:  `start-failed-${Date.now()}`,
    action:      "start_database",
    db_status:   "critical",
    ai_summary:  `⛔ Startup aborted: audit compliance check failed for ${body.db}. ${failures[0] ?? ""}`,
    findings: failures.map((f, i) => ({
      id:       `audit-fail-${i + 1}`,
      title:    "Audit Compliance Failure",
      detail:   f,
      severity: "critical"
    })),
    recommendations: [{
      title:  "Fix pfile / init.ora on the server",
      detail: "Do NOT use a spfile on PROD. Set audit_sys_operations=TRUE and audit_trail=DB,EXTENDED in the pfile."
    }],
    raw_output: rawOutput,
    raw_data: {
      // ← App reads this to insert POST_MOUNT_FAILED row in db_reboot_history
      audit_snapshot:      auditSnapshot,
      compliance_failures: failures
    }
  }
}];
```

---

#### Start Node 10 — Respond to Webhook

Wire both Start Node 7 (success) and Start Node 9 (failure) → same Respond to Webhook node.  
Return `{{ $json }}` with HTTP status **`200`** for both paths.

---

## Application Behaviour

After n8n responds, the application (`app/api/dba/actions/route.ts`) automatically:

1. Extracts `result.raw_data.audit_snapshot` from the n8n response.
2. Computes `is_compliant` from the 5 raw values.
3. Determines `event_type`:
   - `stop_database` → `PRE_SHUTDOWN`
   - `start_database` + `result.status === "success"` → `POST_MOUNT_COMPLIANT`
   - `start_database` + `result.status === "error"` → `POST_MOUNT_FAILED`
4. Inserts one row into the Oracle **`db_reboot_history`** table (non-blocking — insert failure is logged, not thrown).

### Failure Display in UI

When `start_database` returns `status: "error"`:
- Console Output panel turns **red**
- The ⛔ failure block is shown verbatim from `raw_output`
- `ai_summary` is displayed as the headline

The **Reboot History** button (indigo, visible only for PROD databases) in General Admin →
Database Control opens a modal showing all historical reboot events with compliance status.

---

## Oracle `db_reboot_history` Table DDL

See [`db/oracle_reboot_history.sql`](../db/oracle_reboot_history.sql).

Run once against the **Oracle application database** (not n8n's database) as the application
schema owner before deploying.

---

## Complete n8n Wiring Diagram

```
[Main Switch Node]
       │
       ├── stop_database
       │        │
       │   [IF — PROD Only [Stop]]
       │        ├── FALSE ──► [existing SSH Shutdown] ──► [Respond]
       │        └── TRUE
       │                 │
       │        [Oracle — Fetch Audit Params [Pre-Shutdown]]
       │                 │
       │        [SSH — Shutdown Database]  ← existing node, rewired
       │                 │
       │        [Code — Build Stop Response]  ← embeds audit_snapshot in raw_data
       │                 │
       │        [Respond to Webhook HTTP 200]
       │
       └── start_database
                │
           [IF — PROD Only [Start]]
                ├── FALSE ──► [existing SSH STARTUP] ──► [Respond]
                └── TRUE
                          │
                [SSH — STARTUP MOUNT]
                          │
                [Oracle — Fetch Audit Params [Post-Mount]]
                          │
                [Code — Validate Audit Compliance]
                          │
                [IF — Audit Compliant?]
                          │
              TRUE ───────┴──────── FALSE
                │                       │
      [SSH — ALTER DATABASE OPEN]  [SSH — Emergency SHUTDOWN ABORT]
                │                       │
      [Code — Build Start          [Code — Build Start
       Success Response]            Failure Response]
                │                       │
      [Respond HTTP 200 ✅]        [Respond HTTP 200 ❌]
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Oracle node fails in MOUNT state | Credential lacks SYSDBA role | Configure n8n Oracle credential with SYSDBA role |
| `SPFILE_VALUE` shows a path | spfile is in use | Remove spfile; use pfile (init.ora) at startup |
| `AUDIT_TRAIL` shows `DB` not `DB, EXTENDED` | Wrong init.ora value | Set `audit_trail = DB,EXTENDED` in init.ora |
| App shows "Unknown error" on failure | n8n returned HTTP 4xx/5xx | Ensure Respond to Webhook returns HTTP `200` always |
| `audit_snapshot` missing from `raw_data` | Code node not running / wrong path | Check n8n execution log; ensure Code node runs before Respond |
| No rows in `db_reboot_history` | Table not created or `audit_snapshot` key missing | Run `db/oracle_reboot_history.sql`; verify n8n response `raw_data.audit_snapshot` key |

---

## Related Documentation

- [`mount-database-mode-switch-n8n.md`](./mount-database-mode-switch-n8n.md) — Change DB Mode workflow
- [`dba-console-n8n-workflow.md`](./dba-console-n8n-workflow.md) — Shift login/logout webhook events
- [`db/oracle_reboot_history.sql`](../db/oracle_reboot_history.sql) — Oracle DDL for the `db_reboot_history` table
