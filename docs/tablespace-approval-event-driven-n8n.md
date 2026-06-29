# Event-Driven Tablespace Approval Workflows

This guide implements the new approval architecture for tablespace extension.

The important design rule is simple:

```text
n8n never waits for a human.
```

The Next.js application owns alert state, approval state, SQL review state, audit history, and user identity. n8n owns Oracle connectivity, scheduled detection, SQL proposal generation, and approved SQL execution.

## Files

Import these two workflows into n8n:

```text
docs/tablespace-detection-n8n-workflow.json
docs/tablespace-command-router-n8n-workflow.json
```

There are only two workflows:

1. `DBA - Tablespace Detection`
2. `DBA - Tablespace Command Router`

Do not add Wait nodes to either workflow.

## Required Environment Variables

Set these in the Next.js application:

```env
DBA_WEBHOOK_URL=http://localhost:5678/webhook/dba-agent
DBA_WEBHOOK_TOKEN=replace-with-api-token
NEXT_PUBLIC_DBA_MOCK=false
ALERT_SQL_EXECUTION_TIMEOUT_MINUTES=10
```

Set these in n8n:

```env
NEXTJS_APP_URL=http://host.docker.internal:3000
DBA_WEBHOOK_TOKEN=replace-with-api-token
DETECTION_DB=ORCL
DETECTION_ENVIRONMENT=PROD
DETECTION_OS=Windows
DETECTION_DB_TYPE=Standalone
TABLESPACE_THRESHOLD_PCT=90
TABLESPACE_CRITICAL_PCT=95
TABLESPACE_EXTEND_SIZE_GB=10
```

`DBA_WEBHOOK_TOKEN` must match on both sides. The app sends it to n8n as `X-DBA-Token`. n8n sends it back to the app as `X-DBA-Token`.

`NEXT_PUBLIC_DBA_WEBHOOK_URL` still works as a backward-compatible app fallback, but production should use the server-side `DBA_WEBHOOK_URL`.

`ALERT_SQL_EXECUTION_TIMEOUT_MINUTES` controls how long the app will show an approved SQL execution as running. If no n8n completion callback arrives before that timeout, the next alert poll marks the card as `failed`.

## Workflow 1: DBA - Tablespace Detection

Purpose:

```text
Detect tablespaces above threshold, create application alerts, and exit.
```

High-level flow:

```text
Schedule Trigger
-> Prepare Detection Context
-> Oracle: Check Tablespace Usage
-> Build Alert Payloads
-> POST /api/alerts
-> End
```

### Node 1: Schedule Trigger

Runs every 15 minutes by default. Adjust the interval based on your monitoring requirement.

Recommended production schedule:

```text
PROD: every 15 minutes
UAT/DEV: every 30-60 minutes
```

### Node 2: Prepare Detection Context

This Code node creates the runtime context:

- database name
- environment
- threshold
- recommended extension size
- Oracle query

The workflow JSON reads these from n8n environment variables.

### Node 3: Oracle - Check Tablespace Usage

This node queries `DBA_DATA_FILES`, `DBA_FREE_SPACE`, and calculates usage percentage.

It returns one row per tablespace. The imported workflow uses this query:

```sql
WITH datafiles AS (
  SELECT tablespace_name, SUM(bytes) bytes
  FROM dba_data_files
  GROUP BY tablespace_name
),
free_space AS (
  SELECT tablespace_name, SUM(bytes) bytes
  FROM dba_free_space
  GROUP BY tablespace_name
)
SELECT
  d.tablespace_name,
  ROUND(d.bytes / 1024 / 1024 / 1024, 2) AS total_gb,
  ROUND((d.bytes - NVL(f.bytes, 0)) / 1024 / 1024 / 1024, 2) AS used_gb,
  ROUND(NVL(f.bytes, 0) / 1024 / 1024 / 1024, 2) AS free_gb,
  ROUND(((d.bytes - NVL(f.bytes, 0)) / d.bytes) * 100, 2) AS usage_pct
FROM datafiles d
LEFT JOIN free_space f ON f.tablespace_name = d.tablespace_name
ORDER BY usage_pct DESC
```

### Node 4: Build Alert Payloads

This Code node filters rows where:

```text
usage_pct >= TABLESPACE_THRESHOLD_PCT
```

For every matching tablespace, it sends one alert payload to the app:

```json
{
  "event_id": "evt_123_USERS",
  "correlation_id": "corr_123",
  "idempotency_key": "tablespace:ORCL:PROD:USERS",
  "action": "tablespace",
  "alert_type": "tablespace",
  "db": "ORCL",
  "severity": "critical",
  "requested_by": "n8n",
  "environment": "PROD",
  "os": "Windows",
  "db_type": "Standalone",
  "params": {
    "tablespace": "USERS",
    "usage_pct": 93.4,
    "threshold_pct": 90,
    "critical_pct": 95,
    "used_gb": 120,
    "free_gb": 8,
    "extend_size_gb": 10,
    "recommendation": "Extend USERS by 10 GB"
  }
}
```

