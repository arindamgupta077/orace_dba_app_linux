# Oracle Net Files — n8n Workflow Guide

This guide covers the **General Admin → Listener Control** buttons:

- **Check listener.ora File** sends `action: "fetch_listener"`
- **Check tnsnames.ora File** sends `action: "fetch_tnsnames"`

Both buttons use the existing DBA webhook configured by `NEXT_PUBLIC_DBA_WEBHOOK_URL`.

## App Payload

The app posts this shape to n8n:

```json
{
  "action": "fetch_listener",
  "db": "ORCL",
  "params": {},
  "requested_by": "dba_user",
  "user_id": 1,
  "environment": "PROD",
  "os": "Linux",
  "db_type": "Standalone"
}
```

For `tnsnames.ora`, only `action` changes:

```json
{
  "action": "fetch_tnsnames"
}
```

## Workflow Shape

1. **Webhook**
   - Method: `POST`
   - Path: your existing DBA path, for example `/webhook/dba-agent`
   - Response mode: `Using Respond to Webhook node`

2. **Validate Token** optional but recommended
   - Check header `X-DBA-Token` against an n8n environment variable.

3. **Switch**
   - Route by `{{$json.body.action || $json.action}}`
   - Add branches:
     - `fetch_listener`
     - `fetch_tnsnames`

4. **SSH / Execute Command**
   - Run a read-only command on the Oracle DB server.

5. **Format Response**
   - Return a simple JSON object with `status`, `raw_output`, and `ai_summary`.

6. **Respond to Webhook**
   - Response body: first item JSON from the Format Response node.

## Linux SSH Commands

Use this command for `fetch_listener`:

```bash
# 1. Try to load Oracle environment variables from standard profiles
for profile in "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile" "/etc/profile"; do
  if [ -f "$profile" ]; then
    . "$profile" >/dev/null 2>&1
  fi
done

# Helper function to check and display file
check_file() {
  if [ -n "$1" ] && [ -f "$1" ]; then
    cat "$1"
    exit 0
  fi
}

# 2. Check environment-derived locations
check_file "$TNS_ADMIN/listener.ora"
check_file "$ORACLE_HOME/network/admin/listener.ora"

# 3. Fallback: Parse /etc/oratab or /var/opt/oracle/oratab
for oratab in /etc/oratab /var/opt/oracle/oratab; do
  if [ -f "$oratab" ]; then
    while read -r line || [ -n "$line" ]; do
      case "$line" in
        \#*|"") continue ;;
      esac
      home=$(echo "$line" | cut -d: -f2)
      if [ -n "$home" ]; then
        check_file "$home/network/admin/listener.ora"
      fi
    done < "$oratab"
  fi
done

# 4. Fallback: Scan common installation directories
for home in /u01/app/oracle/product/*/* /oracle/product/*/*; do
  check_file "$home/network/admin/listener.ora"
done

echo "listener.ora not found. Checked environment, oratab, and common paths."
exit 2
```

Use this command for `fetch_tnsnames`:

```bash
# 1. Try to load Oracle environment variables from standard profiles
for profile in "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile" "/etc/profile"; do
  if [ -f "$profile" ]; then
    . "$profile" >/dev/null 2>&1
  fi
done

# Helper function to check and display file
check_file() {
  if [ -n "$1" ] && [ -f "$1" ]; then
    cat "$1"
    exit 0
  fi
}

# 2. Check environment-derived locations
check_file "$TNS_ADMIN/tnsnames.ora"
check_file "$ORACLE_HOME/network/admin/tnsnames.ora"

# 3. Fallback: Parse /etc/oratab or /var/opt/oracle/oratab
for oratab in /etc/oratab /var/opt/oracle/oratab; do
  if [ -f "$oratab" ]; then
    while read -r line || [ -n "$line" ]; do
      case "$line" in
        \#*|"") continue ;;
      esac
      home=$(echo "$line" | cut -d: -f2)
      if [ -n "$home" ]; then
        check_file "$home/network/admin/tnsnames.ora"
      fi
    done < "$oratab"
  fi
done

# 4. Fallback: Scan common installation directories
for home in /u01/app/oracle/product/*/* /oracle/product/*/*; do
  check_file "$home/network/admin/tnsnames.ora"
done

echo "tnsnames.ora not found. Checked environment, oratab, and common paths."
exit 2
```

