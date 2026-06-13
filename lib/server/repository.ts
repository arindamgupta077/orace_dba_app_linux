import "server-only";

import type { BindParameters, Connection } from "oracledb";

import { getServerEnv } from "@/lib/server/env";
import { withOracleConnection } from "@/lib/server/oracle";
import { generateSessionToken, hashSessionToken, normalizeUsername } from "@/lib/server/security";
import type {
  AlertNotification,
  AlertNotificationSeverity,
  AlertNotificationStatus,
  AlertNotificationType,
  AuditLogItem,
  DbaAction,
  DbaAlertLogRow,
  DbaAlertLogSeverity,
  DbaAlertLogStatus,
  DbaRequestPayload,
  DbaResponse,
  DashboardHistoryRow,
  DashboardMetrics,
  RequestHistoryItem,
  UserSession
} from "@/types/dba";

type UserRole = UserSession["role"];
type AuthMode = UserSession["authMode"];

type DbRow = Record<string, unknown>;

interface UserLoginRecord {
  userId: number;
  username: string;
  role: UserRole;
  passwordSalt: string;
  passwordHash: string;
  apiTokenHash?: string;
  isActive: boolean;
  lockedUntil?: Date;
}

interface SessionRecord {
  userId: number;
  user: UserSession;
  expiresAt: string;
}

interface PersistRunDataInput {
  historyRequestId: string;
  externalRequestId?: string;
  requestedBy: string;
  action: DbaAction;
  db: string;
  status: DbaResponse["status"] | "error";
  aiSummary?: string;
  rawOutput?: string;
  rawData: DbaResponse["raw_data"];
  findings?: DbaResponse["findings"];
  recommendations?: DbaResponse["recommendations"];
}