The app stores this in `APP_ALERT_NOTIFICATIONS`. The `idempotency_key` identifies the monitored tablespace, while the alert status decides whether the app refreshes the open card or creates a new occurrence.

Current application occurrence logic:

```text
Same DB + same alert type + same tablespace + pending_approval
-> refresh the existing pending alert row with the latest utilization.

Same DB + same alert type + same tablespace + approved/rejected/completed/failed
-> create a new alert occurrence for the same idempotency key.
```

This means a tablespace has only one active approval card at a time, but a new card appears if n8n detects the same high-utilization condition again after the previous card was decided.

### Node 5: POST Alert to App

HTTP Request:

```text
POST {{$env.NEXTJS_APP_URL}}/api/alerts
```

Headers:

```text
Content-Type: application/json
X-DBA-Token: {{$env.DBA_WEBHOOK_TOKEN}}
```

After this node, the detection workflow is done.

## Workflow 2: DBA - Tablespace Command Router

Purpose:

```text
Receive short-lived commands from the app and perform exactly one unit of work.
```

This one workflow handles these actions:

```text
extension_approved
extension_rejected
execute_sql
sql_rejected
```

High-level flow:

```text
Webhook /dba-agent
-> Validate DBA Command
-> If unauthorized: respond 401
-> If extension_approved: generate SQL proposal, callback app, respond 202
-> If execute_sql: execute approved SQL, callback app, respond 202
-> If extension_rejected/sql_rejected: acknowledge, respond 202
-> Else: respond 400
```

## Command: extension_approved

The app calls n8n after the user approves the alert or selects a tablespace/size.

Example app-to-n8n payload:

```json
{
  "action": "extension_approved",
  "correlation_id": "ALT-123",
  "alert_id": "ALT-123",
  "db": "ORCL",
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Windows",
  "db_type": "Standalone",
  "params": {
    "tablespace": "USERS",
    "selected_size_gb": 10
  }
}
```

The router does this:

```text
Query tablespace metadata
-> Build SQL proposal
-> POST /api/alerts/sql-approval
-> Respond 202
-> End
```

### Metadata Query

The imported workflow queries:

```sql
SELECT
  df.tablespace_name,
  df.file_name,
  ROUND(df.bytes / 1024 / 1024 / 1024, 2) AS file_size_gb,
  df.autoextensible,
  ROUND(df.maxbytes / 1024 / 1024 / 1024, 2) AS max_size_gb,
  ROUND(NVL(fs.free_bytes, 0) / 1024 / 1024 / 1024, 2) AS free_gb,
  p.value AS db_create_file_dest
FROM dba_data_files df
LEFT JOIN (
  SELECT file_id, SUM(bytes) free_bytes
  FROM dba_free_space
  GROUP BY file_id
) fs ON fs.file_id = df.file_id
LEFT JOIN v$parameter p ON p.name = 'db_create_file_dest'
WHERE df.tablespace_name = '<TABLESPACE>'
ORDER BY df.bytes DESC
```

### SQL Generation Rule

The workflow generates deterministic SQL for execution safety:

```sql
ALTER TABLESPACE USERS
  ADD DATAFILE SIZE 10G
  AUTOEXTEND ON NEXT 1G MAXSIZE 32G
```

If the database does not use OMF/ASM, it derives a file path from the largest existing datafile and generates:

```sql
ALTER TABLESPACE USERS
  ADD DATAFILE '/u01/app/oracle/oradata/ORCL/users_auto_1718123456789.dbf' SIZE 10G
  AUTOEXTEND ON NEXT 1G MAXSIZE 32G
```

### Where to Add Your AI Agent

Keep deterministic SQL generation as the final authority. Use the AI Agent for:

- explanation
- risk summary
- warning messages
- recommendation text
- sizing commentary

Recommended placement:

```text
Query Tablespace Metadata
-> AI Agent: Explain Recommendation
-> Build SQL Proposal
```

The final SQL must still pass the Code node validator in n8n and the Next.js validator before execution.

### SQL Approval Callback

n8n posts the proposal back to:

```text
POST {{$env.NEXTJS_APP_URL}}/api/alerts/sql-approval
```

Payload:

```json
{
  "alert_id": "ALT-123",
  "correlation_id": "ALT-123",
  "db": "ORCL",
  "tablespace": "USERS",
  "generated_sql": "ALTER TABLESPACE USERS ADD DATAFILE SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 32G",
  "explanation": "The USERS tablespace is above threshold. Adding a 10 GB datafile restores free capacity.",
  "warnings": [
    "Confirm storage free space before execution.",
    "This changes storage allocation in PROD."
  ],
  "database_info": {
    "environment": "PROD",
    "db_type": "Standalone",
    "tablespace": "USERS"
  }
}
```

The app displays:

- SQL editor
- editable SQL
- AI explanation
- warnings
- database information

n8n exits here. No SQL has been executed.

## Command: execute_sql

The app calls n8n only after the DBA approves the generated or edited SQL.

Example payload:

