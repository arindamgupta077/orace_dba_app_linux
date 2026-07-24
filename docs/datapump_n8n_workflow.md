# n8n Data Pump Workflow Reference

This document provides all JavaScript code node contents for the Oracle Data Pump n8n workflow.

---

## Workflow Structure

```
Webhook Trigger (POST)
  ├── [Route by action]
  │     ├── action == "expdp"          → EXPDP Branch
  │     ├── action == "fetch_dump"     → FETCH DUMP Branch
  │     ├── action == "impdp"          → IMPDP Branch
  │     ├── action == "expdp_check_log" → Check EXPDP Log
  │     └── action == "impdp_check_log" → Check IMPDP Log
```

---

## Node 1: `Route by action` (Switch node)

| Condition | Value | Next |
|-----------|-------|------|
| `$json.action` equals | `expdp` | EXPDP Branch |
| `$json.action` equals | `fetch_dump` | FETCH DUMP Branch |
| `$json.action` equals | `impdp` | IMPDP Branch |
| `$json.action` equals | `expdp_check_log` | Check EXPDP Log |
| `$json.action` equals | `impdp_check_log` | Check IMPDP Log |

---

## EXPDP Branch

### Node 2a: `Build EXPDP Command` (Code node)

```javascript
// Builds the expdp command string from dynamic parameters
const p = $json.params;
const db = $json.db;
const os = $json.os; // "Windows" or "Linux"

let parts = [];

// Auth
parts.push(`expdp "/ as sysdba"`);

// Required params
parts.push(`DIRECTORY=${p.DIRECTORY || 'DP_DIR'}`);
parts.push(`DUMPFILE=${p.DUMPFILE || 'exp_%U.dmp'}`);
parts.push(`LOGFILE=${p.LOGFILE || 'exp.log'}`);

// Schema list (can be array or comma string)
if (p.SCHEMAS) {
  const schemas = Array.isArray(p.SCHEMAS)
    ? p.SCHEMAS.join(',')
    : p.SCHEMAS;
  if (schemas.trim()) parts.push(`SCHEMAS=${schemas}`);
}

// Optional parameters (add only if provided and non-empty)
const optionals = [
  'TABLES','TABLESPACES','FULL','EXCLUDE','INCLUDE',
  'PARALLEL','COMPRESSION','FLASHBACK_TIME','FILESIZE',
  'CONTENT','ESTIMATE_ONLY','METRICS'
];

for (const key of optionals) {
  if (p[key] !== undefined && p[key] !== null && p[key] !== '') {
    parts.push(`${key}=${p[key]}`);
  }
}

const expdpCmd = parts.join(' ');
const logPath = p.LOGFILE || 'exp.log';

// Build the OS shell command
let shellCmd;
if (os === 'Windows') {
  // Windows: run via cmd through n8n SSH/Execute
  shellCmd = `set ORACLE_SID=${db} && ${expdpCmd}`;
} else {
  // Linux
  shellCmd = `export ORACLE_SID=${db}; ${expdpCmd}`;
}

return [{
  json: {
    ...$json,
    expdp_command: expdpCmd,
    shell_command: shellCmd,
    dump_transfer_required: p.dump_transfer_required || 'no',
    transfer_server: p.transfer_server || '',
    log_file: logPath,
    job_id: p.job_id || $json.job_id || `EXPDP-${Date.now()}`
  }
}];
```

### Node 2b: `Execute EXPDP via SSH` (SSH node)
- **Host**: `{{ $env.ORACLE_HOST }}`
- **Command**: `{{ $json.shell_command }}`

### Node 2c: `Check Transfer Required` (IF node)
- **Condition**: `$json.dump_transfer_required` equals `"yes"`

