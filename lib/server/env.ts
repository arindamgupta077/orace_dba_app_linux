import "server-only";

interface ServerEnv {
  oracleConnectString: string;
  oracleUser: string;
  oraclePassword: string;
  webhookUrl: string;
  webhookToken: string;
  adminWebhookUrl: string;
  adminWebhookSecret: string;
  mockMode: boolean;
  authSecret: string;
  sessionCookieName: string;
  sessionTtlHours: number;
  rememberSessionTtlDays: number;
  securityPostureUploadDir: string;
  securityPostureWebhookUrl: string;
  securityPostureWebhookToken: string;
  securityPostureMaxUploadBytes: number;
}

let cached: ServerEnv | null = null;

function readRequired(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveNumber(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: expected a positive number but received "${raw}"`);
  }
  return value;
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const webhookUrl =
    process.env.DBA_WEBHOOK_URL?.trim() ||
    process.env.NEXT_PUBLIC_DBA_WEBHOOK_URL?.trim() ||
    "";
  const webhookToken =
    process.env.DBA_WEBHOOK_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_DBA_TOKEN?.trim() ||
    "";
  const adminWebhookUrl = process.env.NEXT_PUBLIC_ADMIN_WEBHOOK_URL?.trim() || "";
  const adminWebhookSecret = process.env.ADMIN_WEBHOOK_SECRET?.trim() || "";

  cached = {
    oracleConnectString: readRequired("ORACLE_CONNECTION_STRING"),
    oracleUser: readRequired("ORACLE_USER"),
    oraclePassword: readRequired("ORACLE_PASSWORD"),
    webhookUrl,
    webhookToken,
    adminWebhookUrl,
    adminWebhookSecret,
    mockMode: process.env.NEXT_PUBLIC_DBA_MOCK !== "false",
    authSecret: readRequired("APP_AUTH_SECRET"),
    sessionCookieName: process.env.APP_SESSION_COOKIE_NAME?.trim() || "dba_session",
    sessionTtlHours: parsePositiveNumber("APP_SESSION_TTL_HOURS", 8),
    rememberSessionTtlDays: parsePositiveNumber("APP_SESSION_REMEMBER_TTL_DAYS", 30),
    securityPostureUploadDir: process.env.SECURITY_POSTURE_UPLOAD_DIR?.trim() || "./uploads/nessus-reports",
    securityPostureWebhookUrl: process.env.SECURITY_POSTURE_N8N_WEBHOOK_URL?.trim() || "",
    securityPostureWebhookToken: process.env.SECURITY_POSTURE_N8N_WEBHOOK_TOKEN?.trim() || "",
    securityPostureMaxUploadBytes: parsePositiveNumber("SECURITY_POSTURE_MAX_UPLOAD_MB", 25) * 1024 * 1024
  };

  return cached;
}
