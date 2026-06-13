# Performance Tuning n8n Implementation

This screen posts to the existing DBA webhook endpoint through `POST /api/dba/actions`. The Next.js API route enriches the request with the logged-in user and database target metadata, then forwards the JSON to `NEXT_PUBLIC_DBA_WEBHOOK_URL`.

## Payload Contract

Example payload sent from the app:

```json
{
  "action": "top_sql",
  "db": "ORCL",
  "params": {
    "order_by": "elapsed_time"
  },
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Windows",
  "db_type": "Standalone"
}
```

Actions used by the Performance Tuning screen:

| UI option | `action` | `params` | Recommended `raw_data` key |
| --- | --- | --- | --- |
| RUN ALL | `check_performance` | `{}` | all keys below, plus optional `performance_results` |
| Top SQL | `top_sql` | `{ "order_by": "elapsed_time" }` where value is one of `elapsed_time`, `cpu_sec`, `disk_reads`, `executions`, `buffer_gets` | `top_sql` |
| CPU Usage | `cpu_usage` | `{}` | `cpu_usage` |
| Wait Events | `wait_events` | `{}` | `wait_events` |
| Session Long Operations | `SESSION_LONGOPS` | `{}` | `session_longops` |
| Invalid Objects | `invalid_obejcts` | `{}` | `invalid_obejcts` and/or `invalid_objects` |
| List Sessions | `session_list` | `{ "status": "ACTIVE" }` | `session_list` |
| Kill inactive sessions | `kill_session` | `{}` | `rows` |
| Check blocking session | `lock_check` | `{}` | `lock_check` |
| Long Running Queries | `long_queries` | `{ "last_call_et": 60 }` | `long_queries` |
| Load schemas for recompile dropdown | `schema_list` | `{}` | `schemas` |
| Recompile invalid objects | `recompile_invalid` | `{ "schema_name": "APPS" }` | `rows` |

Note: `invalid_obejcts` is intentionally spelled exactly as requested so n8n should route on that value.

## n8n Workflow Shape

Recommended node order:

1. Webhook node receives the app payload.
2. Code node validates `action`, `db`, and action-specific params.
3. Switch node routes by `{{$json.body.action}}`.
4. Oracle Database node executes the selected SQL.
5. Code node formats rows into the response shape below.
6. Respond to Webhook node returns the Code node JSON.

The app renders tables when the response has either `raw_data.<recommended_key>` or `raw_data.rows`.

For `check_performance`, n8n should run each SQL in this section, write each result set to its own table, merge the outputs for LLM analysis, and return the latest analysis in the webhook response. The app displays the returned RUN ALL summary and uses these raw data keys to update each card's latest result, last run time, and username.

## Response Format

Return this shape from Respond to Webhook:

```json
{
  "status": "success",
  "request_id": "N8N-{{$now}}",
  "action": "top_sql",
  "db_status": "unknown",
  "ai_summary": "10 rows returned for top_sql.",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "top_sql": [],
    "rows": []
  },
  "raw_output": ""
}
```

Generic n8n Code node after an Oracle Database node:

```js
const webhookBody = $("Webhook").first().json.body ?? {};
const action = webhookBody.action;
const db = webhookBody.db;

const resultKeyByAction = {
  top_sql: "top_sql",
  cpu_usage: "cpu_usage",
  wait_events: "wait_events",
  SESSION_LONGOPS: "session_longops",
  invalid_obejcts: "invalid_obejcts",
  session_list: "session_list",
  lock_check: "lock_check",
  long_queries: "long_queries",
  schema_list: "schemas",
  recompile_invalid: "rows",
  kill_session: "rows",
  check_performance: "performance_results"
};

function normalizeKey(key) {
  return String(key).toLowerCase();
}

function normalizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value])
  );
}

const oracleRows = $input.all().map((item) => normalizeRow(item.json));
const resultKey = resultKeyByAction[action] || "rows";
const rawData = { rows: oracleRows };

if (action === "schema_list") {
  rawData.schemas = oracleRows
    .map((row) => row.username || row.schema_name || row.owner)
    .filter(Boolean)
    .sort();
} else {
  rawData[resultKey] = oracleRows;
}

return [
  {
    json: {
      status: "success",
      request_id: `N8N-${Date.now()}`,
      action,
      db,
      db_status: "unknown",
      ai_summary: `${oracleRows.length} row(s) returned for ${action}.`,
      findings: [],
      recommendations: [],
      raw_data: rawData,
      raw_output: JSON.stringify(oracleRows, null, 2)
    }
  }
];
```