### Node 2d: `Transfer Dump to Server` (SSH/SCP node — only if transfer = yes)
```javascript
// Transfer Dump — Code node to build SCP command
const p = $json.params;
const dumpFile = p.DUMPFILE || 'exp_%U.dmp';
const destServer = $json.transfer_server;
const directory = p.DIRECTORY || 'DP_DIR';

// Get the directory path from Oracle (or use a configured base path)
const dumpPath = `/oracle/dump/${dumpFile}`;  // Adjust to actual directory path

const scpCmd = `scp ${dumpPath} oracle@${destServer}:/oracle/incoming/`;

return [{
  json: {
    ...$json,
    scp_command: scpCmd,
    transfer_message: `Dump transferred to ${destServer}`
  }
}];
```

### Node 2e: `Build EXPDP Callback` (Code node)
```javascript
// Build callback payload to send back to the application
const success = true; // Set based on SSH node output

// Fetch data from the node where we built the command and stored job_id/params
const cmdData = $('Build EXPDP Command').first().json;
const p = cmdData.body ? cmdData.body.params : cmdData.params;

return [{
  json: {
    job_id: cmdData.job_id,
    db: cmdData.db || 'ORCL',
    status: success ? 'success' : 'error',
    action: 'expdp',
    dump_file: p.DUMPFILE || 'exp_%U.dmp',
    transfer_status: cmdData.dump_transfer_required === 'yes'
      ? `Transferred to ${cmdData.transfer_server}`
      : 'No transfer requested',
    message: success
      ? `Export completed successfully. Dump: ${p.DUMPFILE || 'exp_%U.dmp'}`
      : 'Export failed — check log for details'
  }
}];
```

### Node 2f: `POST Callback to App` (HTTP Request node)
- **Method**: POST
- **URL**: `{{ $env.APP_CALLBACK_URL }}/api/datapump/callback`
- **Body**: `{{ $json }}`

### Node 2g: `Respond to Webhook` (Respond to Webhook node)
```json
{
  "status": "{{ $('Build EXPDP Callback').first().json.status }}",
  "request_id": "{{ $('Build EXPDP Callback').first().json.job_id }}",
  "action": "expdp",
  "db_status": "healthy",
  "ai_summary": "{{ $('Build EXPDP Callback').first().json.message }}",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "dump_file": "{{ $('Build EXPDP Callback').first().json.dump_file }}",
    "transfer_status": "{{ $('Build EXPDP Callback').first().json.transfer_status }}"
  },
  "raw_output": "Export executed. Check log at {{ $('Build EXPDP Command').first().json.log_file }}"
}
```

---

## FETCH DUMP Branch

This branch discovers the latest dump file from the server when the user initializes the import modal.

### Node 3a: `Fetch Latest Dumpfile` (SSH node)
```bash
# Linux:
ls -t /oracle/dump/*.dmp 2>/dev/null | head -1 | xargs basename

# Windows (PowerShell via SSH):
Get-ChildItem 'C:\oracle\dump\*.dmp' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty Name
```

### Node 3b: `Parse Latest Dumpfile` (Code node)
```javascript
// Parse SSH output to get dumpfile name
const sshOutput = $input.all()[0]?.json?.stdout || '';
const dumpFile = sshOutput.trim().split('\n').pop()?.trim() || '';

return [{
  json: {
    ...$json,
    latest_dump_file: dumpFile,
    status: 'success',
    request_id: `IMPDP-DUMPFILE-${Date.now()}`,
    action: 'fetch_dump',
    db_status: 'healthy',
    ai_summary: `Latest dump file: ${dumpFile}`,
    findings: [],
    recommendations: [],
    raw_data: { latest_dump_file: dumpFile },
    raw_output: sshOutput
  }
}];
```

### Node 3c: `Respond to Webhook (Discovery)` (Respond to Webhook node)
Returns the dumpfile name back to the UI so the user can confirm it.
```json
{
  "status": "{{ $json.status }}",
  "request_id": "{{ $json.request_id }}",
  "action": "fetch_dump",
  "db_status": "healthy",
  "ai_summary": "{{ $json.ai_summary }}",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "latest_dump_file": "{{ $json.latest_dump_file }}"
  },
  "raw_output": "{{ $json.raw_output }}"
}
```

---

## IMPDP Branch

This branch executes the actual import process based on user-confirmed parameters.

