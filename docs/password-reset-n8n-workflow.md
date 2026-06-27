# Secure Password Reset via n8n

This implementation uses the provided local n8n test webhook:

```env
NEXT_PUBLIC_ADMIN_WEBHOOK_URL=http://localhost:5678/webhook-test/f9c3cdfb-4e5d-4754-92e5-4ff77c472077
ADMIN_WEBHOOK_SECRET=replace-with-strong-shared-secret
```

The Next.js frontend calls local API routes:

- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

Those routes proxy to n8n with `flow: "forgot-password"` or `flow: "reset-password"` and include `X-Admin-Webhook-Secret`.

## Files

- Oracle migration and PL/SQL package: `db/oracle_password_reset.sql`
- Importable n8n workflow: `docs/password-reset-n8n-workflow.json`
- Forgot password page: `app/forgot-password/page.tsx`
- Reset password page: `app/reset-password/page.tsx`
- Next.js proxy routes:
  - `app/api/auth/forgot-password/route.ts`
  - `app/api/auth/reset-password/route.ts`

## Oracle Setup

Run as the application schema owner:

```sql
@db/oracle_password_reset.sql
```

This script:

- Adds `app_users.email`
- Normalizes `app_users.username` to uppercase
- Normalizes `app_users.email` to lowercase
- Creates a case-insensitive unique email index
- Creates `app_password_reset_attempts` for rate limiting by email and IP
- Creates `app_password_resets` for SHA-256 token hashes only
- Installs `app_auth_reset_pkg`

## n8n Environment

Set these in the n8n container environment:

```env
ADMIN_WEBHOOK_SECRET=replace-with-strong-shared-secret
NEXTJS_RESET_BASE_URL=https://your-nextjs-domain.com/reset-password
PASSWORD_RESET_FROM_EMAIL=no-reply@your-company.com
```

For local testing, use:

```env
NEXTJS_RESET_BASE_URL=http://localhost:3000/reset-password
```

## n8n Import

1. Import `docs/password-reset-n8n-workflow.json`.
2. Open both Oracle Database nodes and select your Oracle credential.
3. Open the Email Send node and select your configured SMTP credential.
4. Keep the Webhook path as `f9c3cdfb-4e5d-4754-92e5-4ff77c472077` for the provided test URL.
5. Activate the workflow for production, then switch the app URL from `/webhook-test/...` to `/webhook/...`.

## Node Configuration

### 1. Webhook - Admin Password Reset Webhook

- Method: `POST`
- Path: `f9c3cdfb-4e5d-4754-92e5-4ff77c472077`
- Response mode: `Using Respond to Webhook node`

### 2. Code - Validate Secret and Route

```javascript
const item = $input.first().json;
const rawHeaders = item.headers || {};
const headers = {};

for (const [key, value] of Object.entries(rawHeaders)) {
  headers[key.toLowerCase()] = Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

const expectedSecret = $env.ADMIN_WEBHOOK_SECRET || 'replace-with-strong-shared-secret';
const providedSecret = headers['x-admin-webhook-secret'] || '';

if (!expectedSecret || providedSecret !== expectedSecret) {
  return [{ json: { route: 'error', success: false, message: 'Unauthorized.' } }];
}

const body = item.body && typeof item.body === 'object' ? item.body : item;
const route = String(body.flow || '').trim();
const forwardedIp = String(headers['x-forwarded-for'] || '').split(',')[0].trim();

return [{
  json: {
    route,
    email: body.email,
    token: body.token,
    newPassword: body.newPassword,
    requestIp: String(body.requestIp || forwardedIp || headers['x-real-ip'] || 'unknown').slice(0, 64),
    userAgent: String(body.userAgent || headers['user-agent'] || 'unknown').slice(0, 512)
  }
}];
```

### 3. IF - Is Forgot Password

Condition:

```text
{{$json.route}} equals forgot-password
```

### 4. IF - Is Reset Password

Condition:

```text
{{$json.route}} equals reset-password
```

### 5. Code - Prepare Forgot Password

```javascript
const crypto = require('crypto');

const genericResponse = {
  success: true,
  message: 'If the email exists, a reset link has been sent.'
};

function sqlString(value, maxLength) {
  return String(value || '')
    .slice(0, maxLength)
    .replace(/'/g, "''");
}

const email = String($json.email || '').trim().toLowerCase();
const requestIp = String($json.requestIp || 'unknown').slice(0, 64);
const userAgent = String($json.userAgent || 'unknown').slice(0, 512);

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
  return [{ json: { shouldQuery: false, response: genericResponse } }];
}

const token = crypto.randomBytes(48).toString('base64url');
const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const resetBaseUrl = $env.NEXTJS_RESET_BASE_URL || 'https://your-nextjs-domain.com/reset-password';
const resetUrl = `${resetBaseUrl}?token=${encodeURIComponent(token)}`;

const oracleSql = `
SELECT app_auth_reset_pkg.request_password_reset_json(
  p_email => '${sqlString(email, 320)}',
  p_token_hash => '${tokenHash}',
  p_request_ip => '${sqlString(requestIp, 64)}',
  p_user_agent => '${sqlString(userAgent, 512)}'
) AS result_json
FROM dual`;

return [{
  json: {
    shouldQuery: true,
    email,
    token,
    tokenHash,
    resetUrl,
    requestIp,
    userAgent,
    oracleSql,
    response: genericResponse
  }
}];
```