## Windows PowerShell Commands

Use this command for `fetch_listener`:

```powershell
$candidates = @()
if ($env:TNS_ADMIN) { $candidates += Join-Path $env:TNS_ADMIN "listener.ora" }
if ($env:ORACLE_HOME) { $candidates += Join-Path $env:ORACLE_HOME "network\admin\listener.ora" }

# Fallback: Query Windows Registry for Oracle Homes if environment variables are not loaded
$oracleRegPath = "HKLM:\SOFTWARE\ORACLE"
if (Test-Path $oracleRegPath) {
  $subkeys = Get-ChildItem -Path $oracleRegPath -ErrorAction SilentlyContinue
  foreach ($subkey in $subkeys) {
    $values = Get-ItemProperty -Path $subkey.PSPath -ErrorAction SilentlyContinue
    if ($values.TNS_ADMIN) { $candidates += Join-Path $values.TNS_ADMIN "listener.ora" }
    if ($values.ORACLE_HOME) { $candidates += Join-Path $values.ORACLE_HOME "network\admin\listener.ora" }
  }
}

$file = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $file) {
  Write-Output "listener.ora not found. Checked environment variables and registry."
  exit 2
}
Get-Content -LiteralPath $file -Raw
```

Use this command for `fetch_tnsnames`:

```powershell
$candidates = @()
if ($env:TNS_ADMIN) { $candidates += Join-Path $env:TNS_ADMIN "tnsnames.ora" }
if ($env:ORACLE_HOME) { $candidates += Join-Path $env:ORACLE_HOME "network\admin\tnsnames.ora" }

# Fallback: Query Windows Registry for Oracle Homes if environment variables are not loaded
$oracleRegPath = "HKLM:\SOFTWARE\ORACLE"
if (Test-Path $oracleRegPath) {
  $subkeys = Get-ChildItem -Path $oracleRegPath -ErrorAction SilentlyContinue
  foreach ($subkey in $subkeys) {
    $values = Get-ItemProperty -Path $subkey.PSPath -ErrorAction SilentlyContinue
    if ($values.TNS_ADMIN) { $candidates += Join-Path $values.TNS_ADMIN "tnsnames.ora" }
    if ($values.ORACLE_HOME) { $candidates += Join-Path $values.ORACLE_HOME "network\admin\tnsnames.ora" }
  }
}

$file = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $file) {
  Write-Output "tnsnames.ora not found. Checked environment variables and registry."
  exit 2
}
Get-Content -LiteralPath $file -Raw
```

## Format Response Code Node

Place a Code node after the SSH node. Adjust the SSH node name if needed.

```js
const webhook = $("DBA Webhook Entry").first().json;
const body = webhook.body || webhook;
const action = body.action;
const db = body.db;

const ssh = $input.first().json;
const output = String(
  ssh.stdout ||
  ssh.output ||
  ssh.data ||
  ssh.stderr ||
  ""
).trim();

const fileName = action === "fetch_tnsnames" ? "tnsnames.ora" : "listener.ora";
const success = !ssh.stderr && output && !/not found/i.test(output);

return [
  {
    json: {
      status: success ? "success" : "error",
      request_id: `NET-${Date.now()}`,
      action,
      db_status: success ? "healthy" : "warning",
      ai_summary: success
        ? `${fileName} content fetched for ${db}.`
        : `Unable to fetch ${fileName} for ${db}.`,
      findings: [],
      recommendations: [],
      raw_data: {
        file_name: fileName
      },
      raw_output: output || `${fileName} returned no content.`
    }
  }
];
```

## Expected Response

The app displays `raw_output` in the console panel.

```json
{
  "status": "success",
  "request_id": "NET-1783760000000",
  "action": "fetch_listener",
  "db_status": "healthy",
  "ai_summary": "listener.ora content fetched for ORCL.",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "file_name": "listener.ora"
  },
  "raw_output": "LISTENER =\n  (DESCRIPTION_LIST = ...)"
}
```

## Switch Node Reminder

If your existing DBA workflow already has a Switch node by `action`, add only these two new branches:

- `fetch_listener` → SSH command for `listener.ora` → Format Response → Respond to Webhook
- `fetch_tnsnames` → SSH command for `tnsnames.ora` → Format Response → Respond to Webhook
