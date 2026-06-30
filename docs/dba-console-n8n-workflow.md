# DBA Console — n8n Webhook Integration

The DBA Console module dispatches lifecycle events to the existing admin webhook
(`NEXT_PUBLIC_ADMIN_WEBHOOK_URL`) so n8n can trigger Slack/email notifications.

## Webhook Configuration

The webhook is sent with:

- **Method:** POST
- **URL:** `NEXT_PUBLIC_ADMIN_WEBHOOK_URL`
- **Header:** `X-Admin-Webhook-Secret: <ADMIN_WEBHOOK_SECRET>`
- **Content-Type:** `application/json`

Failures are logged to `app_webhook_logs` and retried once (2s backoff). Webhook
failure never rolls back the database transaction — the DB write is committed
before the webhook fires.

## Events

### `dba_login`

Fired when a DBA logs in to a shift.

```json
{
  "action": "dba_login",
  "username": "arindam",
  "email": "arindam@example.com",
  "login_time": "2026-06-30T07:05:00+05:30",
  "shift": "Shift 1 (07:00 - 15:30)"
}
```

### `dba_logout`

Fired when a DBA logs out (after handover acknowledgement).

```json
{
  "action": "dba_logout",
  "username": "arindam",
  "email": "arindam@example.com",
  "logout_time": "2026-06-30T15:35:00+05:30",
  "handover_text": "All databases UP. Backup completed for PRODDB.",
  "shift": "Shift 1 (07:00 - 15:30)"
}
```

### `handover_submitted`

Fired when a DBA submits handover notes.

```json
{
  "action": "handover_submitted",
  "username": "arindam",
  "email": "arindam@example.com",
  "shift": "Shift 1 (07:00 - 15:30)",
  "handover_text": "All databases UP. Backup completed for PRODDB."
}
```

### `handover_acknowledged`

Fired when another DBA acknowledges a handover.

```json
{
  "action": "handover_acknowledged",
  "username": "jane",
  "email": "jane@example.com",
  "shift": "Shift 2 (14:30 - 23:00)",
  "author": "arindam"
}
```

### `handover_override`

Fired when an app_admin force-acknowledges a handover (emergency override).

```json
{
  "action": "handover_override",
  "username": "manager",
  "email": "manager@example.com",
  "shift": "Shift 3 (22:30 - 07:00)",
  "author": "arindam",
  "reason": "No other DBA available; end of emergency maintenance window."
}
```

## n8n Workflow Setup

1. Create a Webhook node listening on `POST /webhook/dba-console`.
2. Set the response type to "Respond Immediately" (the app does not block on the
   webhook response).
3. Add a Switch node on `{{ $json.action }}` to route each event to the
   appropriate notification channel (Slack, email, etc.).
4. For `handover_submitted`, notify all on-shift DBAs that a handover is awaiting
   acknowledgement.

## Shift Timings

| Shift | Start  | End    | Overlap               |
|-------|--------|--------|-----------------------|
| 1     | 07:00  | 15:30  | 14:30–15:30 with S2  |
| 2     | 14:30  | 23:00  | 22:30–23:00 with S3  |
| 3     | 22:30  | 07:00  | — (wraps midnight)    |

During overlap windows, both shifts are active and a DBA can choose which to
log in to.