### 6. IF - Forgot Should Query Oracle

Condition:

```text
{{$json.shouldQuery}} is true
```

### 7. Oracle Database - Create Reset Request

- Action: `Execute SQL`
- Statement:

```text
{{$json.oracleSql}}
```

The generated SQL calls:

```sql
SELECT app_auth_reset_pkg.request_password_reset_json(
  p_email => :email,
  p_token_hash => :token_hash,
  p_request_ip => :request_ip,
  p_user_agent => :user_agent
) AS result_json
FROM dual;
```

### 8. Code - Parse Forgot Result

```javascript
const row = $input.first().json;
const raw = row.RESULT_JSON || row.result_json || row.Result_JSON || Object.values(row)[0];
let result = {};

try {
  result = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch {
  result = {};
}

const prepared = $('Prepare Forgot Password').first().json;

return [{
  json: {
    ...prepared,
    shouldSend: result.shouldSend === true,
    dbResult: result
  }
}];
```

### 9. IF - Should Send Reset Email

Condition:

```text
{{$json.shouldSend}} is true
```

### 10. Email Send - Send Reset Email

- From: `{{$env.PASSWORD_RESET_FROM_EMAIL || 'no-reply@your-company.com'}}`
- To: `{{$json.email}}`
- Subject: `Reset your Oracle DBA Portal password`
- HTML:

```html
<!doctype html>
<html>
  <body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#172033;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #d9e2ef;">
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 12px;font-size:22px;color:#111827;">Reset your password</h1>
                <p style="margin:0 0 20px;line-height:1.6;">We received a request to reset your Oracle DBA Portal password.</p>
                <p style="margin:0 0 24px;">
                  <a href="{{$json.resetUrl}}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold;">Reset password</a>
                </p>
                <p style="margin:0 0 10px;line-height:1.6;">This link expires in 15 minutes and can be used only once.</p>
                <p style="margin:0 0 10px;line-height:1.6;">If the button does not work, paste this URL into your browser:</p>
                <p style="word-break:break-all;margin:0 0 20px;color:#2563eb;">{{$json.resetUrl}}</p>
                <p style="margin:0;line-height:1.6;color:#4b5563;">If you did not request this reset, ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### 11. Code - Forgot Generic Response

```javascript
return [{
  json: {
    success: true,
    message: 'If the email exists, a reset link has been sent.'
  }
}];
```

### 12. Code - Prepare Reset Password

```javascript
const crypto = require('crypto');

const failureResponse = {
  success: false,
  message: 'Invalid or expired reset link.'
};