interface InsertAlertNotificationInput {
  id: string;
  source?: string;
  alertType?: AlertNotificationType;
  db: string;
  tablespace?: string;
  objectName?: string;
  severity: AlertNotificationSeverity;
  status?: AlertNotificationStatus;
  message: string;
  utilizationPct?: number;
  thresholdPct?: number;
  criticalPct?: number;
  usedGb?: number;
  freeGb?: number;
  extendSizeGb?: number;
  datafile?: string;
  workflowRunId?: string;
  approvalUrl?: string;
  rejectUrl?: string;
  callbackUrl?: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

interface ListAlertNotificationsInput {
  db?: string;
  alertType?: AlertNotificationType;
  status?: AlertNotificationStatus;
  limit?: number;
  offset?: number;
}

interface ListAlertNotificationsResult {
  items: AlertNotification[];
  total: number;
  limit: number;
  offset: number;
}

interface UpdateAlertNotificationInput {
  id: string;
  status: AlertNotificationStatus;
  actor: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface PatchAlertNotificationInput {
  id: string;
  status?: AlertNotificationStatus;
  actor?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

function asDate(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function toIsoString(value: unknown) {
  const date = asDate(value);
  return date ? date.toISOString() : new Date().toISOString();
}

function toIstIsoString(value: unknown) {
  const date = asDate(value);
  if (!date) return new Date().toISOString();
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
}

function mapUserRole(role: unknown): UserRole {
  const normalized = String(role || "operator").toLowerCase();
  if (normalized === "dba_admin" || normalized === "operator" || normalized === "auditor") {
    return normalized;
  }
  return "operator";
}

function mapAuthMode(): AuthMode {
  return "jwt";
}

function parseJson<T>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function nullableNumber(value?: number) {
  return Number.isFinite(value) ? value : null;
}

function mapAlertSeverity(value: unknown): AlertNotificationSeverity {
  const normalized = String(value || "warning").toLowerCase();
  if (normalized === "info" || normalized === "warning" || normalized === "critical" || normalized === "error") {
    return normalized;
  }
  return "warning";
}

function mapAlertStatus(value: unknown): AlertNotificationStatus {
  const normalized = String(value || "pending_approval").toLowerCase();
  if (
    normalized === "pending_approval" ||
    normalized === "approved" ||
    normalized === "rejected" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "acknowledged"
  ) {
    return normalized;
  }
  return "pending_approval";
}

function mapAlertType(value: unknown): AlertNotificationType {
  const normalized = String(value || "generic")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
  return normalized || "generic";
}

function mapAlertNotificationRow(row: DbRow): AlertNotification {
  const tablespace = row.TABLESPACE_NAME ? String(row.TABLESPACE_NAME) : undefined;

  return {
    id: String(row.ALERT_ID),
    source: String(row.SOURCE_NAME || "n8n"),
    alert_type: mapAlertType(row.ALERT_TYPE),
    db: String(row.DB_NAME),
    tablespace,
    object_name: row.OBJECT_NAME ? String(row.OBJECT_NAME) : tablespace,
    severity: mapAlertSeverity(row.SEVERITY),
    status: mapAlertStatus(row.ALERT_STATUS),
    message: row.MESSAGE_TEXT ? String(row.MESSAGE_TEXT) : "",
    utilization_pct: row.UTILIZATION_PCT != null ? Number(row.UTILIZATION_PCT) : undefined,
    threshold_pct: row.THRESHOLD_PCT != null ? Number(row.THRESHOLD_PCT) : undefined,
    critical_pct: row.CRITICAL_PCT != null ? Number(row.CRITICAL_PCT) : undefined,
    used_gb: row.USED_GB != null ? Number(row.USED_GB) : undefined,
    free_gb: row.FREE_GB != null ? Number(row.FREE_GB) : undefined,
    extend_size_gb: row.EXTEND_SIZE_GB != null ? Number(row.EXTEND_SIZE_GB) : undefined,
    datafile: row.DATAFILE_NAME ? String(row.DATAFILE_NAME) : undefined,
    workflow_run_id: row.WORKFLOW_RUN_ID ? String(row.WORKFLOW_RUN_ID) : undefined,
    approval_url: row.APPROVAL_URL ? String(row.APPROVAL_URL) : undefined,
    reject_url: row.REJECT_URL ? String(row.REJECT_URL) : undefined,
    callback_url: row.CALLBACK_URL ? String(row.CALLBACK_URL) : undefined,
    created_by: String(row.CREATED_BY || "n8n"),
    approved_by: row.APPROVED_BY ? String(row.APPROVED_BY) : undefined,
    created_at: toIsoString(row.CREATED_AT),
    updated_at: toIsoString(row.UPDATED_AT),
    approved_at: row.APPROVED_AT ? toIsoString(row.APPROVED_AT) : undefined,
    completed_at: row.COMPLETED_AT ? toIsoString(row.COMPLETED_AT) : undefined,
    metadata: parseJson<Record<string, unknown>>(row.METADATA_JSON)
  };
}

async function executeOne<T>(fn: (connection: Connection) => Promise<T>) {
  return withOracleConnection(fn);
}

export async function findUserForLogin(username: string): Promise<UserLoginRecord | null> {
  const normalized = normalizeUsername(username);
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         role,
         password_salt,
         password_hash,
         api_token_hash,
         is_active,
         locked_until
       FROM app_users
       WHERE username = :username`,
      { username: normalized }
    );

    const row = result.rows?.[0];
    if (!row) return null;

    return {
      userId: Number(row.USER_ID),
      username: String(row.USERNAME),
      role: mapUserRole(row.ROLE),
      passwordSalt: String(row.PASSWORD_SALT),
      passwordHash: String(row.PASSWORD_HASH),
      apiTokenHash: row.API_TOKEN_HASH ? String(row.API_TOKEN_HASH) : undefined,
      isActive: String(row.IS_ACTIVE || "N") === "Y",
      lockedUntil: asDate(row.LOCKED_UNTIL)
    };
  });
}

export async function registerFailedLogin(userId: number) {
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_users
       SET failed_login_count = NVL(failed_login_count, 0) + 1,
           locked_until = CASE
             WHEN NVL(failed_login_count, 0) + 1 >= 5 THEN SYSTIMESTAMP + NUMTODSINTERVAL(15, 'MINUTE')
             ELSE locked_until
           END,
           updated_at = SYSTIMESTAMP
       WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );
  });
}

export async function clearFailedLogin(userId: number) {
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_users
       SET failed_login_count = 0,
           locked_until = NULL,
           last_login_at = SYSTIMESTAMP,
           updated_at = SYSTIMESTAMP
       WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );
  });
}

export async function createSession(userId: number, authMode: AuthMode, rememberSession: boolean, ipAddress?: string, userAgent?: string) {
  const { rememberSessionTtlDays, sessionTtlHours } = getServerEnv();
  const rawToken = generateSessionToken();
  const hashedToken = hashSessionToken(rawToken);
  const expiresAt = new Date();
  if (rememberSession) {
    expiresAt.setDate(expiresAt.getDate() + rememberSessionTtlDays);
  } else {
    expiresAt.setHours(expiresAt.getHours() + sessionTtlHours);
  }

  await executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO app_sessions (
         session_token_hash,
         user_id,
         auth_mode,
         expires_at,
         ip_address,
         user_agent
       ) VALUES (
         :sessionTokenHash,
         :userId,
         :authMode,
         :expiresAt,
         :ipAddress,
         :userAgent
       )`,
      {
        sessionTokenHash: hashedToken,
        userId,
        authMode,
        expiresAt,
        ipAddress: ipAddress ? ipAddress.slice(0, 64) : null,
        userAgent: userAgent ? userAgent.slice(0, 512) : null
      },
      { autoCommit: true }
    );
  });