### Node 4a: `Check Drop User Required` (IF node)
- **Condition**: String equals: `{{ $json.body.params.drop_user }}` (or `$json.params.drop_user`) equals `"yes"`

### Node 4b: `Build Drop User SQL` (Code node)
```javascript
// Build DROP USER CASCADE statements for all schemas
const p = $json.body ? $json.body.params : $json.params;
const schemas = p.SCHEMAS;
const schemaList = Array.isArray(schemas)
  ? schemas
  : (schemas ? String(schemas).split(',').map(s => s.trim()) : []);

if (schemaList.length === 0) {
  return [{ json: { ...$json, drop_sql: '', has_drop: false } }];
}

// Build individual DROP USER statements
const dropStatements = schemaList.map(schema =>
  `DROP USER ${schema.trim()} CASCADE;`
);

// Also build as a single SQL*Plus script
const sqlScript = dropStatements.join('\n');

return [{
  json: {
    ...$json,
    drop_sql: sqlScript,
    drop_schemas: schemaList,
    has_drop: schemaList.length > 0
  }
}];
```

### Node 4c: `Execute Drop User via SSH` (SSH node — only if has_drop=true)
```bash
# Linux:
sqlplus / as sysdba << EOF
{{ $json.drop_sql }}
EXIT;
EOF

# Windows (PowerShell):
echo "{{ $json.drop_sql }}" | sqlplus "/ as sysdba"
```

### Node 4d: `Build IMPDP Command` (Code node)
```javascript
// Builds the full impdp command
// Link this node to both the True and False outputs of "Check Drop User Required" (or after the SSH node)

// The input might come from an SSH node which drops the original payload,
// so we fetch the original payload directly from the webhook node.
let data;
try {
  // Use the exact name of your webhook entry node
  data = $('DBA Webhook Entry').first().json;
} catch (e) {
  // Fallback to the Switch node or IF node if the webhook name differs
  try { data = $('Route by action').first().json; }
  catch(e2) { data = $input.all()[0].json; }
}

const p = data.body ? data.body.params : data.params;
const db = data.body ? data.body.db : data.db;
const os = data.body ? data.body.os : data.os;

if (!p) {
  throw new Error("Could not find 'params' from 'DBA Webhook Entry'. Ensure the node name exactly matches.");
}

let parts = [`impdp "/ as sysdba"`];

parts.push(`DIRECTORY=${p.DIRECTORY || 'DP_DIR'}`);
parts.push(`DUMPFILE=${p.DUMPFILE}`);
parts.push(`LOGFILE=${p.LOGFILE || 'imp.log'}`);

// Schemas
if (p.SCHEMAS) {
  const schemas = Array.isArray(p.SCHEMAS)
    ? p.SCHEMAS.join(',')
    : p.SCHEMAS;
  if (schemas.trim()) parts.push(`SCHEMAS=${schemas}`);
}

// Standard optional params
const optionals = [
  'TABLES', 'TABLESPACES', 'FULL', 'TABLE_EXISTS_ACTION',
  'CONTENT', 'PARALLEL', 'EXCLUDE', 'INCLUDE',
  'REMAP_SCHEMA', 'REMAP_TABLESPACE', 'TRANSFORM', 'METRICS'
];

for (const key of optionals) {
  if (p[key] !== undefined && p[key] !== null && p[key] !== '') {
    parts.push(`${key}=${p[key]}`);
  }
}

const impdpCmd = parts.join(' ');

let shellCmd;
if (os === 'Windows') {
  shellCmd = `set ORACLE_SID=${db} && ${impdpCmd}`;
} else {
  shellCmd = `export ORACLE_SID=${db}; ${impdpCmd}`;
}

return [{
  json: {
    ...data,
    impdp_command: impdpCmd,
    shell_command: shellCmd,
    job_id: p.job_id || $json.job_id || `IMPDP-${Date.now()}`
  }
}];
```

### Node 4e: `Execute IMPDP via SSH` (SSH node)
- **Command**: `{{ $json.shell_command }}`