## Result Tables

Run `db/oracle_performance_tuning_tables.sql` to create separate n8n result tables for:

- `app_perf_top_sql`
- `app_perf_cpu_usage`
- `app_perf_wait_events`
- `app_perf_session_longops`
- `app_perf_invalid_objects`
- `app_perf_sessions`
- `app_perf_locks`
- `app_perf_long_queries`
- `app_perf_run_summary`

Every table includes `run_group_id`, `requested_by`, `db_name`, and `created_at`. Use the same `run_group_id` for every row produced by one `check_performance` RUN ALL request.

## SQL by Action

### `top_sql`

Validate `params.order_by` before building SQL. Do not concatenate untrusted input.

Allowed values:

```js
const allowedTopSqlOrder = {
  elapsed_time: "elapsed_time",
  cpu_sec: "cpu_time",
  disk_reads: "disk_reads",
  executions: "executions",
  buffer_gets: "buffer_gets"
};

const orderBy = allowedTopSqlOrder[$json.body.params?.order_by] || "elapsed_time";
```

Oracle SQL:

```sql
SELECT *
FROM (
    SELECT
        sql_id,
        executions,
        ROUND(elapsed_time/1000000,2) elapsed_sec,
        ROUND(cpu_time/1000000,2) cpu_sec,
        buffer_gets,
        disk_reads,
        SUBSTR(sql_text,1,80) sql_text
    FROM v$sql
    WHERE executions > 0
    ORDER BY /* replace with validated orderBy */ elapsed_time DESC
)
WHERE ROWNUM <= 10;
```

### `SESSION_LONGOPS`

```sql
SELECT
    s.sid,
    s.serial#,
    s.username,
    s.sql_id,
    SUBSTR(sl.opname,1,40) operation,
    ROUND(sl.sofar * 100 / NULLIF(sl.totalwork,0),1) pct_done,
    ROUND(sl.elapsed_seconds/60,1) elapsed_min,
    ROUND(sl.time_remaining/60,1) eta_min
FROM v$session_longops sl
JOIN v$session s
    ON s.sid = sl.sid
   AND s.serial# = sl.serial#
WHERE sl.totalwork > 0
  AND sl.sofar <> sl.totalwork
ORDER BY sl.time_remaining DESC;
```

### `session_list`

Use `params.status` from the app. Default to `ACTIVE`; allow only `ACTIVE`, `INACTIVE`, or `ALL`.

```sql
SELECT
    s.sid,
    s.serial#,
    s.username,
    s.osuser,
    s.sql_id,
    s.event,
    s.state,
    s.seconds_in_wait,
    s.last_call_et
FROM v$session s
WHERE (:status = 'ALL' OR s.status = :status)
  AND s.type <> 'BACKGROUND'
ORDER BY s.last_call_et DESC;
```

If your Oracle node does not support bind variables, validate the status in a Code node first and inject only the validated literal.

### `kill_session`

This Performance Tuning button sends `action = kill_session` with empty params. Route that case to inactive-session cleanup.

```sql
BEGIN
    FOR r IN (
        SELECT
            sid,
            serial#
        FROM v$session
        WHERE status = 'INACTIVE'
          AND type = 'USER'
          AND username NOT IN ('SYS','SYSTEM')
          AND last_call_et > 1800
    )
    LOOP
        BEGIN
            EXECUTE IMMEDIATE
                'ALTER SYSTEM KILL SESSION '''
                || r.sid || ',' || r.serial# || ''' IMMEDIATE';

            DBMS_OUTPUT.PUT_LINE(
                'Killed Session SID=' || r.sid ||
                ' SERIAL#=' || r.serial#
            );
        EXCEPTION
            WHEN OTHERS THEN
                DBMS_OUTPUT.PUT_LINE(
                    'Failed to kill SID=' || r.sid ||
                    ' Error=' || SQLERRM
                );
        END;
    END LOOP;
END;
```

