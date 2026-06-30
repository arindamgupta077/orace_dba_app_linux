# Oracle DBA AI Operations Portal

Modern enterprise Oracle Database Administration web application built with Next.js 15, React, TypeScript, TailwindCSS, shadcn/ui-style components, Recharts, Zustand, Axios, xterm.js, and Docker.

The UI never connects directly to Oracle Database. The Next.js backend now handles:
- Oracle-backed authentication (password and token mode)
- Oracle-backed session management
- Oracle-backed audit logging
- Oracle-backed request history
- n8n webhook execution for DBA actions

Architecture:

```text
Frontend UI -> Next.js API -> Oracle (auth/audit/history)
                        -> n8n Webhook -> SSH -> SQLPlus/RMAN -> AI Analysis -> JSON Response
```

## Features

- JWT login and API token login with remembered sessions
- n8n webhook-only DBA action execution
- Mock API mode for local demos
- Responsive dark enterprise dashboard
- Database selector and multi-database support
- Tablespace, session, SQL, lock, RMAN, alert log, AWR, security, invalid object, audit, and AI chat pages
- Destructive action confirmation, approval waiting, Slack approval indicator, and execution timeline
- AI summary, findings, recommendations, severity badges, and health indicators
- Recharts visualizations
- xterm.js raw output viewer with copy, fullscreen, scrollback, ANSI support, and download
- API request history, retry, CSV export, print-to-PDF, offline state handling, and WebSocket live update hook

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Oracle Schema Setup (SQL*Plus)

Run the schema script:

```sql
sqlplus APP_DBA/Password123@localhost:1522/TEST @db/oracle_app_setup.sql
```

The script is here:
- `db/oracle_app_setup.sql`
- `db/oracle_check_data_tables.sql` (run this if you already created base auth/history tables earlier and only need separate per-check data tables)
- `db/oracle_alert_notifications.sql` (run this against an existing schema to add only the inbound n8n alert table)
- `db/oracle_dba_console.sql` (DBA Console module — shift management, daily checklist, shift report; run after `oracle_db_inventory.sql`)

It creates:
- `APP_USERS`
- `APP_SESSIONS`
- `APP_AUDIT_LOGS`
- `APP_REQUEST_HISTORY`
- `APP_ALERT_NOTIFICATIONS`
- `APP_RUN_TABLESPACES`
- `APP_RUN_SESSIONS`
- `APP_RUN_SQL_METRICS`
- `APP_RUN_LOCKS`
- `APP_RUN_BACKUPS`
- `APP_RUN_ALERTS`
- `APP_RUN_TREND_POINTS` (AWR/dashboard trend points)
- `APP_RUN_SECURITY_PRIVILEGES`
- `APP_RUN_INVALID_OBJECTS`
- `APP_RUN_FINDINGS`
- `APP_RUN_RECOMMENDATIONS`
- `APP_RUN_METRICS`
- indexes + trigger + bootstrap admin user

For local development without n8n, keep:

```env
NEXT_PUBLIC_DBA_MOCK=true
```

Required environment variables:

```env
ORACLE_CONNECTION_STRING=localhost:1522/TEST
ORACLE_USER=APP_DBA
ORACLE_PASSWORD=Password123
APP_AUTH_SECRET=change-this-long-random-secret
APP_SESSION_COOKIE_NAME=dba_session
APP_SESSION_TTL_HOURS=8
APP_SESSION_REMEMBER_TTL_DAYS=30

NEXT_PUBLIC_DBA_MOCK=false
NEXT_PUBLIC_DBA_WEBHOOK_URL=http://localhost:5678/webhook-test/dba-agent
NEXT_PUBLIC_DBA_TOKEN=your-api-token
```

## Auth Bootstrap Credentials

After running `db/oracle_app_setup.sql`, default login is:
- Username: `ARINDAM`
- Password mode password: `Password123`
- Token mode token: `Password123`

## Webhook Contract

```http
POST <NEXT_PUBLIC_DBA_WEBHOOK_URL>
X-DBA-Token: <token>
```

Payload:

```json
{
  "action": "tablespace_check",
  "db": "ORCL",
  "params": {},
  "requested_by": "arindam"
}
```

Expected response:

```json
{
  "status": "success",
  "request_id": "DBA-123456",
  "action": "tablespace_check",
  "db_status": "warning",
  "ai_summary": "Tablespace growth is elevated in ORCL.",
  "findings": [],
  "recommendations": [],
  "raw_data": {},
  "raw_output": ""
}
```

## Inbound Alert API for n8n

n8n can create and update any DBA alert notification without an auth header. Use the same URL for tablespaces, sessions, locks, backups, performance, security, and future DBA alert types:

```http
POST /api/alerts
Content-Type: application/json
```