  return { rawToken, expiresAt: expiresAt.toISOString() };
}

export async function getSessionByToken(sessionToken: string): Promise<SessionRecord | null> {
  if (!sessionToken) return null;

  const tokenHash = hashSessionToken(sessionToken);
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         s.user_id,
         s.auth_mode,
         s.expires_at,
         u.username,
         u.role
       FROM app_sessions s
       JOIN app_users u ON u.user_id = s.user_id
       WHERE s.session_token_hash = :sessionTokenHash
         AND s.revoked_at IS NULL
         AND s.expires_at > SYSTIMESTAMP
         AND u.is_active = 'Y'`,
      { sessionTokenHash: tokenHash }
    );

    const row = result.rows?.[0];
    if (!row) return null;

    const userId = Number(row.USER_ID);
    return {
      userId,
      expiresAt: toIsoString(row.EXPIRES_AT),
      user: {
        username: String(row.USERNAME),
        userId,
        role: mapUserRole(row.ROLE),
        authMode: mapAuthMode()
      }
    };
  });
}

export async function revokeSession(sessionToken: string) {
  if (!sessionToken) return;
  const tokenHash = hashSessionToken(sessionToken);

  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_sessions
       SET revoked_at = SYSTIMESTAMP
       WHERE session_token_hash = :sessionTokenHash
         AND revoked_at IS NULL`,
      { sessionTokenHash: tokenHash },
      { autoCommit: true }
    );
  });
}

export async function insertAuditLog(input: {
  actor: string;
  action: DbaAction | "login" | "logout" | "retry";
  db?: string;
  status: string;
  detail: string;
  metadata?: Record<string, unknown>;
}) {
  // Audit logs are inserted from n8n into app_audit_logs table, so we do not insert from the application end.
  console.log(`[Audit Log Bypass] actor: ${input.actor}, action: ${input.action}, db: ${input.db}, status: ${input.status}, detail: ${input.detail}`);
}

export async function listAuditLogs(limit = 200): Promise<AuditLogItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 1000);

  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         audit_id,
         actor,
         action,
         db_name,
         status,
         detail,
         created_at
       FROM app_audit_logs
       ORDER BY created_at DESC
       FETCH FIRST ${safeLimit} ROWS ONLY`
    );

    return (result.rows || []).map((row) => ({
      id: `AUD-${row.AUDIT_ID}`,
      actor: String(row.ACTOR),
      action: String(row.ACTION) as AuditLogItem["action"],
      db: row.DB_NAME ? String(row.DB_NAME) : undefined,
      status: String(row.STATUS),
      detail: row.DETAIL ? String(row.DETAIL) : "",
      timestamp: toIstIsoString(row.CREATED_AT)
    }));
  });
}

export async function insertRequestHistory(input: {
  id: string;
  action: DbaAction;
  db: string;
  requestedBy: string;
  status: DbaResponse["status"] | "error";
  durationMs?: number;
  payload: DbaRequestPayload;
  response?: DbaResponse;
  error?: string;
}) {
  await executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO app_request_history (
         request_id,
         user_id,
         requested_by,
         action,
         db_name,
         status,
         created_at,
         duration_ms,
         payload_json,
         response_json,
         error_message,
         external_request_id
       ) VALUES (
         :requestId,
         (SELECT user_id FROM app_users WHERE username = :requestedBy),
         :requestedBy,
         :action,
         :dbName,
         :status,
         SYSTIMESTAMP,
         :durationMs,
         :payloadJson,
         :responseJson,
         :errorMessage,
         :externalRequestId
       )`,
      {
        requestId: input.id,
        requestedBy: normalizeUsername(input.requestedBy),
        action: input.action,
        dbName: input.db,
        status: input.status,
        durationMs: input.durationMs ?? null,
        payloadJson: JSON.stringify(input.payload),
        responseJson: input.response ? JSON.stringify(input.response) : null,
        errorMessage: input.error || null,
        externalRequestId: input.response?.request_id || null
      },
      { autoCommit: true }
    );
  });
}

