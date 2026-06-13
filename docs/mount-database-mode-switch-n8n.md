# Change Database Mode — n8n Workflow Guide

Complete n8n implementation guide for the **Change DB Mode** button in the Oracle DBA Portal (`General Admin → Database Control`).

---

## Overview & Architecture

The **Change DB Mode** button performs a **two-phase operation**:

1. **App side** — The frontend first calls `status_database` to detect the current state and shows a smart confirmation dialog.
2. **n8n side** — When the user confirms, `mount_database` is sent to n8n. The workflow re-verifies the state, then routes to the correct SQL branch.

```
Frontend (App)                           n8n Workflow
──────────────                           ────────────
[Click "Change DB Mode"]
  │
  ├─ Call status_database ─────────────► [status_database branch]
  │   (detects OPEN / MOUNT / DOWN)           │
  │◄─────────────────────────────────────── result
  │
  ├─ Show confirmation dialog
  │   (SQL preview + detected state)
  │
  └─ User confirms
       │
       └─ Call mount_database ──────────► [mount_database branch]
                                              │
                                         [Oracle Node] Check V$INSTANCE
                                              │
                                         [Code Node] Parse state
                                              │
                                         [Switch Node] Route by state
                                         ┌───┴──────┬──────────┐
                                       OPEN       MOUNT       DOWN
                                         │           │          │
                                      SSH CMD    SSH CMD    SSH CMD
                                         │           │          │
                                         └────┬──────┘          │
                                              └────────┬─────────┘
                                                  [Code Node] Build Response
                                                       │
                                                  [Respond to Webhook]
```

---

## Webhook Payload

The app sends the following JSON to your webhook (`NEXT_PUBLIC_DBA_WEBHOOK_URL`):

```json
{
  "action": "mount_database",
  "db": "ORCL",
  "params": {},
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Linux",
  "db_type": "Standalone"
}
```

---

## n8n Branch Entry Point

In your main router **Switch node**, add a case for `mount_database`:

| Case | Condition | Branch |
|------|-----------|--------|
| N | `{{ $json.body.action === "mount_database" }}` | Change DB Mode |

---

## Node-by-Node Implementation

### Node 1 — Oracle Database Node: "Check DB Status"

This node queries `V$INSTANCE` to get the current database status.  
Set **Continue On Fail = true** — if the database is completely down, this node will fail, which the Code Node interprets as `DOWN`.

- **Operation:** Execute Query
- **Query:**

```sql
SELECT STATUS FROM V$INSTANCE
```

> **Why Oracle node?** If the instance is started (even in NOMOUNT or MOUNT), sqlplus can connect. Only a fully stopped instance causes a connection failure, which surfaces as a node error.

**Output when DB is OPEN:**

```json
{ "STATUS": "OPEN" }
```

**Output when DB is MOUNTED:**

```json
{ "STATUS": "MOUNTED" }
```

**Output when DB is DOWN:**

> Node throws an error — `ORA-01034: ORACLE not available` (caught by Continue On Fail)

---

### Node 2 — Code Node: "Determine DB State"

Add a **Code Node** connected to the Oracle node output.  
This node normalizes the result into a clean `db_state` string.

```js
// ── Node: Determine DB State ─────────────────────────────────────────────────

// Pull Oracle query result (may be null/error if DB is down)
let oracleRow = null;
try {
  oracleRow = $('Check DB Status').first()?.json ?? null;
} catch (e) {
  oracleRow = null;
}

// Read STATUS column (Oracle returns uppercase column names)
const rawStatus = oracleRow
  ? String(oracleRow.STATUS ?? oracleRow.status ?? '').trim().toUpperCase()
  : '';

// Also check if the Oracle node itself errored (db_state = DOWN)
const nodeError = $('Check DB Status').first()?.json?.error ?? null;
const hasError = !!nodeError || rawStatus === '';

// Determine state
let db_state;
if (hasError || rawStatus.includes('ORA-01034') || rawStatus === '') {
  db_state = 'DOWN';
} else if (rawStatus === 'OPEN') {
  db_state = 'OPEN';
} else if (rawStatus === 'MOUNTED') {
  db_state = 'MOUNT';
} else if (rawStatus === 'STARTED') {
  // NOMOUNT — treat as DOWN for our purposes
  db_state = 'DOWN';
} else {
  db_state = 'UNKNOWN';
}

// Pull webhook context
const webhookData = $('DBA Webhook Entry').first().json;

return [{
  json: {
    db_state,
    raw_status: rawStatus,
    db: webhookData.body?.db ?? webhookData.db,
    requested_by: webhookData.body?.requested_by ?? webhookData.requested_by,
    action: 'mount_database',
    detected_at: new Date().toISOString()
  }
}];
```