```json
{
  "db": "ORCL",
  "alert_type": "tablespace",
  "tablespace": "USERS",
  "severity": "critical",
  "pct_used": 91.5,
  "threshold_pct": 80,
  "critical_pct": 90,
  "extend_size_gb": 10,
  "message": "USERS tablespace crossed the critical threshold.",
  "approval_url": "https://n8n.example/webhook/approve?decision=approved",
  "reject_url": "https://n8n.example/webhook/approve?decision=rejected"
}
```

For other DBA tasks, change `alert_type` and put task-specific fields in `object_name` and `metadata`:

```json
{
  "db": "ORCL",
  "alert_type": "lock",
  "object_name": "SID 142 blocking SID 208",
  "severity": "critical",
  "message": "Blocking lock has been waiting for 18 minutes.",
  "metadata": {
    "blocker_sid": 142,
    "waiter_sid": 208,
    "wait_minutes": 18
  }
}
```

The response contains `alert.id`. After n8n completes, rejects, or fails the workflow, call:

```http
PATCH /api/alerts
Content-Type: application/json
```

```json
{
  "id": "ALT-...",
  "status": "completed",
  "message": "Datafile extended successfully."
}
```

## Generated SQL Approval API

After the LLM creates SQL for an approved tablespace alert, n8n can ask the app for DBA SQL review:

```http
POST /api/alerts/sql-approval
Content-Type: application/json
```

```json
{
  "alert_id": "ALT-...",
  "sql_command": "ALTER DATABASE DATAFILE '+DATA/ORCL/DATAFILE/users01.dbf' RESIZE 20480M;",
  "callback_url": "https://n8n.example/webhook/sql-approved",
  "callback_method": "POST"
}
```

The DBA sees an editable SQL popup in the Tablespaces page. When approved, the app stores the edited SQL and sends this payload to `callback_url`:

```json
{
  "decision": "approved",
  "alert_id": "ALT-...",
  "db": "ORCL",
  "tablespace": "USERS",
  "approved_by": "ARINDAM",
  "sql_command": "ALTER DATABASE DATAFILE '+DATA/ORCL/DATAFILE/users01.dbf' RESIZE 20480M;"
}
```

For compatibility, `POST /api/alerts` also treats a body with both `alert_id` and `sql_command` as a SQL approval request.

After n8n executes the final approved SQL, send the execution result back to the app:

```http
PATCH /api/alerts
Content-Type: application/json
```

`POST /api/alerts` also works for this final update when `status` is `completed`, `success`, `failed`, or `error`.
If your n8n final HTTP node is still pointed at `/api/alerts/sql-approval`, that endpoint also treats those final statuses as execution results.

```json
{
  "id": "ALT-...",
  "status": "completed",
  "message": "Tablespace datafile extended successfully.",
  "sql_command": "ALTER DATABASE DATAFILE '+DATA/ORCL/DATAFILE/users01.dbf' RESIZE 20480M;",
  "database_result": {
    "tablespace": "USERS",
    "datafile": "+DATA/ORCL/DATAFILE/users01.dbf",
    "new_size_mb": 20480
  },
  "sql_output": "Database altered."
}
```

For execution failure, use:

```json
{
  "id": "ALT-...",
  "status": "failed",
  "message": "SQL execution failed: ORA-xxxxx ...",
  "sql_output": "Full SQLPlus or driver output here"
}
```

When this update arrives, the Tablespaces page closes the SQL review popup and immediately shows a SQL execution result dialog with the message, database result, and SQL output.

## Docker

```bash
docker build -t oracle-dba-ai-portal .
docker run --rm -p 3000:3000 --env-file .env.local oracle-dba-ai-portal
```

## RHEL 9.7 Deployment

For production deployment on Red Hat Enterprise Linux (Node 24.14.1) with co-located n8n and Oracle Database, see:

- [`docs/deploy-rhel.md`](docs/deploy-rhel.md) — step-by-step install, systemd, nginx, and n8n callback setup
- `deploy/oracle-dba-portal.service` — systemd unit template
- `deploy/nginx-dba-portal.conf.example` — TLS reverse proxy for SSE streams

Quick start on the server after extracting the GitHub ZIP:

```bash
cp .env.example .env.local   # edit for production
npm ci
npm run build
NODE_ENV=production HOSTNAME=0.0.0.0 npm run start
```

## Production Notes

- Terminate TLS in front of the app and n8n.
- Store all secrets in deployment secret manager; do not commit `.env.local`.
- Rotate `APP_AUTH_SECRET` and n8n token regularly.
- Change bootstrap credentials immediately after first login.
- Keep Oracle credentials, SSH keys, SQLPlus/RMAN scripts, and AI model secrets outside source control.