export async function listRequestHistory(limit = 200): Promise<RequestHistoryItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 1000);

  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         request_id,
         requested_by,
         action,
         db_name,
         status,
         created_at,
         duration_ms,
         payload_json,
         response_json,
         error_message
       FROM app_request_history
       ORDER BY created_at DESC
       FETCH FIRST ${safeLimit} ROWS ONLY`
    );

    return (result.rows || []).map((row) => {
      const response = parseJson<DbaResponse>(row.RESPONSE_JSON);
      return {
        id: String(row.REQUEST_ID),
        action: String(row.ACTION) as DbaAction,
        db: String(row.DB_NAME),
        status: String(row.STATUS) as RequestHistoryItem["status"],
        requested_by: String(row.REQUESTED_BY),
        created_at: toIsoString(row.CREATED_AT),
        duration_ms: row.DURATION_MS ? Number(row.DURATION_MS) : undefined,
        payload: parseJson<DbaRequestPayload>(row.PAYLOAD_JSON) || {
          action: String(row.ACTION) as DbaAction,
          db: String(row.DB_NAME),
          params: {},
          requested_by: String(row.REQUESTED_BY)
        },
        response,
        error: row.ERROR_MESSAGE ? String(row.ERROR_MESSAGE) : undefined
      };
    });
  });
}

export async function clearRequestHistory() {
  await executeOne(async (connection) => {
    await connection.execute(`DELETE FROM app_request_history`, {}, { autoCommit: true });
  });
}

export async function insertAlertNotification(input: InsertAlertNotificationInput): Promise<AlertNotification> {
  await executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO app_alert_notifications (
         alert_id,
         source_name,
         alert_type,
         db_name,
         tablespace_name,
         object_name,
         severity,
         alert_status,
         message_text,
         utilization_pct,
         threshold_pct,
         critical_pct,
         used_gb,
         free_gb,
         extend_size_gb,
         datafile_name,
         workflow_run_id,
         approval_url,
         reject_url,
         callback_url,
         created_by,
         metadata_json
       ) VALUES (
         :alertId,
         :sourceName,
         :alertType,
         :dbName,
         :tablespaceName,
         :objectName,
         :severity,
         :alertStatus,
         :messageText,
         :utilizationPct,
         :thresholdPct,
         :criticalPct,
         :usedGb,
         :freeGb,
         :extendSizeGb,
         :datafileName,
         :workflowRunId,
         :approvalUrl,
         :rejectUrl,
         :callbackUrl,
         :createdBy,
         :metadataJson
       )`,
      {
        alertId: input.id,
        sourceName: input.source || "n8n",
        alertType: input.alertType || "tablespace",
        dbName: input.db,
        tablespaceName: input.tablespace || null,
        objectName: input.objectName || input.tablespace || null,
        severity: input.severity,
        alertStatus: input.status || "pending_approval",
        messageText: input.message,
        utilizationPct: nullableNumber(input.utilizationPct),
        thresholdPct: nullableNumber(input.thresholdPct),
        criticalPct: nullableNumber(input.criticalPct),
        usedGb: nullableNumber(input.usedGb),
        freeGb: nullableNumber(input.freeGb),
        extendSizeGb: nullableNumber(input.extendSizeGb),
        datafileName: input.datafile || null,
        workflowRunId: input.workflowRunId || null,
        approvalUrl: input.approvalUrl || null,
        rejectUrl: input.rejectUrl || null,
        callbackUrl: input.callbackUrl || null,
        createdBy: input.createdBy,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null
      },
      { autoCommit: true }
    );
  });

  const alert = await getAlertNotification(input.id);
  if (!alert) {
    throw new Error(`Unable to read alert notification after insert: ${input.id}`);
  }
  return alert;
}

export async function getAlertNotification(id: string): Promise<AlertNotification | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         alert_id,
         source_name,
         alert_type,
         db_name,
         tablespace_name,
         object_name,
         severity,
         alert_status,
         message_text,
         utilization_pct,
         threshold_pct,
         critical_pct,
         used_gb,
         free_gb,
         extend_size_gb,
         datafile_name,
         workflow_run_id,
         approval_url,
         reject_url,
         callback_url,
         created_by,
         approved_by,
         created_at,
         updated_at,
         approved_at,
         completed_at,
         metadata_json
       FROM app_alert_notifications
       WHERE alert_id = :alertId`,
      { alertId: id }
    );

    const row = result.rows?.[0];
    return row ? mapAlertNotificationRow(row) : null;
  });
}

export async function listAlertNotifications(input: ListAlertNotificationsInput = {}): Promise<ListAlertNotificationsResult> {
  const safeLimit = Math.min(Math.max(input.limit || 50, 1), 200);
  const safeOffset = Math.max(input.offset || 0, 0);
  const where: string[] = [];
  const binds: BindParameters = {};

  if (input.db) {
    where.push("db_name = :dbName");
    binds.dbName = input.db;
  }

  if (input.alertType) {
    where.push("alert_type = :alertType");
    binds.alertType = input.alertType;
  }

  if (input.status) {
    where.push("alert_status = :alertStatus");
    binds.alertStatus = input.status;
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return executeOne(async (connection) => {
    const totalResult = await connection.execute<DbRow>(
      `SELECT COUNT(*) AS total_count
       FROM app_alert_notifications
       ${whereClause}`,
      binds
    );
    const total = Number(totalResult.rows?.[0]?.TOTAL_COUNT || 0);

    const result = await connection.execute<DbRow>(
      `SELECT
         alert_id,
         source_name,
         alert_type,
         db_name,
         tablespace_name,
         object_name,
         severity,
         alert_status,
         message_text,
         utilization_pct,
         threshold_pct,
         critical_pct,
         used_gb,
         free_gb,
         extend_size_gb,
         datafile_name,
         workflow_run_id,
         approval_url,
         reject_url,
         callback_url,
         created_by,
         approved_by,
         created_at,
         updated_at,
         approved_at,
         completed_at,
         metadata_json
       FROM app_alert_notifications
       ${whereClause}
       ORDER BY created_at DESC
       OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`,
      binds
    );

    return {
      items: (result.rows || []).map(mapAlertNotificationRow),
      total,
      limit: safeLimit,
      offset: safeOffset
    };
  });
}

export async function patchAlertNotification(input: PatchAlertNotificationInput): Promise<AlertNotification> {
  const setClauses = ["updated_at = SYSTIMESTAMP"];
  const binds: BindParameters = {
    alertId: input.id
  };

  if (input.status) {
    setClauses.unshift(
      "alert_status = :alertStatus",
      "approved_at = CASE WHEN :alertStatus IN ('approved', 'rejected', 'acknowledged') THEN SYSTIMESTAMP ELSE approved_at END",
      "completed_at = CASE WHEN :alertStatus IN ('completed', 'failed') THEN SYSTIMESTAMP ELSE completed_at END"
    );
    binds.alertStatus = input.status;

    if (input.actor) {
      setClauses.splice(1, 0, "approved_by = CASE WHEN :alertStatus IN ('approved', 'rejected', 'acknowledged') THEN :actor ELSE approved_by END");
      binds.actor = input.actor;
    }
  }

  if (input.message) {
    setClauses.push("message_text = :messageText");
    binds.messageText = input.message;
  }

  if (input.metadata !== undefined) {
    setClauses.push("metadata_json = :metadataJson");
    binds.metadataJson = JSON.stringify(input.metadata);
  }

  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_alert_notifications
       SET ${setClauses.join(",\n           ")}
       WHERE alert_id = :alertId`,
      binds,
      { autoCommit: true }
    );
  });

  const alert = await getAlertNotification(input.id);
  if (!alert) {
    throw new Error(`Alert notification not found: ${input.id}`);
  }
  return alert;
}