**Output fields produced:**

| Field | Contents |
|---|---|
| `db_state` | `"OPEN"`, `"MOUNT"`, `"DOWN"`, or `"UNKNOWN"` |
| `raw_status` | Raw Oracle status string |
| `db` | Database name from webhook |
| `requested_by` | User who triggered the action |

---

### Node 3 — Switch Node: "Route by DB State"

Connect the Code Node output to a **Switch node** with these cases:

| Output # | Case Name | Condition |
|----------|-----------|-----------|
| 0 | OPEN → MOUNT | `{{ $json.db_state === "OPEN" }}` |
| 1 | MOUNT → OPEN | `{{ $json.db_state === "MOUNT" }}` |
| 2 | DOWN → MOUNT | `{{ $json.db_state === "DOWN" }}` |
| 3 | Unknown fallback | *(Fallback output — no condition)* |

---

### Branch A — DB is OPEN → Shutdown + Mount

#### Node A1 — SSH Execute Command: "Shutdown + Startup Mount"

- **Node Type:** SSH
- **Command:**

```bash
source ~/.bash_profile && sqlplus -s / as sysdba <<EOF
SHUTDOWN IMMEDIATE;
STARTUP MOUNT;
EXIT;
EOF
```

> `SHUTDOWN IMMEDIATE` performs a clean shutdown (rolls back uncommitted transactions, disconnects users). `STARTUP MOUNT` then opens the control file without mounting datafiles.

---

### Branch B — DB is MOUNTED → Open

#### Node B1 — SSH Execute Command: "Open Database"

- **Node Type:** SSH
- **Command:**

```bash
source ~/.bash_profile && sqlplus -s / as sysdba <<EOF
ALTER DATABASE OPEN;
EXIT;
EOF
```

> `ALTER DATABASE OPEN` opens the datafiles and makes the database accessible to users.

---

### Branch C — DB is DOWN → Startup Mount

#### Node C1 — SSH Execute Command: "Startup Mount"

- **Node Type:** SSH
- **Command:**

```bash
source ~/.bash_profile && sqlplus -s / as sysdba <<EOF
STARTUP MOUNT;
EXIT;
EOF
```

> `STARTUP MOUNT` starts the Oracle instance and mounts the database (opens control file) without opening datafiles.

---

### Node 4 — Code Node: "Build Response"

Merge all three SSH branch outputs into a single **Code Node** (connect all three SSH nodes to this node).