If the Oracle node does not return `DBMS_OUTPUT`, return a simple success JSON from a Code node after the Oracle node, or split the candidate query and kill statements so n8n can count each row.

### `lock_check`

```sql
SELECT
    w.sid               waiter_sid,
    w.serial#           waiter_serial,
    w.username          waiter_user,
    w.sql_id            waiter_sql_id,
    b.sid               blocker_sid,
    b.serial#           blocker_serial,
    b.username          blocker_user,
    b.sql_id            blocker_sql_id,
    ROUND(w.seconds_in_wait/60,1) waiting_min,
    w.event
FROM v$session w
JOIN v$session b
    ON w.blocking_session = b.sid
WHERE w.blocking_session IS NOT NULL
ORDER BY w.seconds_in_wait DESC;
```

### `wait_events`

```sql
SELECT
    event,
    wait_class,
    total_waits,
    ROUND(time_waited/100,2) AS time_waited_sec,
    ROUND(average_wait,2) AS avg_wait_cs
FROM v$system_event
WHERE wait_class <> 'Idle'
ORDER BY time_waited DESC;
```

### `cpu_usage`

```sql
SELECT
    num_cpus,
    ROUND(busy_time / (busy_time + idle_time) * 100, 2) AS current_total_cpu_util,
    ROUND(user_time / (busy_time + idle_time) * 100, 2) AS user_cpu_util,
    ROUND(sys_time / (busy_time + idle_time) * 100, 2) AS system_cpu_util
FROM (
    SELECT
        MAX(CASE WHEN stat_name = 'NUM_CPUS' THEN value END) AS num_cpus,
        MAX(CASE WHEN stat_name = 'BUSY_TIME' THEN value END) AS busy_time,
        MAX(CASE WHEN stat_name = 'IDLE_TIME' THEN value END) AS idle_time,
        MAX(CASE WHEN stat_name = 'USER_TIME' THEN value END) AS user_time,
        MAX(CASE WHEN stat_name = 'SYS_TIME' THEN value END) AS sys_time
    FROM v$osstat
);
```

### `invalid_obejcts`

```sql
SELECT
    owner,
    object_type,
    object_name,
    status,
    TO_CHAR(last_ddl_time, 'YYYY-MM-DD HH24:MI:SS') AS last_modified
FROM dba_objects
WHERE status = 'INVALID'
ORDER BY owner, object_type, object_name;
```

### `schema_list`

Used only to populate the schema dropdown inside the Invalid Objects modal.

```sql
SELECT DISTINCT username
FROM dba_users
ORDER BY username;
```

### `recompile_invalid`

Validate `params.schema_name` with a whitelist such as `/^[A-Z0-9_$#]+$/i` before execution.

```sql
BEGIN
    DBMS_UTILITY.COMPILE_SCHEMA(schema => :schema_name, compile_all => FALSE);
END;
```

If bind variables are unavailable in your Oracle node, validate and uppercase the schema name in a Code node, then inject only the validated value.

### `long_queries`

Use `params.last_call_et` from the app. Default is `60` seconds.

```sql
SELECT s.sid,
       s.serial#,
       s.username,
       s.machine,
       s.last_call_et AS running_seconds,
       q.sql_id,
       q.sql_text
FROM v$session s
JOIN v$sql q ON s.sql_id = q.sql_id
WHERE s.status = 'ACTIVE'
  AND s.username IS NOT NULL
  AND s.last_call_et > :last_call_et
ORDER BY s.last_call_et DESC;
```

## App Files Changed

- `app/(protected)/performance-tuning/page.tsx`
- `components/performance/performance-tuning-workspace.tsx`
- `lib/action-catalog.ts`
- `types/dba.ts`
- `app/api/dba/actions/route.ts`
- `services/mock-data.ts`
- `db/oracle_performance_tuning_tables.sql`
- `docs/performance-tuning-n8n.md`