export async function updateAlertNotification(input: UpdateAlertNotificationInput): Promise<AlertNotification> {
  return patchAlertNotification(input);
}

export async function persistRunData(input: PersistRunDataInput) {
  // Intentionally no-op: run detail persistence is handled externally via n8n.
  // The application still records request/audit history, but does not write
  // app_check_runs or any app_run_* rows.
  void input;
}

export interface TablespaceRunResult {
  rows: import("@/types/dba").TablespaceRow[];
  lastRunAt: string | null;
  lastRunBy: string | null;
}

function mapDbaStatus(value: unknown): import("@/types/dba").DbaStatus {
  const s = String(value || "unknown").toLowerCase();
  if (s === "healthy" || s === "warning" || s === "critical") return s;
  return "unknown";
}

export async function getLatestTablespaceRuns(db?: string): Promise<TablespaceRunResult> {
  return executeOne(async (connection) => {
    // When a specific db is requested, scope both the "latest run" window and
    // the row selection to that db_name so each database's report is independent.
    const latestTsFilter = db ? "WHERE db_name = :dbName" : "";
    const rowFilter = db ? "AND t.db_name = :dbName" : "";
    const binds: BindParameters = db ? { dbName: db } : {};

    const result = await connection.execute<DbRow>(
      `WITH latest_ts AS (
         SELECT MAX(created_at) AS max_ts FROM app_run_tablespaces ${latestTsFilter}
       ),
       ranked AS (
         SELECT t.tablespace_name,
                t.used_gb,
                t.free_gb,
                t.pct_used,
                t.tablespace_status,
                t.requested_by,
                t.created_at,
                l.max_ts,
                ROW_NUMBER() OVER (
                  PARTITION BY t.tablespace_name
                  ORDER BY t.tablespace_row_id DESC
                ) AS rn
         FROM app_run_tablespaces t, latest_ts l
         WHERE l.max_ts IS NOT NULL
           AND t.created_at >= l.max_ts - INTERVAL '2' MINUTE
           ${rowFilter}
       )
       SELECT tablespace_name,
              used_gb,
              free_gb,
              pct_used,
              tablespace_status,
              requested_by,
              created_at,
              max_ts
       FROM   ranked
       WHERE  rn = 1
       ORDER BY pct_used DESC`,
      binds
    );

    const rows = result.rows || [];
    if (!rows.length) {
      return { rows: [], lastRunAt: null, lastRunBy: null };
    }

    // MAX_TS is the timestamp of the latest run.
    // With Oracle session timezone fixed to UTC, node-oracledb returns a JS Date
    // that correctly represents the UTC instant, so toIsoString() is reliable.
    const lastRunAt = toIsoString(rows[0].MAX_TS);
    const lastRunBy = String(rows[0].REQUESTED_BY || "unknown");

    const tablespaceRows = rows.map((row) => ({
      name: String(row.TABLESPACE_NAME || ""),
      used_gb: Number(row.USED_GB ?? 0),
      free_gb: Number(row.FREE_GB ?? 0),
      pct_used: Number(row.PCT_USED ?? 0),
      status: mapDbaStatus(row.TABLESPACE_STATUS)
    }));

    return { rows: tablespaceRows, lastRunAt, lastRunBy };
  });
}