### Node 4f: `Build IMPDP Callback` (Code node)
```javascript
const success = true; // Based on SSH node exit code

// Fetch data from the node where we built the command and stored job_id/params
const cmdData = $('Build IMPDP Command').first().json;
const p = cmdData.body ? cmdData.body.params : cmdData.params;

return [{
  json: {
    job_id: cmdData.job_id,
    status: success ? 'success' : 'error',
    action: 'impdp',
    dump_file: p.DUMPFILE,
    message: success
      ? `Import completed successfully from ${p.DUMPFILE}`
      : 'Import failed — check log for details'
  }
}];
```

### Node 4g: `POST Callback to App` (HTTP Request node)
- **Method**: POST
- **URL**: `{{ $env.APP_CALLBACK_URL }}/api/datapump/callback`
- **Body**: `{{ $json }}`

### Node 4h: `Respond to Webhook (Execution)` (Respond to Webhook node)
```json
{
  "status": "{{ $('Build IMPDP Callback').first().json.status }}",
  "request_id": "{{ $('Build IMPDP Callback').first().json.job_id }}",
  "action": "impdp",
  "db_status": "healthy",
  "ai_summary": "{{ $('Build IMPDP Callback').first().json.message }}",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "dump_file": "{{ $('Build IMPDP Callback').first().json.dump_file }}"
  },
  "raw_output": "Import executed. Check log for details."
}
```

---

## Log Check Branches

### Node 4a: `Fetch EXPDP Log` (SSH node)
```bash
# Get the directory path from Oracle and read the latest log
# Linux:
cat $(ls -t /oracle/dump/exp*.log 2>/dev/null | head -1)

# Windows (PowerShell):
Get-Content (Get-ChildItem 'C:\oracle\dump\exp*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
```

### Node 4b: `Build EXPDP Log Response` (Code node)
```javascript
const logContent = $input.all()[0]?.json?.stdout || 'No log content found';

return [{
  json: {
    status: 'success',
    request_id: `LOG-${Date.now()}`,
    action: 'expdp_check_log',
    db_status: 'healthy',
    ai_summary: 'Latest EXPDP log retrieved successfully',
    findings: [],
    recommendations: [],
    raw_data: { log: logContent },
    raw_output: logContent
  }
}];
```

### Node 4c: `Fetch IMPDP Log` (SSH node)
```bash
# Linux:
cat $(ls -t /oracle/dump/imp*.log 2>/dev/null | head -1)

# Windows:
Get-Content (Get-ChildItem 'C:\oracle\dump\imp*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
```

### Node 4d: `Build IMPDP Log Response` (Code node)
```javascript
const logContent = $input.all()[0]?.json?.stdout || 'No import log found';

return [{
  json: {
    status: 'success',
    request_id: `LOG-${Date.now()}`,
    action: 'impdp_check_log',
    db_status: 'healthy',
    ai_summary: 'Latest IMPDP log retrieved successfully',
    findings: [],
    recommendations: [],
    raw_data: { log: logContent },
    raw_output: logContent
  }
}];
```

---

## Environment Variables Required in n8n

| Variable | Example Value |
|----------|--------------|
| `APP_CALLBACK_URL` | `http://localhost:3000` |
| `ORACLE_HOST` | `192.168.1.100` or `localhost` |
| `ORACLE_SSH_USER` | `oracle` |
| `ORACLE_DUMP_DIR` | `/oracle/dump` |

---

## Webhook Response Shape

All branches must `Respond to Webhook` with this JSON structure (matching the app's `DbaResponse` type):

```json
{
  "status": "success",
  "request_id": "EXPDP-1234567890",
  "action": "expdp",
  "db_status": "healthy",
  "ai_summary": "Human-readable summary of what happened",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "dump_file": "exp_HR_20260608.dmp",
    "transfer_status": "Transferred to DMPSERVER01",
    "latest_dump_file": "exp_HR_20260608.dmp"
  },
  "raw_output": "Full terminal output from expdp/impdp command"
}
```