```js
// ── Node: Build Mount Response ────────────────────────────────────────────────

// Get the SSH output from whichever branch ran
const sshOutput = String($input.first()?.json?.stdout ?? $input.first()?.json?.output ?? '').trim();
const sshStderr = String($input.first()?.json?.stderr ?? '').trim();

// Get state context from the Determine DB State node
const stateData = $('Determine DB State').first().json;
const db_state  = String(stateData.db_state ?? 'UNKNOWN');
const db        = String(stateData.db ?? '');

// Check for ORA- errors in output
const hasOraError = /ORA-\d{5}/.test(sshOutput) || /ORA-\d{5}/.test(sshStderr);
const hasSuccess  = !hasOraError && (
  sshOutput.toLowerCase().includes('database mounted') ||
  sshOutput.toLowerCase().includes('database opened') ||
  sshOutput.toLowerCase().includes('database closed') ||
  sshOutput.toLowerCase().includes('database dismounted')
);

// Build human-readable summary
let actionTaken, expectedResult;
if (db_state === 'OPEN') {
  actionTaken    = 'SHUTDOWN IMMEDIATE + STARTUP MOUNT';
  expectedResult = 'Database is now in MOUNT state (control file open, datafiles closed)';
} else if (db_state === 'MOUNT') {
  actionTaken    = 'ALTER DATABASE OPEN';
  expectedResult = 'Database is now OPEN and accessible to users';
} else {
  actionTaken    = 'STARTUP MOUNT';
  expectedResult = 'Database is now in MOUNT state (started from DOWN)';
}

const status    = hasOraError ? 'error' : 'success';
const db_status = hasOraError ? 'warning' : 'healthy';

const errorDetail = hasOraError
  ? (sshOutput.match(/ORA-\d{5}[^\n]*/)?.[0] ?? sshStderr || 'ORA error detected')
  : null;

const ai_summary = hasOraError
  ? `Mode switch FAILED on ${db}. Action attempted: ${actionTaken}. Error: ${errorDetail}`
  : `Mode switch COMPLETED on ${db}. Action taken: ${actionTaken}. ${expectedResult}.`;

const raw_output = [
  `[State at trigger time] ${db_state}`,
  `[Action executed]       ${actionTaken}`,
  '',
  '── Command Output ──────────────────────────',
  sshOutput || '(no stdout)',
  sshStderr ? `\n── STDERR ──\n${sshStderr}` : ''
].join('\n').trim();

return [{
  json: {
    status,
    request_id: `DBA-${Date.now()}`,
    action:     'mount_database',
    db_status,
    ai_summary,
    findings:   hasOraError ? [{
      title:    'Mode Switch Error',
      detail:   errorDetail,
      severity: 'critical'
    }] : [],
    recommendations: hasOraError ? [{
      title:  'Check alert log',
      detail: `Review /oracle/diag/rdbms/.../alert_${db}.log for full error context.`,
      severity: 'warning'
    }] : [],
    raw_data:   { rows: [] },
    raw_output
  }
}];
```

---

### Node 5 — Respond to Webhook

Connect the **Build Response** Code Node to a **Respond to Webhook** node.

**Standard response sent back to the frontend:**

```json
{
  "status": "success",
  "request_id": "DBA-1718123456789",
  "action": "mount_database",
  "db_status": "healthy",
  "ai_summary": "Mode switch COMPLETED on ORCL. Action taken: SHUTDOWN IMMEDIATE + STARTUP MOUNT. Database is now in MOUNT state.",
  "findings": [],
  "recommendations": [],
  "raw_data": { "rows": [] },
  "raw_output": "[State at trigger time] OPEN\n[Action executed] SHUTDOWN IMMEDIATE + STARTUP MOUNT\n\n── Command Output ──\nDatabase closed.\nDatabase dismounted.\nORACLE instance shut down.\nORACLE instance started.\n...\nDatabase mounted."
}
```

---

## Complete Node Map

```
Switch (action = "mount_database")
  │
  ▼
[Oracle Node] "Check DB Status"                 ← Continue On Fail = true
  → SELECT STATUS FROM V$INSTANCE
  │ (error if DB is down)
  ▼
[Code Node] "Determine DB State"
  → db_state = "OPEN" | "MOUNT" | "DOWN" | "UNKNOWN"
  │
  ▼
[Switch Node] "Route by DB State"
  ├─ Case 0: db_state === "OPEN"   ──► [SSH] "Shutdown + Startup Mount"
  │                                         source ~/.bash_profile && sqlplus -s / as sysdba <<EOF
  │                                         SHUTDOWN IMMEDIATE;
  │                                         STARTUP MOUNT;
  │                                         EXIT;
  │                                         EOF
  │
  ├─ Case 1: db_state === "MOUNT"  ──► [SSH] "Open Database"
  │                                         source ~/.bash_profile && sqlplus -s / as sysdba <<EOF
  │                                         ALTER DATABASE OPEN;
  │                                         EXIT;
  │                                         EOF
  │
  ├─ Case 2: db_state === "DOWN"   ──► [SSH] "Startup Mount"
  │                                         source ~/.bash_profile && sqlplus -s / as sysdba <<EOF
  │                                         STARTUP MOUNT;
  │                                         EXIT;
  │                                         EOF
  │
  └─ Fallback ────────────────────────────────────────────────────────┐
                                                                       │
  ◄──────────────────── All SSH branches merge here ──────────────────┘
  │
  ▼
[Code Node] "Build Response"
  → Normalizes SSH stdout/stderr into DbaResponse envelope
  │
  ▼
[Respond to Webhook]
  → Returns JSON to frontend
```