// ================================================================
// DBA Alert Log — dba_alert_log table
// ================================================================

/** P1 ORA error codes — database-critical. */
const P1_CODES = new Set([
  "ORA-00600",
  "ORA-07445",
  "ORA-01157",
  "ORA-00257",
  "ORA-19809",
  "ORA-00313",
  "ORA-19502",
  "ORA-27072"
]);

/** P2 ORA error codes — high severity. */
const P2_CODES = new Set([
  "ORA-04031",
  "ORA-01555",
  "ORA-01652",
  "ORA-01653",
  "ORA-01691",
  "ORA-01692",
  "ORA-12170"
]);

function computeAlertSeverity(errorCode?: string): DbaAlertLogSeverity {
  if (!errorCode) return "INFO";
  const code = errorCode.trim().toUpperCase();
  if (P1_CODES.has(code)) return "P1";
  if (P2_CODES.has(code)) return "P2";
  return "INFO";
}

function mapDbaAlertLogRow(row: DbRow): DbaAlertLogRow {
  return {
    alert_id: Number(row.ALERT_ID),
    database_name: String(row.DATABASE_NAME || ""),
    originating_timestamp: toIsoString(row.ORIGINATING_TIMESTAMP),
    error_code: row.ERROR_CODE ? String(row.ERROR_CODE) : undefined,
    message_text: row.MESSAGE_TEXT ? String(row.MESSAGE_TEXT) : undefined,
    severity: (String(row.SEVERITY || "INFO") as DbaAlertLogSeverity),
    status: (String(row.STATUS || "OPEN") as DbaAlertLogStatus),
    acknowledged_by: row.ACKNOWLEDGED_BY ? String(row.ACKNOWLEDGED_BY) : undefined,
    acknowledged_at: row.ACKNOWLEDGED_AT ? toIsoString(row.ACKNOWLEDGED_AT) : undefined,
    resolved_by: row.RESOLVED_BY ? String(row.RESOLVED_BY) : undefined,
    resolved_at: row.RESOLVED_AT ? toIsoString(row.RESOLVED_AT) : undefined,
    created_at: toIsoString(row.CREATED_AT)
  };
}

export interface InsertDbaAlertInput {
  database_name: string;
  originating_timestamp: string | Date;
  error_code?: string;
  message_text?: string;
}

export interface ListDbaAlertLogInput {
  database_name?: string;
  status?: DbaAlertLogStatus;
  severity?: DbaAlertLogSeverity;
  limit?: number;
  offset?: number;
}

export interface ListDbaAlertLogResult {
  items: DbaAlertLogRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Insert a single Oracle alert log entry into dba_alert_log.
 * Silently ignores duplicates (uk_dba_alert_log constraint).
 * Severity is calculated automatically from the error code.
 */
export async function insertDbaAlertLog(input: InsertDbaAlertInput): Promise<{ inserted: boolean; alert_id?: number }> {
  const severity = computeAlertSeverity(input.error_code);

  // Normalise timestamp — accept string or Date.
  const ts =
    input.originating_timestamp instanceof Date
      ? input.originating_timestamp
      : new Date(input.originating_timestamp);

  const messageText = (input.message_text || "").slice(0, 4000);

  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `INSERT INTO dba_alert_log (
           database_name,
           originating_timestamp,
           error_code,
           message_text,
           severity
         ) VALUES (
           :databaseName,
           :originatingTimestamp,
           :errorCode,
           :messageText,
           :severity
         )`,
        {
          databaseName: input.database_name.slice(0, 50),
          originatingTimestamp: ts,
          errorCode: input.error_code ? input.error_code.slice(0, 20) : null,
          messageText: messageText || null,
          severity
        },
        { autoCommit: true }
      );

      // Fetch the newly inserted alert_id using the unique key columns
      const sel = await connection.execute<{ ALERT_ID: number }>(
        `SELECT alert_id FROM dba_alert_log
         WHERE database_name = :databaseName
           AND originating_timestamp = :originatingTimestamp
         FETCH FIRST 1 ROW ONLY`,
        {
          databaseName: input.database_name.slice(0, 50),
          originatingTimestamp: ts
        }
      );

      const alertId = sel.rows?.[0]?.ALERT_ID;
      return { inserted: true, alert_id: alertId };
    } catch (err) {
      // ORA-00001 = unique constraint violation → duplicate, ignore silently.
      const oraErr = err as { errorNum?: number };
      if (oraErr?.errorNum === 1) {
        return { inserted: false };
      }
      throw err;
    }
  });
}