```json
{
  "action": "execute_sql",
  "correlation_id": "ALT-123",
  "alert_id": "ALT-123",
  "db": "ORCL",
  "sql": "ALTER TABLESPACE USERS ADD DATAFILE SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 32G",
  "requested_by": "ARINDAM",
  "user_id": 1,
  "params": {
    "tablespace": "USERS"
  }
}
```

The router does this:

```text
Validate SQL allowlist
-> Execute Oracle SQL
-> Query post-execution usage
-> POST result to /api/alerts/sql-approval
-> Respond 202
-> End
```

### SQL Allowlist

The imported workflow allows only:

```text
ALTER TABLESPACE <name> ADD DATAFILE ...
ALTER DATABASE DATAFILE ... RESIZE ...
ALTER DATABASE DATAFILE ... AUTOEXTEND ON ...
```

It rejects SQL containing:

```text
DROP
TRUNCATE
DELETE
UPDATE
INSERT
MERGE
CREATE USER
GRANT
REVOKE
ALTER SYSTEM
ALTER USER
EXEC
EXECUTE
BEGIN
DECLARE
DBMS_
;
```

The app also validates the SQL before it calls n8n.

### Execution Result Callback

n8n posts result to:

```text
POST {{$env.NEXTJS_APP_URL}}/api/alerts/sql-approval
```

Success:

```json
{
  "alert_id": "ALT-123",
  "status": "completed",
  "db": "ORCL",
  "sql_command": "ALTER TABLESPACE USERS ADD DATAFILE SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 32G",
  "message": "SQL executed successfully.",
  "database_result": {
    "after_usage_pct": 72.8
  }
}
```

Failure:

```json
{
  "alert_id": "ALT-123",
  "status": "failed",
  "db": "ORCL",
  "sql_command": "ALTER TABLESPACE USERS ADD DATAFILE SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 32G",
  "message": "ORA-01031: insufficient privileges",
  "sql_output": "ORA-01031: insufficient privileges"
}
```

Immediate no-disk-space response from the `execute_sql` webhook branch:

```json
{
  "action": "execute_sql",
  "alert_id": "ALT-123",
  "status": "failed",
  "error_code": "NO_DISK_SPACE",
  "db": "ORCL",
  "sql_command": "ALTER DATABASE DATAFILE 'C:\\U01\\APP\\ORACLE\\ORADATA\\ORCL\\SYSAUX01.DBF' RESIZE 16G",
  "message": "Not enough OS disk space to extend tablespace SYSAUX.",
  "sql_output": "Required free space: 10 GB. Available free space: 2.4 GB on C:\\U01.",
  "database_result": {
    "reason": "NO_DISK_SPACE",
    "tablespace": "SYSAUX",
    "mount_point": "C:\\U01",
    "required_gb": 10,
    "available_gb": 2.4,
    "reserved_gb": 1
  }
}
```

Return this from n8n with a `Respond to Webhook` node before any Oracle execution node. The app treats `status: "failed"` or `error_code: "NO_DISK_SPACE"` as a completed failed execution and moves the notification out of the executing state.

## Rejection Commands

For `extension_rejected` and `sql_rejected`, n8n should not perform Oracle work.

The imported workflow responds:

```json
{
  "accepted": true,
  "action": "extension_rejected",
  "message": "No Oracle action required."
}
```

## Import Steps

1. Open n8n.
2. Import `docs/tablespace-detection-n8n-workflow.json`.
3. Open the Oracle node and select your Oracle Database credential.
4. Open the HTTP Request node and confirm `NEXTJS_APP_URL`.
5. Activate the detection workflow.
6. Import `docs/tablespace-command-router-n8n-workflow.json`.
7. Open all Oracle nodes and select your Oracle Database credential.
8. Activate the command router workflow.
9. Set the app `DBA_WEBHOOK_URL` to the production webhook URL from the command router.

Use `/webhook-test/dba-agent` while testing inside n8n. Use `/webhook/dba-agent` after activation.

## Production Notes

- Use a dedicated Oracle service account for n8n.
- Grant only the privileges required for monitoring and tablespace extension.
- Keep `DBA_WEBHOOK_TOKEN` secret.
- Put n8n and Next.js behind private networking where possible.
- Keep all approvals and audit state in the application.
- Do not add Wait nodes for approval.

## Troubleshooting

### The app creates duplicate alerts

Check that the detection workflow sends a stable `idempotency_key`.

Example:

```text
tablespace:ORCL:PROD:USERS
```

### SQL proposal never appears

Check:

- command router workflow is active
- app `DBA_WEBHOOK_URL` points to `/webhook/dba-agent`
- `DBA_WEBHOOK_TOKEN` matches on both sides
- n8n Oracle credential can query `DBA_DATA_FILES`, `DBA_FREE_SPACE`, and `V$PARAMETER`

### SQL approval appears but execution never happens

Check:

- the SQL passes the allowlist
- app can reach n8n
- command router `execute_sql` branch is connected
- Oracle service account has `ALTER TABLESPACE` or required DBA privileges

### n8n execution stays open

That means a Wait node or a long-running response path still exists. Remove the Wait node. Each command should respond and end.