---

## Error Handling

### ORA-01034 / Connection Failure

If the Oracle node fails (DB is down), **Continue On Fail = true** lets the workflow continue. The Code Node in Node 2 detects the empty/error result and sets `db_state = "DOWN"`, routing to the `STARTUP MOUNT` SSH branch.

### SSH Errors

Connect all SSH nodes to an **Error Trigger** node as a fallback. Route it to a dedicated error Code Node:

```js
// ── Error Code Node ──────────────────────────────────────────────────────────
const msg = $json.message || $input.first()?.json?.message || 'SSH execution failed';
const stateData = $('Determine DB State').first()?.json ?? {};

return [{
  json: {
    status:     'error',
    request_id: `DBA-${Date.now()}`,
    action:     'mount_database',
    db_status:  'critical',
    ai_summary: `Mount mode switch failed: ${msg}`,
    findings: [{
      title:    'SSH Execution Error',
      detail:   msg,
      severity: 'critical'
    }],
    recommendations: [{
      title:  'Manual intervention required',
      detail: `SSH to the Oracle host and check: SELECT STATUS FROM V\\$INSTANCE; or ps -ef | grep pmon`,
      severity: 'critical'
    }],
    raw_data:   { rows: [] },
    raw_output: msg
  }
}];
```

---

## SSH Node Configuration

For each SSH Execute Command node, configure:

| Setting | Value |
|---------|-------|
| Host | `{{ $('DBA Webhook Entry').first().json.body.db }}` or your Oracle host IP |
| Username | `oracle` (OS user that owns the Oracle installation) |
| Authentication | SSH Key or Password (stored in n8n Credential) |
| Command | *(see each branch above)* |

> **`source ~/.bash_profile`** — This is critical. It sets `$ORACLE_HOME`, `$ORACLE_SID`, and `$PATH` so that `sqlplus` is found and connects to the correct instance.

---

## DB State Logic Summary

| Current State | Action Executed | Expected Result |
|---|---|---|
| `OPEN` | `SHUTDOWN IMMEDIATE` → `STARTUP MOUNT` | Database goes to MOUNT state |
| `MOUNT` (MOUNTED) | `ALTER DATABASE OPEN` | Database opens fully (READ WRITE) |
| `DOWN` / `STARTED` | `STARTUP MOUNT` | Database starts in MOUNT state |
| `UNKNOWN` | *(fallback — no-op / error)* | Error response returned to app |

---

## Oracle Node Setup Tip

For the **Check DB Status** Oracle node, make sure:

1. **Credential** — Points to the Oracle instance via `/ as sysdba` (OS authentication) or a SYSDBA-privileged user.
2. **Continue On Fail** — Set to **true** (essential for detecting the DOWN state).
3. **Query** — Use exactly: `SELECT STATUS FROM V$INSTANCE`

Oracle returns the column name as `STATUS` (uppercase). The Code Node reads both `STATUS` and `status` for safety.

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `ORA-01034: ORACLE not available` | DB is down, Oracle node fails | Handled automatically — `Continue On Fail` routes to DOWN branch |
| `ORA-01109: database not open` | DB is in MOUNT state, DDL query blocked | Expected — Code node reads MOUNTED from V$INSTANCE |
| `ORA-01012: not logged on` | Session expired mid-operation | Re-run; add retry logic in SSH node |
| `bash: sqlplus: command not found` | `~/.bash_profile` not sourced or wrong Oracle user | Verify `source ~/.bash_profile` sets `$ORACLE_HOME/bin` in `$PATH` |
| `ORA-16004: backup database requires recovery` | Datafiles need recovery before OPEN | Must recover datafiles first: `RECOVER DATABASE;` then `ALTER DATABASE OPEN;` |
| `ORA-01507: database not mounted` | Tried `ALTER DATABASE OPEN` when DB is DOWN | State detection mismatch — re-check `V$INSTANCE` |