/** List alerts from dba_alert_log with optional filters. */
export async function listDbaAlertLog(input: ListDbaAlertLogInput = {}): Promise<ListDbaAlertLogResult> {
  const safeLimit = Math.min(Math.max(input.limit || 50, 1), 200);
  const safeOffset = Math.max(input.offset || 0, 0);
  const where: string[] = [];
  const binds: BindParameters = {};

  if (input.database_name) {
    where.push("database_name = :databaseName");
    binds.databaseName = input.database_name;
  }
  if (input.status) {
    where.push("status = :status");
    binds.status = input.status;
  }
  if (input.severity) {
    where.push("severity = :severity");
    binds.severity = input.severity;
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return executeOne(async (connection) => {
    const countResult = await connection.execute<DbRow>(
      `SELECT COUNT(*) AS total_count FROM dba_alert_log ${whereClause}`,
      binds
    );
    const total = Number(countResult.rows?.[0]?.TOTAL_COUNT || 0);

    const result = await connection.execute<DbRow>(
      `SELECT
         alert_id,
         database_name,
         originating_timestamp,
         error_code,
         message_text,
         severity,
         status,
         acknowledged_by,
         acknowledged_at,
         resolved_by,
         resolved_at,
         created_at
       FROM dba_alert_log
       ${whereClause}
       ORDER BY created_at DESC
       OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`,
      binds
    );

    return {
      items: (result.rows || []).map(mapDbaAlertLogRow),
      total,
      limit: safeLimit,
      offset: safeOffset
    };
  });
}

/** Update status of a dba_alert_log entry (acknowledge or resolve). */
export async function updateDbaAlertLog(input: {
  alert_id: number;
  status: DbaAlertLogStatus;
  actor: string;
}): Promise<DbaAlertLogRow> {
  return executeOne(async (connection) => {
    let setSql: string;
    const binds: BindParameters = { alertId: input.alert_id, actor: input.actor };

    if (input.status === "ACKNOWLEDGED") {
      setSql = `status = 'ACKNOWLEDGED', acknowledged_by = :actor, acknowledged_at = SYSTIMESTAMP`;
    } else if (input.status === "RESOLVED") {
      setSql = `status = 'RESOLVED', resolved_by = :actor, resolved_at = SYSTIMESTAMP`;
    } else {
      setSql = `status = 'OPEN'`;
    }

    await connection.execute(
      `UPDATE dba_alert_log SET ${setSql} WHERE alert_id = :alertId`,
      binds,
      { autoCommit: true }
    );

    const result = await connection.execute<DbRow>(
      `SELECT
         alert_id, database_name, originating_timestamp, error_code,
         message_text, severity, status, acknowledged_by, acknowledged_at,
         resolved_by, resolved_at, created_at
       FROM dba_alert_log
       WHERE alert_id = :alertId`,
      { alertId: input.alert_id }
    );

    const row = result.rows?.[0];
    if (!row) throw new Error(`dba_alert_log row not found: ${input.alert_id}`);
    return mapDbaAlertLogRow(row);
  });
}

// ============================================================
// Dashboard Schedules
// ============================================================

export interface DashboardSchedule {
  id: number;
  db_name: string;
  interval_min: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_status: string;
}

function mapDashboardScheduleRow(row: DbRow): DashboardSchedule {
  return {
    id:           Number(row.ID ?? row.id),
    db_name:      String(row.DB_NAME ?? row.db_name),
    interval_min: Number(row.INTERVAL_MIN ?? row.interval_min),
    is_active:    Number(row.IS_ACTIVE ?? row.is_active) === 1,
    created_by:   String(row.CREATED_BY ?? row.created_by ?? ""),
    created_at:   toIsoString(row.CREATED_AT ?? row.created_at),
    updated_at:   toIsoString(row.UPDATED_AT ?? row.updated_at),
    last_run_at:  (row.LAST_RUN_AT ?? row.last_run_at) ? toIsoString(row.LAST_RUN_AT ?? row.last_run_at) : null,
    next_run_at:  (row.NEXT_RUN_AT ?? row.next_run_at) ? toIsoString(row.NEXT_RUN_AT ?? row.next_run_at) : null,
    run_count:    Number(row.RUN_COUNT ?? row.run_count ?? 0),
    last_status:  String(row.LAST_STATUS ?? row.last_status ?? "pending"),
  };
}

export async function listDashboardSchedules(): Promise<DashboardSchedule[]> {
  return withOracleConnection(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT id, db_name, interval_min, is_active, created_by,
              created_at, updated_at, last_run_at, next_run_at, run_count, last_status
       FROM APP_DASHBOARD_SCHEDULES
       ORDER BY db_name`,
      {}
    );
    return (result.rows ?? []).map(mapDashboardScheduleRow);
  });
}

export async function getActiveSchedules(): Promise<DashboardSchedule[]> {
  return withOracleConnection(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT id, db_name, interval_min, is_active, created_by,
              created_at, updated_at, last_run_at, next_run_at, run_count, last_status
       FROM APP_DASHBOARD_SCHEDULES
       WHERE is_active = 1
       ORDER BY db_name`,
      {}
    );
    return (result.rows ?? []).map(mapDashboardScheduleRow);
  });
}

