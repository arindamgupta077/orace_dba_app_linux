# Deploy on RHEL 9.7 (Node 24.14.1)

This guide covers bare-metal deployment on a RHEL server where **Node 24.14.1**, **n8n**, and **Oracle Database** already run.

The app host OS does not affect `lib/constants.ts` — the `os` field on each database entry describes the **target Oracle host** that n8n SSHs into (Windows or Linux), not the machine running this Next.js app.

## Architecture on RHEL

```text
Browser → Next.js (port 3000) → Oracle DB (thin mode, local listener)
                              → n8n webhook → SSH → target DB host (Windows/Linux)
                              ← n8n callbacks (/api/alerts, /api/chat/approval, /api/datapump/callback)
```

Oracle connectivity uses **node-oracledb thin mode** — no Oracle Instant Client install is required on the app host.

## Prerequisites

| Item | Notes |
|------|-------|
| Node.js | `24.14.1` (`node -v`) |
| npm | Bundled with Node (`npm -v`) |
| Firewall | Open port 3000 (or 443 via reverse proxy) |
| Oracle listener | App can reach `ORACLE_CONNECTION_STRING` (e.g. `localhost:1521/ORCL`) |
| n8n | Running and reachable from the app; update n8n `APP_CALLBACK_URL` to the app URL |
| Build tools (optional) | `gcc-c++ make python3` if `npm ci` needs to compile native addons |

## 1. Transfer the application

On your workstation:

1. Push changes to GitHub.
2. Download the repository as a ZIP from GitHub.
3. Copy the ZIP to the RHEL server (SCP, SFTP, etc.).

On the RHEL server:

```bash
sudo mkdir -p /opt/oracle-dba-portal
sudo chown "$USER":"$USER" /opt/oracle-dba-portal
cd /opt/oracle-dba-portal

# Extract — folder name matches the GitHub archive
unzip -o oracle_dba_app-main.zip
cd oracle_dba_app-main   # adjust if your zip extracts to a different folder name
```

## 2. Configure environment

```bash
cp .env.example .env.local
chmod 600 .env.local
vi .env.local
```

Set production values:

```env
ORACLE_CONNECTION_STRING=localhost:1521/ORCL
ORACLE_USER=APP_DBA
ORACLE_PASSWORD=<your-password>
APP_AUTH_SECRET=<long-random-secret>

NEXT_PUBLIC_DBA_MOCK=false
NEXT_PUBLIC_DBA_WEBHOOK_URL=http://127.0.0.1:5678/webhook/dba-agent
NEXT_PUBLIC_DBA_TOKEN=<n8n-webhook-token>
NEXT_PUBLIC_DEFAULT_DB=ORCL
```

| Variable | RHEL guidance |
|----------|---------------|
| `ORACLE_CONNECTION_STRING` | Use the listener on this server (`host:port/service_name`) |
| `NEXT_PUBLIC_DBA_WEBHOOK_URL` | n8n webhook URL — use `127.0.0.1` if n8n is on the same host |
| `NEXT_PUBLIC_DBA_MOCK` | Must be `false` in production |
| `APP_AUTH_SECRET` | Generate with `openssl rand -base64 48` |

### n8n configuration (same server)

In n8n environment variables or workflow settings, set:

| n8n variable | Example |
|--------------|---------|
| `APP_CALLBACK_URL` | `http://127.0.0.1:3000` or `https://dba.yourdomain.com` |
| `ORACLE_HOST` | Target DB server IP (may differ from app host) |
| `ORACLE_SSH_USER` | `oracle` (Linux target) or Windows SSH user |

n8n must be able to reach these callback routes (no auth cookie required):

- `POST /api/alerts`
- `PATCH /api/alerts`
- `POST /api/chat/approval`
- `POST /api/datapump/callback`

## 3. Install dependencies and build

```bash
node -v    # expect v24.14.1
npm -v

npm ci
npm run build
```

`npm ci` must run **on the RHEL server** so native packages (`oracledb`, `@next/swc-linux-x64-gnu`, `sharp`) resolve for Linux glibc.

If `npm ci` fails on native compilation:

```bash
sudo dnf install -y gcc-c++ make python3
npm ci
```

## 4. Verify Oracle schema

If not already done, create app tables against your Oracle instance:

```bash
sqlplus APP_DBA/<password>@localhost:1521/ORCL @db/oracle_app_setup.sql
```

Default bootstrap login (change after first login):

- Username: `ARINDAM`
- Password: `Password123`

## 5. Start the application

### Option A — foreground test run

```bash
export NODE_ENV=production
export HOSTNAME=0.0.0.0
export PORT=3000
npm run start
```

Open `http://<server-ip>:3000` and log in.

### Option B — systemd service (recommended)

```bash
sudo cp deploy/oracle-dba-portal.service /etc/systemd/system/
sudo vi /etc/systemd/system/oracle-dba-portal.service
```

Edit `User`, `WorkingDirectory`, and `EnvironmentFile` to match your install path.

```bash
sudo systemctl daemon-reload
sudo systemctl enable oracle-dba-portal
sudo systemctl start oracle-dba-portal
sudo systemctl status oracle-dba-portal
journalctl -u oracle-dba-portal -f
```

### Option C — Docker (optional)

```bash
docker build -t oracle-dba-ai-portal .
docker run -d --name dba-portal -p 3000:3000 --env-file .env.local oracle-dba-ai-portal
```

## 6. Firewall and SELinux

```bash
# Firewalld — allow direct access on port 3000
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# If using nginx on port 443 instead:
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

If SELinux blocks nginx → Node proxying:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

## 7. Reverse proxy with TLS (production)

Production sets `secure` cookies when `NODE_ENV=production`. Browsers require **HTTPS** for session cookies.

Use the example nginx config:

```bash
sudo cp deploy/nginx-dba-portal.conf.example /etc/nginx/conf.d/dba-portal.conf
sudo vi /etc/nginx/conf.d/dba-portal.conf
sudo nginx -t
sudo systemctl reload nginx
```

Point `APP_CALLBACK_URL` and any n8n HTTP nodes at `https://dba.yourdomain.com`.

## 8. Post-deploy checklist

- [ ] Login works at the app URL
- [ ] DBA action triggers n8n webhook (check n8n execution log)
- [ ] n8n callbacks reach `/api/alerts` (no 401)
- [ ] Oracle pool pre-warm in logs: `[oracle] connection pool pre-warmed`
- [ ] Scheduler started: no `[scheduler] Failed to start` warning
- [ ] Change default `ARINDAM` password
- [ ] Rotate `APP_AUTH_SECRET` and `NEXT_PUBLIC_DBA_TOKEN`

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Login succeeds then immediately logs out | HTTP without TLS in production (`secure` cookie dropped) — use HTTPS or nginx |
| `Missing required environment variable` | `.env.local` missing or not loaded before `npm run build` / service start |
| Oracle connection timeout | Wrong `ORACLE_CONNECTION_STRING` or listener not reachable from app process |
| n8n actions hang | `NEXT_PUBLIC_DBA_WEBHOOK_URL` wrong; or n8n cannot SSH to target DB |
| n8n callbacks fail | `APP_CALLBACK_URL` still points to old Windows host |
| `npm ci` platform errors | Ran install on Windows and copied `node_modules` — delete `node_modules` and run `npm ci` on RHEL |

## Updating the application

```bash
cd /opt/oracle-dba-portal/oracle_dba_app-main
# transfer new zip and extract over existing files, or git pull
npm ci
npm run build
sudo systemctl restart oracle-dba-portal
```