function sqlString(value, maxLength) {
  return String(value || '')
    .slice(0, maxLength)
    .replace(/'/g, "''");
}

function passwordError(password) {
  if (password.length < 12) return true;
  if (!/[a-z]/.test(password)) return true;
  if (!/[A-Z]/.test(password)) return true;
  if (!/\d/.test(password)) return true;
  if (!/[^A-Za-z0-9]/.test(password)) return true;
  return false;
}

const token = String($json.token || '').trim();
const newPassword = String($json.newPassword || '');
const requestIp = String($json.requestIp || 'unknown').slice(0, 64);
const userAgent = String($json.userAgent || 'unknown').slice(0, 512);

if (token.length < 32 || token.length > 512 || passwordError(newPassword)) {
  return [{ json: { shouldQuery: false, ...failureResponse } }];
}

const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const newSalt = crypto.randomBytes(32).toString('hex');
const newPasswordHash = crypto.createHash('sha256').update(`${newSalt}:${newPassword}`, 'utf8').digest('hex');

const oracleSql = `
SELECT app_auth_reset_pkg.reset_password_json(
  p_token_hash => '${tokenHash}',
  p_new_salt => '${newSalt}',
  p_new_password_hash => '${newPasswordHash}',
  p_request_ip => '${sqlString(requestIp, 64)}',
  p_user_agent => '${sqlString(userAgent, 512)}'
) AS result_json
FROM dual`;

return [{
  json: {
    shouldQuery: true,
    oracleSql
  }
}];
```

### 13. IF - Reset Should Query Oracle

Condition:

```text
{{$json.shouldQuery}} is true
```

### 14. Oracle Database - Reset Password Procedure

- Action: `Execute SQL`
- Statement:

```text
{{$json.oracleSql}}
```

The generated SQL calls:

```sql
SELECT app_auth_reset_pkg.reset_password_json(
  p_token_hash => :token_hash,
  p_new_salt => :new_salt,
  p_new_password_hash => :new_password_hash,
  p_request_ip => :request_ip,
  p_user_agent => :user_agent
) AS result_json
FROM dual;
```

### 15. Code - Parse Reset Result

```javascript
const row = $input.first().json;
const raw = row.RESULT_JSON || row.result_json || row.Result_JSON || Object.values(row)[0];

try {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return [{
    json: {
      success: parsed.success === true,
      message: parsed.message || 'Invalid or expired reset link.'
    }
  }];
} catch {
  return [{
    json: {
      success: false,
      message: 'Invalid or expired reset link.'
    }
  }];
}
```

### 16. Respond to Webhook Nodes

Forgot response:

```json
{
  "success": true,
  "message": "If the email exists, a reset link has been sent."
}
```

Reset response:

```json
{{$json}}
```

Unauthorized route response:

```json
{
  "success": false,
  "message": "Unauthorized."
}
```

## Request and Response Examples

Forgot password request from Next.js to n8n:

```json
{
  "flow": "forgot-password",
  "email": "user@example.com",
  "requestIp": "127.0.0.1",
  "userAgent": "Mozilla/5.0"
}
```

Forgot password response:

```json
{
  "success": true,
  "message": "If the email exists, a reset link has been sent."
}
```

Reset password request from Next.js to n8n:

```json
{
  "flow": "reset-password",
  "token": "RAW_RESET_TOKEN",
  "newPassword": "NewStrongPassword123!",
  "requestIp": "127.0.0.1",
  "userAgent": "Mozilla/5.0"
}
```

Reset password success:

```json
{
  "success": true,
  "message": "Password reset successful. You can now login."
}
```

Reset password failure:

```json
{
  "success": false,
  "message": "Invalid or expired reset link."
}
```

## Security Notes

- Raw reset tokens are generated in n8n and emailed once.
- Oracle stores only `SHA256(raw_token)`.
- Password reset generates a new random salt every time.
- Current password hashing remains compatible with existing login: `SHA256(salt || ':' || password)`.
- Previous unused reset tokens are invalidated before a new one is issued.
- Reset links expire after 15 minutes.
- Tokens are single-use.
- Password reset clears `failed_login_count` and `locked_until`.
- Active sessions for the user are revoked after password reset.
- Forgot-password responses are generic.
- n8n webhook calls require `X-Admin-Webhook-Secret`.
- Email/IP rate limiting is enforced in `app_auth_reset_pkg.request_password_reset`.

## Rate Limits

The PL/SQL package enforces:

- 3 forgot-password attempts per normalized email per 15 minutes
- 20 forgot-password attempts per IP per 15 minutes

For production, also add reverse proxy rate limiting in front of n8n:

```nginx
limit_req_zone $binary_remote_addr zone=password_reset_ip:10m rate=10r/m;

location /webhook/auth/ {
  limit_req zone=password_reset_ip burst=20 nodelay;
  proxy_pass http://127.0.0.1:5678;
}
```

## Testing Scenarios

1. Existing active email receives a reset email.
2. Unknown email receives the same generic response and no email.
3. Inactive user receives the same generic response and no email.
4. Multiple forgot requests invalidate earlier unused reset tokens.
5. Token cannot be reused after a successful reset.
6. Token fails after 15 minutes.
7. Reset clears `failed_login_count` and `locked_until`.
8. Reset revokes existing app sessions.
9. Weak password is rejected before Oracle update.
10. Missing or wrong `X-Admin-Webhook-Secret` is rejected by n8n.
11. Rate limit blocks repeated email/IP attempts while keeping the generic response.

## Deployment Checklist

1. Run `db/oracle_password_reset.sql` as `APP_DBA`.
2. Set `NEXT_PUBLIC_ADMIN_WEBHOOK_URL` and `ADMIN_WEBHOOK_SECRET` in Next.js.
3. Set `ADMIN_WEBHOOK_SECRET`, `NEXTJS_RESET_BASE_URL`, and `PASSWORD_RESET_FROM_EMAIL` in n8n.
4. Import `docs/password-reset-n8n-workflow.json`.
5. Select Oracle and SMTP credentials in n8n.
6. Test with `/webhook-test/...`.
7. Activate the workflow.
8. Change the app webhook URL to `/webhook/...` for production.
9. Serve Next.js and n8n only through HTTPS outside localhost.
10. Add reverse proxy request limits and n8n execution log retention.