export interface UpsertScheduleInput {
  db_name: string;
  interval_min: number;
  created_by: string;
}

export async function upsertDashboardSchedule(input: UpsertScheduleInput): Promise<DashboardSchedule> {
  return withOracleConnection(async (connection) => {
    await connection.execute(
      `MERGE INTO APP_DASHBOARD_SCHEDULES t
       USING (SELECT :dbName AS db_name FROM dual) s
       ON (t.db_name = s.db_name)
       WHEN MATCHED THEN
         UPDATE SET interval_min = :intervalMin,
                    is_active    = 1,
                    updated_at   = SYSTIMESTAMP,
                    next_run_at  = SYSTIMESTAMP + NUMTODSINTERVAL(:intervalMin2 * 60, 'SECOND')
       WHEN NOT MATCHED THEN
         INSERT (db_name, interval_min, is_active, created_by, created_at, updated_at, next_run_at)
         VALUES (:dbName2, :intervalMin3, 1, :createdBy, SYSTIMESTAMP, SYSTIMESTAMP,
                 SYSTIMESTAMP + NUMTODSINTERVAL(:intervalMin4 * 60, 'SECOND'))`,
      {
        dbName:       input.db_name,
        intervalMin:  input.interval_min,
        intervalMin2: input.interval_min,
        dbName2:      input.db_name,
        intervalMin3: input.interval_min,
        createdBy:    input.created_by,
        intervalMin4: input.interval_min,
      },
      { autoCommit: true }
    );

    const result = await connection.execute<DbRow>(
      `SELECT id, db_name, interval_min, is_active, created_by,
              created_at, updated_at, last_run_at, next_run_at, run_count, last_status
       FROM APP_DASHBOARD_SCHEDULES
       WHERE db_name = :dbName`,
      { dbName: input.db_name }
    );
    const row = result.rows?.[0];
    if (!row) throw new Error(`Schedule not found after upsert for db: ${input.db_name}`);
    return mapDashboardScheduleRow(row);
  });
}

export async function deleteDashboardSchedule(id: number): Promise<void> {
  return withOracleConnection(async (connection) => {
    await connection.execute(
      `DELETE FROM APP_DASHBOARD_SCHEDULES WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
  });
}

export async function toggleDashboardSchedule(id: number, isActive: boolean): Promise<void> {
  return withOracleConnection(async (connection) => {
    await connection.execute(
      `UPDATE APP_DASHBOARD_SCHEDULES
       SET is_active  = :isActive,
           updated_at = SYSTIMESTAMP
       WHERE id = :id`,
      { isActive: isActive ? 1 : 0, id },
      { autoCommit: true }
    );
  });
}

export interface UpdateScheduleRunInput {
  id: number;
  status: "success" | "error";
  intervalMin: number;
}

export async function updateScheduleRunMetadata(input: UpdateScheduleRunInput): Promise<void> {
  return withOracleConnection(async (connection) => {
    await connection.execute(
      `UPDATE APP_DASHBOARD_SCHEDULES
       SET last_run_at  = SYSTIMESTAMP,
           next_run_at  = SYSTIMESTAMP + NUMTODSINTERVAL(:intervalMin * 60, 'SECOND'),
           run_count    = run_count + 1,
           last_status  = :status,
           updated_at   = SYSTIMESTAMP
       WHERE id = :id`,
      { intervalMin: input.intervalMin, status: input.status, id: input.id },
      { autoCommit: true }
    );
  });
}

// ============================================================
// Dashboard History
// ============================================================

export async function getLatestDashboardHistory(dbName: string): Promise<DashboardHistoryRow | null> {
  return withOracleConnection(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         id,
         db_name,
         environment,
         os,
         refreshed_by,
         refresh_timestamp,
         metrics_payload
       FROM dashboard_history
       WHERE db_name = :dbName
       ORDER BY refresh_timestamp DESC
       FETCH FIRST 1 ROWS ONLY`,
      { dbName }
    );

    const row = result.rows?.[0];
    if (!row) return null;

    return {
      id: Number(row.ID ?? row.id),
      db_name: String(row.DB_NAME ?? row.db_name ?? dbName),
      environment: row.ENVIRONMENT != null ? String(row.ENVIRONMENT) : null,
      os: row.OS != null ? String(row.OS) : null,
      refreshed_by: row.REFRESHED_BY != null ? String(row.REFRESHED_BY) : null,
      refresh_timestamp: toIsoString(row.REFRESH_TIMESTAMP ?? row.refresh_timestamp),
      metrics: parseJson<DashboardMetrics>(row.METRICS_PAYLOAD ?? row.metrics_payload) ?? null
    };
  });
}
