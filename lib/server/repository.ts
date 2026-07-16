import "server-only";

import oracledb, { type BindParameters, type Connection } from "oracledb";

import { SECURITY_POSTURE_OUTDATED_AFTER_DAYS } from "@/lib/security-posture-policy";
import { getServerEnv } from "@/lib/server/env";
import { withOracleConnection } from "@/lib/server/oracle";
import { generatePasswordSalt, generateSessionToken, hashPassword, hashSessionToken, normalizeUsername, sha256Hex } from "@/lib/server/security";
import { getActiveShifts, getSelectableShifts, getShiftStartDate, toOracleDateString } from "@/lib/server/shift-utils";
import type {
  AlertNotification,
  AlertNotificationSeverity,
  AlertNotificationStatus,
  AlertNotificationType,
  AppUser,
  AppUserRole,
  AuditLogItem,
  BackupStatusCheck,
  BackupStatusValue,
  BackupTemplate,
  ChecklistCompletion,
  CurrentShiftState,
  DatabaseInventoryInput,
  DatabaseInventoryItem,
  DatabaseTarget,
  DbEnvironment,
  DbaAction,
  DbaAlertLogRow,
  DbaAlertLogSeverity,
  DbaAlertLogStatus,
  DbaRequestPayload,
  DbaResponse,
  DashboardHistoryRow,
  DashboardMetrics,
  DbStatusCheck,
  DbStatusValue,
  Handover,
  RequestHistoryItem,
  ShiftReportData,
  ShiftReportFilters,
  ShiftSession,
  SecurityPostureProcessingStatus,
  SecurityPostureReport,
  ThemePreference,
  UserSession
} from "@/types/dba";

type UserRole = UserSession["role"];
type AuthMode = UserSession["authMode"];

type DbRow = Record<string, unknown>;

interface UserLoginRecord {
  userId: number;
  username: string;
  email: string;
  role: UserRole;
  passwordSalt: string;
  passwordHash: string;
  apiTokenHash?: string;
  isActive: boolean;
  mustChangePassword: boolean;
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

interface FindPendingAlertOccurrenceInput {
  db: string;
  alertType: AlertNotificationType;
  tablespace?: string;
  objectName?: string;
}

interface ReplacePendingAlertNotificationInput extends Omit<InsertAlertNotificationInput, "id"> {
  id: string;
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
  // Oracle TIMESTAMP(6) columns are populated with SYSTIMESTAMP. The DB server
  // OS runs in IST, so SYSTIMESTAMP's local fields are IST wall-clock; plain
  // TIMESTAMP strips the +05:30 offset and stores the IST literal. node-oracledb
  // (SESSIONTIMEZONE=+00:00) reads that literal as UTC, producing a JS Date
  // whose UTC fields = IST wall-clock (mislabeled as UTC, off by +5:30).
  //
  // To emit a TRUE UTC instant, subtract 5:30 here. The client then applies
  // +5:30 (formatDateTime / Asia/Kolkata) and nets out to the correct IST.
  return new Date(date.getTime() - 330 * 60 * 1000).toISOString();
}

function mapUserRole(role: unknown): UserRole {
  const normalized = String(role || "client").toLowerCase();
  if (normalized === "admin") return "app_admin";
  if (normalized === "operator") return "client";
  if (normalized === "app_admin" || normalized === "dba_admin" || normalized === "client" || normalized === "auditor") {
    return normalized;
  }
  return "client";
}

function isAppUserRole(value: string): value is AppUserRole {
  return value === "app_admin" || value === "dba_admin" || value === "client" || value === "auditor";
}

function mapAppUserRow(row: DbRow): AppUser {
  return {
    userId: Number(row.USER_ID),
    username: String(row.USERNAME),
    email: String(row.EMAIL || ""),
    role: mapUserRole(row.ROLE),
    isActive: String(row.IS_ACTIVE || "N") === "Y",
    mustChangePassword: String(row.MUST_CHANGE_PASSWORD || "N") === "Y",
    failedLoginCount: Number(row.FAILED_LOGIN_COUNT || 0),
    lockedUntil: row.LOCKED_UNTIL ? toIsoString(row.LOCKED_UNTIL) : undefined,
    lastLoginAt: row.LAST_LOGIN_AT ? toIsoString(row.LAST_LOGIN_AT) : undefined,
    createdAt: toIsoString(row.CREATED_AT),
    updatedAt: toIsoString(row.UPDATED_AT)
  };
}

function normalizeDatabaseEnvironment(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "production" || normalized === "prod") return "production";
  if (normalized === "non-production" || normalized === "non_production" || normalized === "non-prod" || normalized === "non_prod") {
    return "non-production";
  }
  if (normalized === "dr" || normalized === "disaster_recovery") return "dr";
  return "non-production";
}

function normalizeDatabaseRole(value: unknown): DatabaseTarget["role"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "primary" || normalized === "standby" || normalized === "reporting") return normalized;
  return "primary";
}

function normalizeDatabaseRoleForStorage(value: unknown): "Primary" | "Standby" | "Reporting" {
  const normalized = normalizeDatabaseRole(value);
  if (normalized === "standby") return "Standby";
  if (normalized === "reporting") return "Reporting";
  return "Primary";
}

function normalizeDatabaseStatus(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "inactive" || normalized === "decomissioned") {
    return normalized;
  }
  return "active";
}

function normalizeDatabaseOs(value: unknown): DatabaseTarget["os"] {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "windows" ? "Windows" : "Linux";
}

function normalizeDatabaseType(value: unknown): DatabaseTarget["db_type"] {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (normalized === "rac") return "RAC";
  if (normalized === "dataguard" || normalized === "data_guard") return "Dataguard";
  if (normalized === "active_dataguard" || normalized === "active_data_guard") return "Active Dataguard";
  return "Standalone";
}

function normalizeEnvironmentLabel(value: unknown, environment: string): DbEnvironment {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PROD" || normalized === "DEV" || normalized === "UAT" || normalized === "DR") return normalized;
  const env = normalizeDatabaseEnvironment(environment);
  if (env === "production") return "PROD";
  if (env === "dr") return "DR";
  return "DEV";
}

function normalizeServerType(value: unknown): "Physical" | "Virtual" {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "virtual" ? "Virtual" : "Physical";
}

function normalizeDivision(value: unknown): "PCPB" | "ITD" | "FBD" | "HOTEL" | "ILTD" | "CORP" | "ITSS" {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized === "PCPB" ||
    normalized === "ITD" ||
    normalized === "FBD" ||
    normalized === "HOTEL" ||
    normalized === "ILTD" ||
    normalized === "CORP" ||
    normalized === "ITSS"
  ) {
    return normalized;
  }
  return "PCPB";
}

function normalizeDbPort(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return 1521;
  return Math.trunc(parsed);
}

function normalizeDbVersion(value: unknown): string {
  const normalized = String(value || "").trim();
  return normalized.slice(0, 40);
}

function normalizeDbEdition(value: unknown): string {
  const normalized = String(value || "").trim();
  return normalized.slice(0, 40);
}

function mapDatabaseInventoryRow(row: DbRow): DatabaseInventoryItem {
  const databaseName = String(row.DATABASE_NAME || "");
  const environment = String(row.ENVIRONMENT || "");
  const location = String(row.LOCATION || "");
  const ownerId = Number(row.OWNER_ID || 0);

  return {
    id: Number(row.ID),
    database_name: databaseName,
    name: databaseName,
    environment: normalizeDatabaseEnvironment(environment),
    region: location,
    location,
    role: normalizeDatabaseRole(row.DATABASE_ROLE),
    status: normalizeDatabaseStatus(row.STATUS),
    env_label: normalizeEnvironmentLabel(row.ENVIRONMENT_LABEL, environment),
    os: normalizeDatabaseOs(row.OPERATING_SYSTEM),
    db_type: normalizeDatabaseType(row.DATABASE_TYPE),
    security_posture_outdated: String(row.SECURITY_POSTURE_OUTDATED || "N").toUpperCase() === "Y",
    server_name: row.SERVER_NAME ? String(row.SERVER_NAME) : undefined,
    server_ip: row.SERVER_IP ? String(row.SERVER_IP) : undefined,
    zone: row.ZONE ? String(row.ZONE) : undefined,
    server_type: normalizeServerType(row.SERVER_TYPE),
    db_version: row.DB_VERSION ? String(row.DB_VERSION) : undefined,
    db_edition: row.DB_EDITION ? String(row.DB_EDITION) : undefined,
    db_port: normalizeDbPort(row.DB_PORT),
    division: normalizeDivision(row.DIVISION),
    owner_id: ownerId,
    owner: ownerId
      ? {
          userId: ownerId,
          username: String(row.OWNER_USERNAME || ""),
          email: String(row.OWNER_EMAIL || "")
        }
      : undefined,
    created_at: toIsoString(row.CREATED_AT),
    updated_at: toIsoString(row.UPDATED_AT),
    created_by: row.CREATED_BY ? String(row.CREATED_BY) : undefined,
    updated_by: row.UPDATED_BY ? String(row.UPDATED_BY) : undefined
  };
}

function normalizeDatabaseInventoryInput(input: DatabaseInventoryInput) {
  const databaseName = input.database_name.trim();
  const environment = input.environment.trim();
  const location = input.location.trim();
  const operatingSystem = normalizeDatabaseOs(input.operating_system);
  const databaseRole = normalizeDatabaseRoleForStorage(input.database_role);
  const databaseType = normalizeDatabaseType(input.database_type);
  const status = normalizeDatabaseStatus(input.status);
  const environmentLabel = normalizeEnvironmentLabel(input.environment_label, environment);
  const ownerId = Number(input.owner_id);
  const serverName = input.server_name?.trim() || "";
  const serverIp = input.server_ip?.trim() || "";
  const zone = input.zone?.trim() || "SZ1";
  const serverType = normalizeServerType(input.server_type);
  const dbVersion = normalizeDbVersion(input.db_version);
  const dbEdition = normalizeDbEdition(input.db_edition);
  const dbPort = normalizeDbPort(input.db_port);
  const division = normalizeDivision(input.division);

  if (!databaseName || databaseName.length > 128) {
    throw new Error("Database name is required and must be 128 characters or fewer.");
  }
  if (!environment || environment.length > 40) {
    throw new Error("Environment is required and must be 40 characters or fewer.");
  }
  if (!operatingSystem) {
    throw new Error("Operating system is required.");
  }
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new Error("Owner is required.");
  }
  if (location.length > 160) {
    throw new Error("Location must be 160 characters or fewer.");
  }
  if (serverName.length > 128) {
    throw new Error("Server name must be 128 characters or fewer.");
  }
  if (serverIp.length > 45) {
    throw new Error("Server IP must be 45 characters or fewer.");
  }
  if (zone !== "SZ1" && zone !== "SZ2" && zone !== "LAN") {
    throw new Error("Zone must be SZ1, SZ2, or LAN.");
  }
  if (dbVersion.length > 40) {
    throw new Error("DB version must be 40 characters or fewer.");
  }
  if (dbEdition.length > 40) {
    throw new Error("DB edition must be 40 characters or fewer.");
  }
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new Error("DB port must be between 1 and 65535.");
  }

  return {
    databaseName,
    environment,
    location,
    operatingSystem,
    databaseRole,
    databaseType,
    status,
    environmentLabel,
    ownerId,
    serverName,
    serverIp,
    zone,
    serverType,
    dbVersion,
    dbEdition,
    dbPort,
    division
  };
}

function mapAuthMode(): AuthMode {
  return "jwt";
}

function parseJson<T>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return raw as T;

  let text = raw.trim();
  if (!text) return undefined;

  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "string") return parsed as T;
      text = parsed.trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function isOracleMissingTableError(error: unknown) {
  return error instanceof Error && error.message.includes("ORA-00942");
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
    created_at: toIstIsoString(row.CREATED_AT),
    updated_at: toIstIsoString(row.UPDATED_AT),
    approved_at: row.APPROVED_AT ? toIstIsoString(row.APPROVED_AT) : undefined,
    completed_at: row.COMPLETED_AT ? toIstIsoString(row.COMPLETED_AT) : undefined,
    metadata: parseJson<Record<string, unknown>>(row.METADATA_JSON)
  };
}

async function executeOne<T>(fn: (connection: Connection) => Promise<T>) {
  return withOracleConnection(fn);
}

function mapSecurityPostureReport(row: DbRow): SecurityPostureReport {
  return {
    id: Number(row.REPORT_ID),
    database_id: Number(row.DATABASE_ID),
    database_name: String(row.DATABASE_NAME || ""),
    original_filename: String(row.ORIGINAL_FILENAME || ""),
    file_size: Number(row.FILE_SIZE_BYTES || 0),
    mime_type: String(row.MIME_TYPE || "application/pdf"),
    uploaded_by: String(row.UPLOADED_BY || ""),
    // Security posture uses TIMESTAMP WITH TIME ZONE. Unlike the older plain
    // TIMESTAMP tables, node-oracledb preserves the real instant here; applying
    // the legacy IST wall-clock correction would display it 5:30 behind IST.
    uploaded_at: toIsoString(row.UPLOADED_AT),
    processing_status: String(row.PROCESSING_STATUS || "UPLOADED").toUpperCase() as SecurityPostureProcessingStatus,
    ai_summary: row.AI_SUMMARY ? String(row.AI_SUMMARY) : undefined,
    ai_model: row.AI_MODEL ? String(row.AI_MODEL) : undefined,
    summary_generated_at: row.SUMMARY_GENERATED_AT ? toIsoString(row.SUMMARY_GENERATED_AT) : undefined,
    error_message: row.ERROR_MESSAGE ? String(row.ERROR_MESSAGE) : undefined
  };
}

function securityPostureAccessFilter(role?: UserRole, userId?: number) {
  if (role === "client" && userId) return "AND d.owner_id = :userId";
  return "";
}

export async function getActiveSecurityPostureReport(
  databaseName: string,
  access: { role?: UserRole; userId?: number } = {}
): Promise<SecurityPostureReport | null> {
  return executeOne(async (connection) => {
    const normalizedName = databaseName.trim();
    if (!normalizedName) return null;
    const ownerFilter = securityPostureAccessFilter(access.role, access.userId);
    const binds: BindParameters = { databaseName: normalizedName };
    if (ownerFilter) binds.userId = access.userId;
    const result = await connection.execute<DbRow>(
      `SELECT r.report_id, r.database_id, d.database_name, r.original_filename,
              r.file_size_bytes, r.mime_type, r.uploaded_by, r.uploaded_at,
              r.processing_status, r.ai_summary, r.ai_model,
              r.summary_generated_at, r.error_message
       FROM app_security_posture_reports r
       JOIN database_inventory d ON d.id = r.database_id
       WHERE UPPER(d.database_name) = UPPER(:databaseName)
         AND r.is_active = 'Y'
         ${ownerFilter}`,
      binds
    );
    const row = result.rows?.[0];
    return row ? mapSecurityPostureReport(row) : null;
  });
}

export async function createSecurityPostureReport(input: {
  databaseName: string;
  originalFilename: string;
  storedFilename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploaderUserId: number;
  uploaderRole: UserRole;
}): Promise<SecurityPostureReport> {
  return executeOne(async (connection) => {
    const target = await connection.execute<DbRow>(
      `SELECT id, database_name, owner_id FROM database_inventory
       WHERE UPPER(database_name) = UPPER(:databaseName)`,
      { databaseName: input.databaseName.trim() }
    );
    const database = target.rows?.[0];
    if (!database) throw new Error("Selected database was not found.");
    if (input.uploaderRole === "client" && Number(database.OWNER_ID) !== input.uploaderUserId) {
      throw new Error("You are not authorized to upload a report for this database.");
    }

    // One current document per database; the previous document remains as history.
    await connection.execute(
      `UPDATE app_security_posture_reports
       SET is_active = 'N', replaced_at = SYSTIMESTAMP
       WHERE database_id = :databaseId AND is_active = 'Y'`,
      { databaseId: Number(database.ID) }
    );
    const inserted = await connection.execute<DbRow>(
      `INSERT INTO app_security_posture_reports
       (database_id, original_filename, stored_filename, file_path, file_size_bytes,
        mime_type, uploaded_by, uploaded_by_user_id, uploaded_at, processing_status, is_active)
       VALUES
       (:databaseId, :originalFilename, :storedFilename, :filePath, :fileSize,
        :mimeType, :uploadedBy, :uploaderUserId, SYSTIMESTAMP, 'UPLOADED', 'Y')
       RETURNING report_id, database_id, original_filename, file_size_bytes, mime_type,
                 uploaded_by, uploaded_at, processing_status, ai_summary, ai_model,
                 summary_generated_at, error_message INTO
                 :reportId, :returnedDatabaseId, :returnedFilename, :returnedFileSize,
                 :returnedMimeType, :returnedUploadedBy, :returnedUploadedAt,
                 :returnedStatus, :returnedSummary, :returnedModel, :returnedSummaryAt,
                 :returnedError`,
      {
        databaseId: Number(database.ID),
        originalFilename: input.originalFilename,
        storedFilename: input.storedFilename,
        filePath: input.filePath,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        uploadedBy: input.uploadedBy,
        uploaderUserId: input.uploaderUserId,
        reportId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        returnedDatabaseId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        returnedFilename: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 255 },
        returnedFileSize: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        returnedMimeType: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 100 },
        returnedUploadedBy: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
        returnedUploadedAt: { dir: oracledb.BIND_OUT, type: oracledb.DATE },
        returnedStatus: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 20 },
        returnedSummary: { dir: oracledb.BIND_OUT, type: oracledb.CLOB },
        returnedModel: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 200 },
        returnedSummaryAt: { dir: oracledb.BIND_OUT, type: oracledb.DATE },
        returnedError: { dir: oracledb.BIND_OUT, type: oracledb.CLOB }
      },
      { autoCommit: true }
    );
    const output = inserted.outBinds as Record<string, unknown[]>;
    return {
      id: Number(output.reportId?.[0]),
      database_id: Number(output.returnedDatabaseId?.[0]),
      database_name: String(database.DATABASE_NAME),
      original_filename: String(output.returnedFilename?.[0] || input.originalFilename),
      file_size: Number(output.returnedFileSize?.[0] || input.fileSize),
      mime_type: String(output.returnedMimeType?.[0] || input.mimeType),
      uploaded_by: String(output.returnedUploadedBy?.[0] || input.uploadedBy),
      uploaded_at: toIsoString(output.returnedUploadedAt?.[0]),
      processing_status: String(output.returnedStatus?.[0] || "UPLOADED") as SecurityPostureProcessingStatus
    };
  });
}

export async function getSecurityPostureReportFile(reportId: number, access: { role?: UserRole; userId?: number } = {}) {
  return executeOne(async (connection) => {
    const ownerFilter = securityPostureAccessFilter(access.role, access.userId);
    const binds: BindParameters = { reportId };
    if (ownerFilter) binds.userId = access.userId;
    const result = await connection.execute<DbRow>(
      `SELECT r.report_id, r.file_path, r.original_filename, r.mime_type
       FROM app_security_posture_reports r
       JOIN database_inventory d ON d.id = r.database_id
       WHERE r.report_id = :reportId AND r.is_active = 'Y' ${ownerFilter}`,
      binds
    );
    const row = result.rows?.[0];
    return row ? {
      id: Number(row.REPORT_ID), filePath: String(row.FILE_PATH),
      originalFilename: String(row.ORIGINAL_FILENAME), mimeType: String(row.MIME_TYPE || "application/pdf")
    } : null;
  });
}

export async function updateSecurityPostureProcessingFailure(reportId: number, message: string) {
  return executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_security_posture_reports
       SET processing_status = 'FAILED', error_message = :message
       WHERE report_id = :reportId AND is_active = 'Y'`,
      { reportId, message: message.slice(0, 4000) },
      { autoCommit: true }
    );
  });
}

export async function findUserForLogin(username: string): Promise<UserLoginRecord | null> {
  const normalized = normalizeUsername(username);
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         email,
         role,
         password_salt,
         password_hash,
         api_token_hash,
         is_active,
         must_change_password,
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
      email: String(row.EMAIL || ""),
      role: mapUserRole(row.ROLE),
      passwordSalt: String(row.PASSWORD_SALT),
      passwordHash: String(row.PASSWORD_HASH),
      apiTokenHash: row.API_TOKEN_HASH ? String(row.API_TOKEN_HASH) : undefined,
      isActive: String(row.IS_ACTIVE || "N") === "Y",
      mustChangePassword: String(row.MUST_CHANGE_PASSWORD || "N") === "Y",
      lockedUntil: asDate(row.LOCKED_UNTIL)
    };
  });
}

export async function findUserForLoginByEmail(email: string): Promise<UserLoginRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         email,
         role,
         password_salt,
         password_hash,
         api_token_hash,
         is_active,
         must_change_password,
         locked_until
       FROM app_users
       WHERE LOWER(email) = :email`,
      { email: normalizedEmail }
    );

    const row = result.rows?.[0];
    if (!row) return null;

    return {
      userId: Number(row.USER_ID),
      username: String(row.USERNAME),
      email: String(row.EMAIL || normalizedEmail),
      role: mapUserRole(row.ROLE),
      passwordSalt: String(row.PASSWORD_SALT),
      passwordHash: String(row.PASSWORD_HASH),
      apiTokenHash: row.API_TOKEN_HASH ? String(row.API_TOKEN_HASH) : undefined,
      isActive: String(row.IS_ACTIVE || "N") === "Y",
      mustChangePassword: String(row.MUST_CHANGE_PASSWORD || "N") === "Y",
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

export async function clearLoginLockout(userId: number) {
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_users
       SET failed_login_count = 0,
           locked_until = NULL,
           updated_at = SYSTIMESTAMP
       WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );
  });
}

export interface CreateAppUserInput {
  username: string;
  email: string;
  role: AppUserRole;
  initialPassword: string;
  isActive?: boolean;
}

export interface UpdateAppUserInput {
  userId: number;
  username: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
}

function normalizeAppUserInput(input: { username: string; email: string; role: string }) {
  const username = normalizeUsername(input.username);
  const email = input.email.trim().toLowerCase();
  const role = input.role.trim().toLowerCase();

  if (!username || username.length > 128) {
    throw new Error("Username is required and must be 128 characters or fewer.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error("Enter a valid email address.");
  }
  if (!isAppUserRole(role)) {
    throw new Error("Invalid role.");
  }

  return { username, email, role };
}

async function countActiveAdmins(connection: Connection) {
  const result = await connection.execute<DbRow>(
    `SELECT COUNT(*) AS active_admin_count
     FROM app_users
     WHERE role = 'app_admin'
       AND is_active = 'Y'`
  );
  return Number(result.rows?.[0]?.ACTIVE_ADMIN_COUNT || 0);
}

export async function listAppUsers(): Promise<AppUser[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         email,
         role,
         is_active,
         must_change_password,
         failed_login_count,
         locked_until,
         last_login_at,
         created_at,
         updated_at
       FROM app_users
       ORDER BY created_at DESC, user_id DESC`
    );

    return (result.rows || []).map(mapAppUserRow);
  });
}

async function assertActiveClientOwner(connection: Connection, ownerId: number) {
  const owner = await connection.execute<DbRow>(
    `SELECT user_id
     FROM app_users
     WHERE user_id = :ownerId
       AND role = 'client'
       AND is_active = 'Y'`,
    { ownerId }
  );

  if (!owner.rows?.length) {
    throw new Error("Owner must be an active client user.");
  }
}

async function fetchDatabaseInventoryById(connection: Connection, id: number): Promise<DatabaseInventoryItem | null> {
  const result = await connection.execute<DbRow>(
    `SELECT
       d.id,
       d.database_name,
       d.environment,
       d.server_name,
       d.server_ip,
       d.zone,
       d.location,
       d.operating_system,
       d.database_role,
       d.database_type,
       d.status,
       d.environment_label,
       d.server_type,
       d.db_version,
       d.db_edition,
       d.db_port,
       d.division,
       d.owner_id,
       u.username AS owner_username,
       u.email AS owner_email,
       d.created_at,
       d.updated_at,
       d.created_by,
       d.updated_by
     FROM database_inventory d
     LEFT JOIN app_users u ON u.user_id = d.owner_id
     WHERE d.id = :id`,
    { id }
  );

  const row = result.rows?.[0];
  return row ? mapDatabaseInventoryRow(row) : null;
}

export async function listDatabaseInventory(input: { role?: UserRole; userId?: number } = {}): Promise<DatabaseInventoryItem[]> {
  return executeOne(async (connection) => {
    const binds: BindParameters = {};
    const ownerFilter = input.role === "client" && input.userId ? "WHERE d.owner_id = :ownerId" : "";
    if (ownerFilter) binds.ownerId = input.userId;

    const result = await connection.execute<DbRow>(
      `SELECT
         d.id,
         d.database_name,
         d.environment,
         d.server_name,
         d.server_ip,
         d.zone,
         d.location,
         d.operating_system,
         d.database_role,
         d.database_type,
         d.status,
         d.environment_label,
         CASE WHEN EXISTS (
           SELECT 1
           FROM app_security_posture_reports r
           WHERE r.database_id = d.id
             AND r.is_active = 'Y'
             AND r.uploaded_at < SYSTIMESTAMP - NUMTODSINTERVAL(${SECURITY_POSTURE_OUTDATED_AFTER_DAYS}, 'DAY')
         ) THEN 'Y' ELSE 'N' END AS security_posture_outdated,
         d.server_type,
         d.db_version,
         d.db_edition,
         d.db_port,
         d.division,
         d.owner_id,
         u.username AS owner_username,
         u.email AS owner_email,
         d.created_at,
         d.updated_at,
         d.created_by,
         d.updated_by
       FROM database_inventory d
       LEFT JOIN app_users u ON u.user_id = d.owner_id
       ${ownerFilter}
       ORDER BY d.division, UPPER(d.database_name)`,
      binds
    );

    return (result.rows || []).map(mapDatabaseInventoryRow);
  });
}

export async function getDatabaseInventory(id: number, input: { role?: UserRole; userId?: number } = {}): Promise<DatabaseInventoryItem | null> {
  return executeOne(async (connection) => {
    const item = await fetchDatabaseInventoryById(connection, id);
    if (!item) return null;
    if (input.role === "client" && input.userId && item.owner_id !== input.userId) return null;
    return item;
  });
}

export async function getDatabaseTargetByName(name: string): Promise<DatabaseTarget | undefined> {
  const normalizedName = name.trim();
  if (!normalizedName) return undefined;

  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         d.id,
         d.database_name,
         d.environment,
d.server_name,
        d.server_ip,
        d.zone,
        d.location,
        d.operating_system,
        d.database_role,
        d.database_type,
        d.status,
        d.environment_label,
        d.server_type,
        d.db_version,
        d.db_edition,
        d.db_port,
        d.division,
        d.owner_id,
        u.username AS owner_username,
        u.email AS owner_email,
        d.created_at,
        d.updated_at,
        d.created_by,
        d.updated_by
      FROM database_inventory d
      LEFT JOIN app_users u ON u.user_id = d.owner_id
      WHERE UPPER(d.database_name) = UPPER(:name)
      FETCH FIRST 1 ROW ONLY`,
      { name: normalizedName }
    );

    const row = result.rows?.[0];
    return row ? mapDatabaseInventoryRow(row) : undefined;
  });
}

export async function createDatabaseInventory(input: DatabaseInventoryInput, actor: string): Promise<DatabaseInventoryItem> {
  const normalized = normalizeDatabaseInventoryInput(input);

  return executeOne(async (connection) => {
    try {
      await assertActiveClientOwner(connection, normalized.ownerId);

      const duplicate = await connection.execute<DbRow>(
        `SELECT id
         FROM database_inventory
         WHERE UPPER(database_name) = UPPER(:databaseName)
         FETCH FIRST 1 ROW ONLY`,
        { databaseName: normalized.databaseName }
      );
      if (duplicate.rows?.length) {
        throw new Error("A database with that name already exists.");
      }

      const idResult = await connection.execute<DbRow>(
        `SELECT database_inventory_seq.NEXTVAL AS next_id FROM dual`
      );
      const id = Number(idResult.rows?.[0]?.NEXT_ID);

      await connection.execute(
        `INSERT INTO database_inventory (
           id,
           database_name,
           environment,
           server_name,
           server_ip,
           zone,
           location,
           operating_system,
           database_role,
           database_type,
           status,
           environment_label,
           server_type,
           db_version,
           db_edition,
           db_port,
           division,
           owner_id,
           created_by,
           updated_by
         ) VALUES (
           :id,
           :databaseName,
           :environment,
           :serverName,
           :serverIp,
           :zone,
           :location,
           :operatingSystem,
           :databaseRole,
           :databaseType,
           :status,
           :environmentLabel,
           :serverType,
           :dbVersion,
           :dbEdition,
           :dbPort,
           :division,
           :ownerId,
           :actor,
           :actor
         )`,
        {
          id,
          databaseName: normalized.databaseName,
          environment: normalized.environment,
          serverName: normalized.serverName || null,
          serverIp: normalized.serverIp || null,
          zone: normalized.zone,
          location: normalized.location,
          operatingSystem: normalized.operatingSystem,
          databaseRole: normalized.databaseRole,
          databaseType: normalized.databaseType,
          status: normalized.status,
          environmentLabel: normalized.environmentLabel,
          serverType: normalized.serverType,
          dbVersion: normalized.dbVersion || null,
          dbEdition: normalized.dbEdition || null,
          dbPort: normalized.dbPort,
          division: normalized.division,
          ownerId: normalized.ownerId,
          actor
        }
      );

      await connection.execute(
        `INSERT INTO db_owner_mapping (
           id,
           owner_id,
           database_id,
           assigned_by,
           is_active
         ) VALUES (
           db_owner_mapping_seq.NEXTVAL,
           :ownerId,
           :databaseId,
           :actor,
           'Y'
         )`,
        { ownerId: normalized.ownerId, databaseId: id, actor }
      );

      await connection.commit();
      const created = await fetchDatabaseInventoryById(connection, id);
      if (!created) throw new Error("Created database was not found.");
      return created;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function updateDatabaseInventory(id: number, input: DatabaseInventoryInput, actor: string): Promise<DatabaseInventoryItem> {
  const normalized = normalizeDatabaseInventoryInput(input);

  return executeOne(async (connection) => {
    try {
      const existing = await fetchDatabaseInventoryById(connection, id);
      if (!existing) {
        throw new Error("Database not found.");
      }

      await assertActiveClientOwner(connection, normalized.ownerId);

      const duplicate = await connection.execute<DbRow>(
        `SELECT id
         FROM database_inventory
         WHERE id <> :id
           AND UPPER(database_name) = UPPER(:databaseName)
         FETCH FIRST 1 ROW ONLY`,
        { id, databaseName: normalized.databaseName }
      );
      if (duplicate.rows?.length) {
        throw new Error("Another database already has that name.");
      }

      await connection.execute(
        `UPDATE database_inventory
         SET database_name = :databaseName,
             environment = :environment,
             server_name = :serverName,
             server_ip = :serverIp,
             zone = :zone,
             location = :location,
             operating_system = :operatingSystem,
             database_role = :databaseRole,
             database_type = :databaseType,
             status = :status,
             environment_label = :environmentLabel,
             server_type = :serverType,
             db_version = :dbVersion,
             db_edition = :dbEdition,
             db_port = :dbPort,
             division = :division,
             owner_id = :ownerId,
             updated_by = :actor
         WHERE id = :id`,
        {
          id,
          databaseName: normalized.databaseName,
          environment: normalized.environment,
          serverName: normalized.serverName || null,
          serverIp: normalized.serverIp || null,
          zone: normalized.zone,
          location: normalized.location,
          operatingSystem: normalized.operatingSystem,
          databaseRole: normalized.databaseRole,
          databaseType: normalized.databaseType,
          status: normalized.status,
          environmentLabel: normalized.environmentLabel,
          serverType: normalized.serverType,
          dbVersion: normalized.dbVersion || null,
          dbEdition: normalized.dbEdition || null,
          dbPort: normalized.dbPort,
          division: normalized.division,
          ownerId: normalized.ownerId,
          actor
        }
      );

      if (existing.owner_id !== normalized.ownerId) {
        await connection.execute(
          `UPDATE db_owner_mapping
           SET is_active = 'N'
           WHERE database_id = :databaseId
             AND is_active = 'Y'`,
          { databaseId: id }
        );

        await connection.execute(
          `INSERT INTO db_owner_mapping (
             id,
             owner_id,
             database_id,
             assigned_by,
             is_active
           ) VALUES (
             db_owner_mapping_seq.NEXTVAL,
             :ownerId,
             :databaseId,
             :actor,
             'Y'
           )`,
          { ownerId: normalized.ownerId, databaseId: id, actor }
        );
      }

      await connection.commit();
      const updated = await fetchDatabaseInventoryById(connection, id);
      if (!updated) throw new Error("Updated database was not found.");
      return updated;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function changeDatabaseOwner(id: number, ownerId: number, actor: string): Promise<DatabaseInventoryItem> {
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new Error("Owner is required.");
  }

  return executeOne(async (connection) => {
    try {
      const existing = await fetchDatabaseInventoryById(connection, id);
      if (!existing) {
        throw new Error("Database not found.");
      }
      await assertActiveClientOwner(connection, ownerId);

      if (existing.owner_id !== ownerId) {
        await connection.execute(
          `UPDATE db_owner_mapping
           SET is_active = 'N'
           WHERE database_id = :databaseId
             AND is_active = 'Y'`,
          { databaseId: id }
        );

        await connection.execute(
          `INSERT INTO db_owner_mapping (
             id,
             owner_id,
             database_id,
             assigned_by,
             is_active
           ) VALUES (
             db_owner_mapping_seq.NEXTVAL,
             :ownerId,
             :databaseId,
             :actor,
             'Y'
           )`,
          { ownerId, databaseId: id, actor }
        );

        await connection.execute(
          `UPDATE database_inventory
           SET owner_id = :ownerId,
               updated_by = :actor
           WHERE id = :databaseId`,
          { ownerId, actor, databaseId: id }
        );
      }

      await connection.commit();
      const updated = await fetchDatabaseInventoryById(connection, id);
      if (!updated) throw new Error("Updated database was not found.");
      return updated;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function deleteDatabaseInventory(id: number): Promise<void> {
  return executeOne(async (connection) => {
    try {
      const existing = await fetchDatabaseInventoryById(connection, id);
      if (!existing) {
        throw new Error("Database not found.");
      }

      await connection.execute(
        `DELETE FROM db_owner_mapping
         WHERE database_id = :id`,
        { id }
      );
      await connection.execute(
        `DELETE FROM database_inventory
         WHERE id = :id`,
        { id }
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function createAppUser(input: CreateAppUserInput): Promise<AppUser> {
  const normalized = normalizeAppUserInput(input);
  if (input.initialPassword.length < 8 || input.initialPassword.length > 128) {
    throw new Error("Initial password must be between 8 and 128 characters.");
  }

  const passwordSalt = generatePasswordSalt();
  const passwordHash = hashPassword(input.initialPassword, passwordSalt);

  return executeOne(async (connection) => {
    const duplicate = await connection.execute<DbRow>(
      `SELECT username, email
       FROM app_users
       WHERE username = :username
          OR LOWER(email) = :email
       FETCH FIRST 1 ROW ONLY`,
      { username: normalized.username, email: normalized.email }
    );
    if (duplicate.rows?.length) {
      throw new Error("A user with that username or email already exists.");
    }

    await connection.execute(
      `INSERT INTO app_users (
         username,
         email,
         password_salt,
         password_hash,
         role,
         is_active,
         must_change_password,
         failed_login_count
       ) VALUES (
         :username,
         :email,
         :passwordSalt,
         :passwordHash,
         :role,
         :isActive,
         'Y',
         0
       )`,
      {
        username: normalized.username,
        email: normalized.email,
        passwordSalt,
        passwordHash,
        role: normalized.role,
        isActive: input.isActive === false ? "N" : "Y"
      },
      { autoCommit: true }
    );

    const created = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         email,
         role,
         is_active,
         must_change_password,
         failed_login_count,
         locked_until,
         last_login_at,
         created_at,
         updated_at
       FROM app_users
       WHERE username = :username`,
      { username: normalized.username }
    );
    const row = created.rows?.[0];
    if (!row) throw new Error("Created user was not found.");
    return mapAppUserRow(row);
  });
}

export async function updateAppUser(input: UpdateAppUserInput): Promise<AppUser> {
  const normalized = normalizeAppUserInput(input);

  return executeOne(async (connection) => {
    const existingResult = await connection.execute<DbRow>(
      `SELECT user_id, role, is_active
       FROM app_users
       WHERE user_id = :userId`,
      { userId: input.userId }
    );
    const existing = existingResult.rows?.[0];
    if (!existing) {
      throw new Error("User not found.");
    }

    const existingRole = mapUserRole(existing.ROLE);
    const existingActive = String(existing.IS_ACTIVE || "N") === "Y";
    const nextActive = Boolean(input.isActive);
    if (existingRole === "app_admin" && existingActive && (normalized.role !== "app_admin" || !nextActive)) {
      const activeAdmins = await countActiveAdmins(connection);
      if (activeAdmins <= 1) {
        throw new Error("At least one active app admin user must remain.");
      }
    }

    const duplicate = await connection.execute<DbRow>(
      `SELECT user_id
       FROM app_users
       WHERE user_id <> :userId
         AND (username = :username OR LOWER(email) = :email)
       FETCH FIRST 1 ROW ONLY`,
      { userId: input.userId, username: normalized.username, email: normalized.email }
    );
    if (duplicate.rows?.length) {
      throw new Error("Another user already has that username or email.");
    }

    await connection.execute(
      `UPDATE app_users
       SET username = :username,
           email = :email,
           role = :role,
           is_active = :isActive,
           locked_until = CASE WHEN :isActive = 'Y' THEN locked_until ELSE NULL END,
           failed_login_count = CASE WHEN :isActive = 'Y' THEN failed_login_count ELSE 0 END
       WHERE user_id = :userId`,
      {
        username: normalized.username,
        email: normalized.email,
        role: normalized.role,
        isActive: nextActive ? "Y" : "N",
        userId: input.userId
      },
      { autoCommit: true }
    );

    const updated = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         email,
         role,
         is_active,
         must_change_password,
         failed_login_count,
         locked_until,
         last_login_at,
         created_at,
         updated_at
       FROM app_users
       WHERE user_id = :userId`,
      { userId: input.userId }
    );
    const row = updated.rows?.[0];
    if (!row) throw new Error("Updated user was not found.");
    return mapAppUserRow(row);
  });
}

export async function removeAppUser(userId: number): Promise<void> {
  return executeOne(async (connection) => {
    const existingResult = await connection.execute<DbRow>(
      `SELECT user_id, role, is_active
       FROM app_users
       WHERE user_id = :userId`,
      { userId }
    );
    const existing = existingResult.rows?.[0];
    if (!existing) {
      throw new Error("User not found.");
    }

    const existingRole = mapUserRole(existing.ROLE);
    const existingActive = String(existing.IS_ACTIVE || "N") === "Y";
    if (existingRole === "app_admin" && existingActive) {
      const activeAdmins = await countActiveAdmins(connection);
      if (activeAdmins <= 1) {
        throw new Error("Cannot delete the last active app admin user.");
      }
    }

    // Clean up dependent tables to avoid ORA-02292 (child record found)
    await connection.execute(`DELETE FROM app_sessions WHERE user_id = :userId`, { userId });
    
    // Check if app_password_resets exists before deleting (some minimal setups might omit it)
    try {
      await connection.execute(`DELETE FROM app_password_resets WHERE user_id = :userId`, { userId });
    } catch (e: unknown) {
      if (!isOracleMissingTableError(e)) {
        throw e; // Reraise if it's not a "table or view does not exist" error
      }
    }

    // Detach audit logs and history so we don't lose the records (user_id is nullable)
    try {
      await connection.execute(`UPDATE app_audit_logs SET user_id = NULL WHERE user_id = :userId`, { userId });
    } catch (e: unknown) {
      if (!isOracleMissingTableError(e)) throw e;
    }
    
    try {
      await connection.execute(`UPDATE app_request_history SET user_id = NULL WHERE user_id = :userId`, { userId });
    } catch (e: unknown) {
      if (!isOracleMissingTableError(e)) throw e;
    }

    await connection.execute(
      `DELETE FROM app_users WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );
  });
}

export async function toggleAppUserStatus(userId: number): Promise<AppUser> {
  return executeOne(async (connection) => {
    const existingResult = await connection.execute<DbRow>(
      `SELECT user_id, role, is_active
       FROM app_users
       WHERE user_id = :userId`,
      { userId }
    );
    const existing = existingResult.rows?.[0];
    if (!existing) {
      throw new Error("User not found.");
    }

    const existingRole = mapUserRole(existing.ROLE);
    const existingActive = String(existing.IS_ACTIVE || "N") === "Y";

    if (existingRole === "app_admin" && existingActive) {
      const activeAdmins = await countActiveAdmins(connection);
      if (activeAdmins <= 1) {
        throw new Error("Cannot deactivate the last active app admin user.");
      }
    }

    const newActive = existingActive ? "N" : "Y";
    await connection.execute(
      `UPDATE app_users
       SET is_active = :newActive,
           failed_login_count = CASE WHEN :newActive = 'Y' THEN failed_login_count ELSE 0 END,
           locked_until = CASE WHEN :newActive = 'Y' THEN locked_until ELSE NULL END,
           updated_at = SYSTIMESTAMP
       WHERE user_id = :userId`,
      { newActive, userId },
      { autoCommit: true }
    );

    const updated = await connection.execute<DbRow>(
      `SELECT
         user_id,
         username,
         email,
         role,
         is_active,
         must_change_password,
         failed_login_count,
         locked_until,
         last_login_at,
         created_at,
         updated_at
       FROM app_users
       WHERE user_id = :userId`,
      { userId }
    );
    const row = updated.rows?.[0];
    if (!row) throw new Error("Updated user was not found.");
    return mapAppUserRow(row);
  });
}

export async function revokeUserSessions(userId: number) {
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_sessions
       SET revoked_at = SYSTIMESTAMP
       WHERE user_id = :userId
         AND revoked_at IS NULL`,
      { userId },
      { autoCommit: true }
    );
  });
}

export async function clearMustChangePasswordByResetToken(resetToken: string) {
  const tokenHash = sha256Hex(resetToken.trim());
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_users u
       SET u.must_change_password = 'N',
           u.updated_at = SYSTIMESTAMP
       WHERE EXISTS (
         SELECT 1
         FROM app_password_resets r
         WHERE r.user_id = u.user_id
           AND r.token_hash = :tokenHash
       )`,
      { tokenHash },
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
    // Try the joined query first (preferences table present).  If the
    // app_user_preferences table hasn't been created yet (ORA-00942),
    // fall back to the base session query and default the theme to 'dark'.
    let result;
    let preferencesJoined = true;
    try {
      result = await connection.execute<DbRow>(
        `SELECT
            s.user_id,
            s.auth_mode,
            s.expires_at,
            u.username,
            u.role,
            p.theme_preference
          FROM app_sessions s
          JOIN app_users u ON u.user_id = s.user_id
          LEFT JOIN app_user_preferences p ON p.user_id = u.user_id
          WHERE s.session_token_hash = :sessionTokenHash
            AND s.revoked_at IS NULL
            AND s.expires_at > SYSTIMESTAMP
            AND u.is_active = 'Y'`,
        { sessionTokenHash: tokenHash }
      );
    } catch (error) {
      if (!isOracleMissingTableError(error)) throw error;
      preferencesJoined = false;
      result = await connection.execute<DbRow>(
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
    }

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
        authMode: mapAuthMode(),
        themePreference: preferencesJoined ? mapThemePreference(row.THEME_PREFERENCE) : "dark"
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

const APP_AUDITED_ACTIONS = new Set<string>(["disk_utilization", "alert_log", "Tablespace Alert"]);
const APP_AUDITED_STATUSES = new Set<string>([
  "pending_approval",
  "acknowledged",
  "approved",
  "rejected",
  "completed",
  "failed",
  "error",
  "open",
  "resolved"
]);

export async function insertAuditLog(input: {
  actor: string;
  action: string;
  db?: string;
  status: string;
  detail: string;
  metadata?: Record<string, unknown>;
  sqlCommand?: string;
}) {
  const action = String(input.action || "");
  const statusValue = String(input.status || "").toLowerCase();

  // Only "Filesystem/Drive utilization" (disk_utilization) and "Alert Log
  // Notification System" (alert_log) audit events are persisted from the
  // application. All other audit logs (login/logout, handover, checklist,
  // database management, etc.) are inserted by n8n and bypassed here.
  if (!APP_AUDITED_ACTIONS.has(action)) {
    console.log(
      `[Audit Log Bypass] actor: ${input.actor}, action: ${action}, db: ${input.db}, status: ${input.status}, detail: ${input.detail}`
    );
    return;
  }

  // Only meaningful lifecycle transitions (acknowledged/approved/rejected/
  // completed/failed) are persisted. "pending_approval" and other interim
  // states are skipped — they represent alert creation/refresh, not a
  // user action worth auditing.
  if (!APP_AUDITED_STATUSES.has(statusValue)) {
    console.log(
      `[Audit Log Bypass] actor: ${input.actor}, action: ${action}, db: ${input.db}, status: ${input.status}, detail: ${input.detail}`
    );
    return;
  }

  const safeAction = action.slice(0, 64) || "unknown";
  const actor = String(input.actor || "").slice(0, 128) || "system";
  const dbName = input.db ? String(input.db).slice(0, 64) : null;
  const status = String(input.status || "").slice(0, 32) || "info";
  const detail = input.detail || "";
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const sqlCommand = input.sqlCommand ? String(input.sqlCommand) : null;

  const alertId = input.metadata?.alert_id;
  if (alertId && (statusValue === "completed" || statusValue === "failed" || statusValue === "error")) {
    try {
      const exists = await executeOne(async (connection) => {
        const checkResult = await connection.execute<DbRow>(
          `SELECT COUNT(*) AS count FROM app_audit_logs
           WHERE status = :status
             AND action = :action
             AND db_name = :dbName
             AND DBMS_LOB.INSTR(metadata_json, :alertIdStr) > 0`,
          {
            status: status,
            action: safeAction,
            dbName: dbName,
            alertIdStr: `"alert_id":"${alertId}"`
          }
        );
        return Number(checkResult.rows?.[0]?.COUNT || 0) > 0;
      });

      if (exists) {
        console.log(`[Audit Log Duplicate Avoided] alert_id: ${alertId}, status: ${status}`);
        return;
      }
    } catch (checkError) {
      console.error(`[Audit Log Duplicate Check Failed]`, checkError);
    }
  }

  try {
    await executeOne(async (connection) => {
      await connection.execute(
        `INSERT INTO app_audit_logs (
           actor,
           action,
           db_name,
           status,
           detail,
           metadata_json,
           sql_command
         ) VALUES (
           :actor,
           :action,
           :dbName,
           :status,
           :detail,
           :metadataJson,
           :sqlCommand
         )`,
        {
          actor,
          action: safeAction,
          dbName,
          status,
          detail,
          metadataJson,
          sqlCommand
        },
        { autoCommit: true }
      );
    });
  } catch (error) {
    console.error(
      `[Audit Log Insert Failed] actor: ${actor}, action: ${safeAction}, db: ${input.db}, status: ${status}, detail: ${detail.slice(0, 200)}, error:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function listAuditLogs(
  limit?: number,
  input: { role?: UserRole; userId?: number } = {}
): Promise<AuditLogItem[]> {
  const safeLimit = limit !== undefined ? Math.min(Math.max(limit, 1), 1000000) : undefined;

  // For "client" role users, restrict to audit logs whose db_name belongs
  // to a database they own in db_inventory.
  const isClientRestricted = input.role === "client" && !!input.userId;
  const whereClause = isClientRestricted
    ? `WHERE db_name IN (
         SELECT database_name FROM database_inventory WHERE owner_id = :ownerId
       )`
    : "";

  const limitClause = safeLimit !== undefined ? `FETCH FIRST ${safeLimit} ROWS ONLY` : "";

  return executeOne(async (connection) => {
    const binds: BindParameters = isClientRestricted ? { ownerId: input.userId } : {};

    const result = await connection.execute<DbRow>(
      `SELECT
         audit_id,
         user_id,
         actor,
         action,
         db_name,
         status,
         detail,
         metadata_json,
         sql_command,
         created_at
       FROM app_audit_logs
       ${whereClause}
       ORDER BY created_at DESC, audit_id ASC
       ${limitClause}`,
      binds
    );

    return (result.rows || []).map((row) => ({
      id: `AUD-${row.AUDIT_ID}`,
      user_id: row.USER_ID ? Number(row.USER_ID) : undefined,
      actor: String(row.ACTOR),
      action: String(row.ACTION) as AuditLogItem["action"],
      db: row.DB_NAME ? String(row.DB_NAME) : undefined,
      status: String(row.STATUS),
      detail: row.DETAIL ? String(row.DETAIL) : "",
      sql_command: (row.SQL_COMMAND && String(row.STATUS).toLowerCase() !== "pending_approval") ? String(row.SQL_COMMAND) : undefined,
      metadata: parseJson<Record<string, unknown>>(row.METADATA_JSON),
      timestamp: toIstIsoString(row.CREATED_AT)
    }));
  });
}

/**
 * Fetch the single most-recent audit log row for each performance action,
 * filtered by the given db_name.  Returns a map keyed by action name.
 */
export async function listPerformanceAuditLogs(
  db: string,
  actions: string[]
): Promise<Record<string, AuditLogItem>> {
  if (!actions.length) return {};

  // Build a bind parameter set for the IN clause
  const binds: BindParameters = { dbName: db };
  const inPlaceholders = actions.map((_, i) => `:a${i}`).join(", ");
  actions.forEach((action, i) => {
    (binds as Record<string, unknown>)[`a${i}`] = action;
  });

  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT audit_id, user_id, actor, action, db_name, status, detail, metadata_json, created_at
       FROM (
         SELECT
           audit_id, user_id, actor, action, db_name, status, detail, metadata_json, created_at,
           ROW_NUMBER() OVER (PARTITION BY action ORDER BY created_at DESC) AS rn
         FROM app_audit_logs
         WHERE db_name = :dbName
           AND action IN (${inPlaceholders})
       )
       WHERE rn = 1`,
      binds
    );

    const map: Record<string, AuditLogItem> = {};
    for (const row of result.rows || []) {
      const action = String(row.ACTION);
      map[action] = {
        id: `AUD-${row.AUDIT_ID}`,
        user_id: row.USER_ID ? Number(row.USER_ID) : undefined,
        actor: String(row.ACTOR),
        action: action as AuditLogItem["action"],
        db: row.DB_NAME ? String(row.DB_NAME) : undefined,
        status: String(row.STATUS),
        detail: row.DETAIL ? String(row.DETAIL) : "",
        metadata: parseJson<Record<string, unknown>>(row.METADATA_JSON),
        timestamp: toIstIsoString(row.CREATED_AT)
      };
    }
    return map;
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

export async function findPendingAlertNotificationOccurrence(
  input: FindPendingAlertOccurrenceInput
): Promise<AlertNotification | null> {
  const objectName = input.objectName || input.tablespace;

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
       WHERE db_name = :dbName
         AND alert_type = :alertType
         AND alert_status = 'pending_approval'
         AND (
           (:tablespaceName IS NOT NULL AND tablespace_name = :tablespaceName)
           OR (:objectName IS NOT NULL AND object_name = :objectName)
         )
       ORDER BY updated_at DESC, created_at DESC
       FETCH FIRST 1 ROWS ONLY`,
      {
        dbName: input.db,
        alertType: input.alertType,
        tablespaceName: input.tablespace || null,
        objectName: objectName || null
      }
    );

    const row = result.rows?.[0];
    return row ? mapAlertNotificationRow(row) : null;
  });
}

export async function replacePendingAlertNotification(
  input: ReplacePendingAlertNotificationInput
): Promise<AlertNotification> {
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_alert_notifications
       SET source_name = :sourceName,
           alert_type = :alertType,
           db_name = :dbName,
           tablespace_name = :tablespaceName,
           object_name = :objectName,
           severity = :severity,
           alert_status = 'pending_approval',
           message_text = :messageText,
           utilization_pct = :utilizationPct,
           threshold_pct = :thresholdPct,
           critical_pct = :criticalPct,
           used_gb = :usedGb,
           free_gb = :freeGb,
           extend_size_gb = :extendSizeGb,
           datafile_name = :datafileName,
           workflow_run_id = :workflowRunId,
           approval_url = :approvalUrl,
           reject_url = :rejectUrl,
           callback_url = :callbackUrl,
           created_by = :createdBy,
           approved_by = NULL,
           approved_at = NULL,
           completed_at = NULL,
           metadata_json = :metadataJson,
           updated_at = SYSTIMESTAMP
       WHERE alert_id = :alertId
         AND alert_status = 'pending_approval'`,
      {
        alertId: input.id,
        sourceName: input.source || "n8n",
        alertType: input.alertType || "tablespace",
        dbName: input.db,
        tablespaceName: input.tablespace || null,
        objectName: input.objectName || input.tablespace || null,
        severity: input.severity,
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
    throw new Error(`Alert notification not found after pending replacement: ${input.id}`);
  }
  return alert;
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

export interface InsertDbaAlertAuditInput {
  database_name: string;
  error_code?: string;
  message_text: string;
  severity?: DbaAlertLogSeverity;
  status?: DbaAlertLogStatus;
  acknowledged_by?: string;
  resolved_by?: string;
  originating_timestamp?: string | Date;
}

/**
 * Insert a fully-specified dba_alert_log row (used for audit events such as
 * filesystem/drive alert acknowledgements). Unlike insertDbaAlertLog, this
 * variant lets the caller choose the initial status and stamp the
 * acknowledged_by/resolved_by columns in the same INSERT. Duplicates
 * (uk_dba_alert_log) are silently ignored.
 */
export async function insertDbaAlertLogAudit(
  input: InsertDbaAlertAuditInput
): Promise<{ inserted: boolean; alert_id?: number }> {
  const status: DbaAlertLogStatus = input.status || "OPEN";
  const severity: DbaAlertLogSeverity = input.severity || computeAlertSeverity(input.error_code);
  const ts =
    input.originating_timestamp instanceof Date
      ? input.originating_timestamp
      : new Date(input.originating_timestamp || Date.now());
  const messageText = (input.message_text || "").slice(0, 4000);
  const isAck = status === "ACKNOWLEDGED";
  const isResolved = status === "RESOLVED";

  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `INSERT INTO dba_alert_log (
           database_name,
           originating_timestamp,
           error_code,
           message_text,
           severity,
           status,
           acknowledged_by,
           acknowledged_at,
           resolved_by,
           resolved_at
         ) VALUES (
           :databaseName,
           :originatingTimestamp,
           :errorCode,
           :messageText,
           :severity,
           :status,
           :acknowledgedBy,
           :acknowledgedAt,
           :resolvedBy,
           :resolvedAt
         )`,
        {
          databaseName: input.database_name.slice(0, 50),
          originatingTimestamp: ts,
          errorCode: input.error_code ? input.error_code.slice(0, 20) : null,
          messageText: messageText || null,
          severity,
          status,
          acknowledgedBy: isAck ? input.acknowledged_by || null : null,
          acknowledgedAt: isAck ? ts : null,
          resolvedBy: isResolved ? input.resolved_by || input.acknowledged_by || null : null,
          resolvedAt: isResolved ? ts : null
        },
        { autoCommit: true }
      );

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

// ============================================================
// Performance Run All History — performance_run_all_hist
// ============================================================

export interface PerformanceRunAllRow {
  run_id: number;
  db_name: string;
  environment: string | null;
  os: string | null;
  refreshed_by: string;
  /** Parsed JSON payload containing each query's result array */
  metrics_payload: Record<string, unknown> | null;
  /** LLM-generated narrative returned from n8n */
  ai_summary: string | null;
  created_at: string;
}

export async function getLatestPerformanceRunAll(
  db: string
): Promise<PerformanceRunAllRow | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         run_id,
         db_name,
         environment,
         os,
         refreshed_by,
         metrics_payload,
         ai_summary,
         created_at
       FROM performance_run_all_hist
       WHERE db_name = :dbName
       ORDER BY created_at DESC
       FETCH FIRST 1 ROWS ONLY`,
      { dbName: db }
    );

    const row = result.rows?.[0];
    if (!row) return null;

    return {
      run_id: Number(row.RUN_ID ?? row.run_id),
      db_name: String(row.DB_NAME ?? row.db_name ?? db),
      environment: row.ENVIRONMENT != null ? String(row.ENVIRONMENT) : null,
      os: row.OS != null ? String(row.OS) : null,
      refreshed_by: String(row.REFRESHED_BY ?? row.refreshed_by ?? ""),
      metrics_payload: parseJson<Record<string, unknown>>(
        row.METRICS_PAYLOAD ?? row.metrics_payload
      ) ?? null,
      ai_summary:
        row.AI_SUMMARY != null ? String(row.AI_SUMMARY) : null,
      created_at: toIstIsoString(row.CREATED_AT ?? row.created_at)
    };
  });
}

// ============================================================
// DBA Console — Shift Management
// ============================================================

interface ShiftSessionRow extends DbRow {
  SESSION_ID: number;
  USER_ID: number;
  USERNAME: string;
  EMAIL: string;
  ROLE: string;
  SHIFT_NUMBER: number;
  SHIFT_DATE: Date;
  LOGIN_AT: Date;
  LOGOUT_AT?: Date;
  STATUS: string;
  IS_ACTIVE: string;
  HANDOVER_ID?: number;
  HANDOVER_TEXT?: string;
  HANDOVER_STATUS?: string;
  ACK_USERNAME?: string;
  ACK_AT?: Date;
}

function mapShiftSession(row: ShiftSessionRow): ShiftSession {
  return {
    session_id: Number(row.SESSION_ID),
    user_id: Number(row.USER_ID),
    username: String(row.USERNAME),
    email: String(row.EMAIL || ""),
    role: mapUserRole(row.ROLE),
    shift_number: Number(row.SHIFT_NUMBER) as 1 | 2 | 3 | 4,
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    login_at: toIstIsoString(row.LOGIN_AT),
    logout_at: row.LOGOUT_AT ? toIstIsoString(row.LOGOUT_AT) : undefined,
    status: String(row.STATUS) as "ACTIVE" | "CLOSED",
    is_active: String(row.IS_ACTIVE || "N") === "Y",
    handover_status: row.HANDOVER_STATUS
      ? (String(row.HANDOVER_STATUS) as "PENDING" | "ACKNOWLEDGED")
      : "NONE",
    handover_id: row.HANDOVER_ID ? Number(row.HANDOVER_ID) : undefined,
    handover_text: row.HANDOVER_TEXT ? String(row.HANDOVER_TEXT) : undefined,
    ack_username: row.ACK_USERNAME ? String(row.ACK_USERNAME) : undefined,
    ack_at: row.ACK_AT ? toIstIsoString(row.ACK_AT) : undefined
  };
}

const SHIFT_SESSION_COLUMNS = `
  s.session_id, s.user_id, s.username, s.email, u.role,
  s.shift_number, s.shift_date, s.login_at, s.logout_at,
  s.status, s.is_active,
  h.handover_id, h.handover_text, h.status AS handover_status,
  h.ack_username, h.ack_at
`;

const SHIFT_SESSION_JOIN = `
  FROM app_shift_sessions s
  JOIN app_users u ON u.user_id = s.user_id
  LEFT JOIN app_handovers h ON h.session_id = s.session_id
`;

export async function createShiftLogin(input: {
  userId: number;
  username: string;
  shiftNumber: number;
  actor: string;
}): Promise<ShiftSession> {
  const now = new Date();
  const shiftDate = getShiftStartDate(now, input.shiftNumber);

  return executeOne(async (connection) => {
    try {
      const userResult = await connection.execute<DbRow>(
        `SELECT email FROM app_users WHERE user_id = :userId FETCH FIRST 1 ROWS ONLY`,
        { userId: input.userId }
      );
      const email = userResult.rows?.[0]?.EMAIL ? String(userResult.rows[0].EMAIL) : input.username;

      await connection.execute(
        `INSERT INTO app_shift_sessions (
           user_id, username, email, shift_number, shift_date,
           login_at, status, is_active, created_by, updated_by
         ) VALUES (
           :userId, :username, :email, :shiftNumber, TO_DATE(:shiftDate, 'YYYY-MM-DD'),
           SYSTIMESTAMP, 'ACTIVE', 'Y', :actor, :actor
         )`,
        {
          userId: input.userId,
          username: input.username,
          email,
          shiftNumber: input.shiftNumber,
          shiftDate: toOracleDateString(shiftDate),
          actor: input.actor
        }
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }).then(() => getActiveShiftSessionForUser(input.userId)) as Promise<ShiftSession>;
}

export async function getActiveShiftSessionForUser(userId: number): Promise<ShiftSession> {
  return executeOne(async (connection) => {
    const result = await connection.execute<ShiftSessionRow>(
      `SELECT ${SHIFT_SESSION_COLUMNS}
       ${SHIFT_SESSION_JOIN}
       WHERE s.user_id = :userId AND s.is_active = 'Y'
       FETCH FIRST 1 ROWS ONLY`,
      { userId }
    );
    const row = result.rows?.[0] as ShiftSessionRow | undefined;
    if (!row) throw new Error("No active shift session found for user.");
    return mapShiftSession(row);
  });
}

export async function listActiveShiftSessions(): Promise<ShiftSession[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<ShiftSessionRow>(
      `SELECT ${SHIFT_SESSION_COLUMNS}
       ${SHIFT_SESSION_JOIN}
       WHERE s.is_active = 'Y'
       ORDER BY s.login_at`
    );
    return (result.rows || []).map((row) => mapShiftSession(row as ShiftSessionRow));
  });
}

/**
 * Returns the set of time-based shift numbers (1,2,3) that already have an
 * active DBA logged in. Used by the login API to block duplicate shift logins.
 * General Shift (4) is excluded — multiple DBAs can be on general shift.
 */
export async function getTakenShifts(): Promise<number[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT DISTINCT shift_number
       FROM app_shift_sessions
       WHERE is_active = 'Y' AND shift_number IN (1,2,3)`
    );
    return (result.rows || []).map((row) => Number(row.SHIFT_NUMBER));
  });
}

export async function getShiftSessionById(sessionId: number): Promise<ShiftSession | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<ShiftSessionRow>(
      `SELECT ${SHIFT_SESSION_COLUMNS}
       ${SHIFT_SESSION_JOIN}
       WHERE s.session_id = :sessionId
       FETCH FIRST 1 ROWS ONLY`,
      { sessionId }
    );
    const row = result.rows?.[0] as ShiftSessionRow | undefined;
    return row ? mapShiftSession(row) : null;
  });
}

export async function closeShiftSession(input: {
  sessionId: number;
  actor: string;
}): Promise<ShiftSession> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute(
        `UPDATE app_shift_sessions
         SET logout_at = SYSTIMESTAMP,
             status = 'CLOSED',
             is_active = 'N',
             updated_by = :actor
         WHERE session_id = :sessionId AND is_active = 'Y'`,
        { sessionId: input.sessionId, actor: input.actor }
      );

      const affected = result.rowsAffected ?? 0;
      if (affected === 0) {
        throw new Error("Shift session is not active or has already been closed.");
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }).then(() => getShiftSessionById(input.sessionId)) as Promise<ShiftSession>;
}

export async function getCurrentShiftState(): Promise<CurrentShiftState> {
  const now = new Date();
  const activeShifts = getActiveShifts(now);
  const overlap = activeShifts.length > 1;
  const label = activeShifts.length ? activeShifts.map((n) => `Shift ${n}`).join(" + ") : "No active shift";

  const sessions = await listActiveShiftSessions();
  const takenShifts = await getTakenShifts();
  const selectable = getSelectableShifts(now);
  const activeDbas = sessions.map((s) => ({
    session_id: s.session_id,
    user_id: s.user_id,
    username: s.username,
    shift_number: s.shift_number,
    login_at: s.login_at
  }));

  return {
    active_shifts: activeShifts,
    shift_label: label,
    overlap,
    server_time: now.toISOString(),
    active_dbas: activeDbas,
    sessions,
    taken_shifts: takenShifts,
    selectable_shifts: selectable.enabledShifts,
    disabled_shifts: selectable.disabledShifts,
    preferred_shift: selectable.preferredShift
  };
}

// ============================================================
// DBA Console — Handovers
// ============================================================

interface HandoverRow extends DbRow {
  HANDOVER_ID: number;
  SESSION_ID: number;
  AUTHOR_USER_ID: number;
  AUTHOR_USERNAME: string;
  SHIFT_NUMBER: number;
  SHIFT_DATE: Date;
  HANDOVER_TEXT: string;
  STATUS: string;
  ACK_USER_ID?: number;
  ACK_USERNAME?: string;
  ACK_AT?: Date;
  OVERRIDE_REASON?: string;
  IS_OVERRIDE: string;
  CREATED_AT: Date;
  UPDATED_AT: Date;
}

function mapHandover(row: HandoverRow): Handover {
  return {
    handover_id: Number(row.HANDOVER_ID),
    session_id: Number(row.SESSION_ID),
    author_user_id: Number(row.AUTHOR_USER_ID),
    author_username: String(row.AUTHOR_USERNAME),
    shift_number: Number(row.SHIFT_NUMBER) as 1 | 2 | 3 | 4,
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    handover_text: String(row.HANDOVER_TEXT || ""),
    status: String(row.STATUS) as "PENDING" | "ACKNOWLEDGED",
    ack_user_id: row.ACK_USER_ID ? Number(row.ACK_USER_ID) : undefined,
    ack_username: row.ACK_USERNAME ? String(row.ACK_USERNAME) : undefined,
    ack_at: row.ACK_AT ? toIstIsoString(row.ACK_AT) : undefined,
    override_reason: row.OVERRIDE_REASON ? String(row.OVERRIDE_REASON) : undefined,
    is_override: String(row.IS_OVERRIDE || "N") === "Y",
    created_at: toIstIsoString(row.CREATED_AT),
    updated_at: toIstIsoString(row.UPDATED_AT)
  };
}

export async function createHandover(input: {
  sessionId: number;
  authorUserId: number;
  authorUsername: string;
  shiftNumber: number;
  handoverText: string;
  actor: string;
}): Promise<Handover> {
  return executeOne(async (connection) => {
    try {
      const sessionResult = await connection.execute<DbRow>(
        `SELECT shift_date FROM app_shift_sessions WHERE session_id = :sessionId FETCH FIRST 1 ROWS ONLY`,
        { sessionId: input.sessionId }
      );
      const sessionRow = sessionResult.rows?.[0];
      if (!sessionRow) throw new Error("Shift session not found.");
      const shiftDate = asDate(sessionRow.SHIFT_DATE) || new Date();

      await connection.execute(
        `INSERT INTO app_handovers (
           session_id, author_user_id, author_username, shift_number, shift_date,
           handover_text, status, is_override, created_by, updated_by
         ) VALUES (
           :sessionId, :authorUserId, :authorUsername, :shiftNumber, :shiftDate,
           :handoverText, 'PENDING', 'N', :actor, :actor
         )`,
        {
          sessionId: input.sessionId,
          authorUserId: input.authorUserId,
          authorUsername: input.authorUsername,
          shiftNumber: input.shiftNumber,
          shiftDate,
          handoverText: input.handoverText,
          actor: input.actor
        }
      );

      await connection.commit();
      const handover = await getHandoverById(connection, input.sessionId, true);
      if (!handover) throw new Error("Handover was not created.");
      return handover;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

async function getHandoverById(connection: Connection, key: number, bySession = false): Promise<Handover | null> {
  const whereClause = bySession
    ? `WHERE session_id = :key`
    : `WHERE handover_id = :key`;
  const orderBy = bySession ? `ORDER BY handover_id DESC` : "";
  const fetchFirst = bySession ? `FETCH FIRST 1 ROWS ONLY` : `FETCH FIRST 1 ROWS ONLY`;
  const result = await connection.execute<HandoverRow>(
    `SELECT handover_id, session_id, author_user_id, author_username,
            shift_number, shift_date, handover_text, status,
            ack_user_id, ack_username, ack_at, override_reason, is_override,
            created_at, updated_at
     FROM app_handovers
     ${whereClause}
     ${orderBy}
     ${fetchFirst}`,
    { key }
  );
  const row = result.rows?.[0] as HandoverRow | undefined;
  return row ? mapHandover(row) : null;
}

export async function getHandoverForSession(sessionId: number): Promise<Handover | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<HandoverRow>(
      `SELECT handover_id, session_id, author_user_id, author_username,
              shift_number, shift_date, handover_text, status,
              ack_user_id, ack_username, ack_at, override_reason, is_override,
              created_at, updated_at
       FROM app_handovers
       WHERE session_id = :sessionId
       ORDER BY handover_id DESC
       FETCH FIRST 1 ROWS ONLY`,
      { sessionId }
    );
    const row = result.rows?.[0] as HandoverRow | undefined;
    return row ? mapHandover(row) : null;
  });
}

export async function acknowledgeHandover(input: {
  handoverId: number;
  ackUserId: number;
  ackUsername: string;
  actor: string;
}): Promise<Handover> {
  return executeOne(async (connection) => {
    try {
      const existing = await getHandoverById(connection, input.handoverId);
      if (!existing) throw new Error("Handover not found.");
      if (existing.status === "ACKNOWLEDGED") throw new Error("Handover is already acknowledged.");
      if (existing.author_user_id === input.ackUserId) {
        throw new Error("You cannot acknowledge your own handover.");
      }

      await connection.execute(
        `UPDATE app_handovers
         SET status = 'ACKNOWLEDGED',
             ack_user_id = :ackUserId,
             ack_username = :ackUsername,
             ack_at = SYSTIMESTAMP,
             is_override = 'N',
             updated_by = :actor
         WHERE handover_id = :handoverId`,
        {
          handoverId: input.handoverId,
          ackUserId: input.ackUserId,
          ackUsername: input.ackUsername,
          actor: input.actor
        }
      );

      await connection.commit();
      const handover = await getHandoverById(connection, input.handoverId);
      if (!handover) throw new Error("Handover was not updated.");
      return handover;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function overrideHandover(input: {
  handoverId: number;
  adminUserId: number;
  adminUsername: string;
  reason: string;
  actor: string;
}): Promise<Handover> {
  return executeOne(async (connection) => {
    try {
      const existing = await getHandoverById(connection, input.handoverId);
      if (!existing) throw new Error("Handover not found.");
      if (existing.status === "ACKNOWLEDGED") throw new Error("Handover is already acknowledged.");

      await connection.execute(
        `UPDATE app_handovers
         SET status = 'ACKNOWLEDGED',
             ack_user_id = :ackUserId,
             ack_username = :ackUsername,
             ack_at = SYSTIMESTAMP,
             is_override = 'Y',
             override_reason = :reason,
             updated_by = :actor
         WHERE handover_id = :handoverId`,
        {
          handoverId: input.handoverId,
          ackUserId: input.adminUserId,
          ackUsername: input.adminUsername,
          reason: input.reason,
          actor: input.actor
        }
      );

      await connection.commit();
      const handover = await getHandoverById(connection, input.handoverId);
      if (!handover) throw new Error("Handover was not updated.");
      return handover;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function listPendingHandovers(): Promise<Handover[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<HandoverRow>(
      `SELECT handover_id, session_id, author_user_id, author_username,
              shift_number, shift_date, handover_text, status,
              ack_user_id, ack_username, ack_at, override_reason, is_override,
              created_at, updated_at
       FROM app_handovers
       WHERE status = 'PENDING'
       ORDER BY created_at DESC`
    );
    return (result.rows || []).map((row) => mapHandover(row as HandoverRow));
  });
}

/**
 * Returns historical handovers (both acknowledged and pending) ordered by
 * most recent first. Used by the Shift Management page to show recent
 * handover texts and full history to dba_admin/app_admin.
 */
export async function listHandoverHistory(limit = 20): Promise<Handover[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return executeOne(async (connection) => {
    const result = await connection.execute<HandoverRow>(
      `SELECT handover_id, session_id, author_user_id, author_username,
              shift_number, shift_date, handover_text, status,
              ack_user_id, ack_username, ack_at, override_reason, is_override,
              created_at, updated_at
       FROM app_handovers
       ORDER BY created_at DESC
       FETCH FIRST ${safeLimit} ROWS ONLY`
    );
    return (result.rows || []).map((row) => mapHandover(row as HandoverRow));
  });
}

// ============================================================
// DBA Console — Backup Template (app_admin maintained)
// ============================================================

interface BackupTemplateRow extends DbRow {
  BACKUP_ID: number;
  DATABASE_ID: number;
  DATABASE_NAME: string;
  BACKUP_NAME: string;
  SCHEDULED_TIME?: string;
  BACKUP_TYPE?: string;
  IS_ACTIVE: string;
  CREATED_AT: Date;
  UPDATED_AT: Date;
  CREATED_BY?: string;
  UPDATED_BY?: string;
}

function mapBackupTemplate(row: BackupTemplateRow): BackupTemplate {
  return {
    backup_id: Number(row.BACKUP_ID),
    database_id: Number(row.DATABASE_ID),
    database_name: String(row.DATABASE_NAME),
    backup_name: String(row.BACKUP_NAME),
    scheduled_time: row.SCHEDULED_TIME ? String(row.SCHEDULED_TIME) : undefined,
    backup_type: row.BACKUP_TYPE ? String(row.BACKUP_TYPE) : undefined,
    is_active: String(row.IS_ACTIVE || "Y") === "Y",
    created_at: toIstIsoString(row.CREATED_AT),
    updated_at: toIstIsoString(row.UPDATED_AT),
    created_by: row.CREATED_BY ? String(row.CREATED_BY) : undefined,
    updated_by: row.UPDATED_BY ? String(row.UPDATED_BY) : undefined
  };
}

export async function listBackupTemplates(activeOnly = false): Promise<BackupTemplate[]> {
  return executeOne(async (connection) => {
    const filter = activeOnly ? `WHERE t.is_active = 'Y'` : "";
    const result = await connection.execute<BackupTemplateRow>(
      `SELECT t.backup_id, t.database_id, d.database_name, t.backup_name,
              t.scheduled_time, t.backup_type, t.is_active,
              t.created_at, t.updated_at, t.created_by, t.updated_by
       FROM app_backup_template t
       JOIN database_inventory d ON d.id = t.database_id
       ${filter}
       ORDER BY UPPER(d.database_name), UPPER(t.backup_name)`,
      {}
    );
    return (result.rows || []).map((row) => mapBackupTemplate(row as BackupTemplateRow));
  });
}

export async function createBackupTemplate(input: {
  databaseId: number;
  backupName: string;
  scheduledTime?: string;
  backupType?: string;
  actor: string;
}): Promise<BackupTemplate> {
  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `INSERT INTO app_backup_template (
           database_id, backup_name, scheduled_time, backup_type, is_active,
           created_by, updated_by
         ) VALUES (
           :databaseId, :backupName, :scheduledTime, :backupType, 'Y',
           :actor, :actor
         )`,
        {
          databaseId: input.databaseId,
          backupName: input.backupName,
          scheduledTime: input.scheduledTime || null,
          backupType: input.backupType || null,
          actor: input.actor
        }
      );
      await connection.commit();
      const templates = await listBackupTemplates();
      return templates.find(
        (t) => t.database_id === input.databaseId && t.backup_name.toUpperCase() === input.backupName.toUpperCase()
      ) as BackupTemplate;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function updateBackupTemplate(input: {
  backupId: number;
  databaseId: number;
  backupName: string;
  scheduledTime?: string;
  backupType?: string;
  isActive: boolean;
  actor: string;
}): Promise<BackupTemplate> {
  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `UPDATE app_backup_template
         SET database_id = :databaseId,
             backup_name = :backupName,
             scheduled_time = :scheduledTime,
             backup_type = :backupType,
             is_active = :isActive,
             updated_by = :actor
         WHERE backup_id = :backupId`,
        {
          backupId: input.backupId,
          databaseId: input.databaseId,
          backupName: input.backupName,
          scheduledTime: input.scheduledTime || null,
          backupType: input.backupType || null,
          isActive: input.isActive ? "Y" : "N",
          actor: input.actor
        }
      );

      await connection.commit();
      const templates = await listBackupTemplates();
      return templates.find((t) => t.backup_id === input.backupId) as BackupTemplate;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function deleteBackupTemplate(backupId: number): Promise<void> {
  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `DELETE FROM app_backup_template WHERE backup_id = :backupId`,
        { backupId }
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

// ============================================================
// DBA Console — Daily Checklist (DB status + Backup status)
// ============================================================

interface DbStatusRow extends DbRow {
  CHECK_ID: number;
  DATABASE_ID: number;
  DATABASE_NAME: string;
  SHIFT_NUMBER: number;
  SHIFT_DATE: Date;
  STATUS: string;
  CHECKED_BY: number;
  CHECKED_USERNAME: string;
  CHECKED_AT: Date;
  COMMENT_TEXT?: string;
}

function mapDbStatusCheck(row: DbStatusRow): DbStatusCheck {
  return {
    check_id: Number(row.CHECK_ID),
    database_id: Number(row.DATABASE_ID),
    database_name: String(row.DATABASE_NAME),
    shift_number: Number(row.SHIFT_NUMBER) as 1 | 2 | 3 | 4,
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    status: String(row.STATUS) as DbStatusValue,
    checked_by: Number(row.CHECKED_BY),
    checked_username: String(row.CHECKED_USERNAME),
    checked_at: toIstIsoString(row.CHECKED_AT),
    comment_text: row.COMMENT_TEXT ? String(row.COMMENT_TEXT) : undefined
  };
}

export async function listDbStatusChecks(shiftNumber: number, shiftDate: string): Promise<DbStatusCheck[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbStatusRow>(
      `SELECT c.check_id, c.database_id, d.database_name, c.shift_number,
              c.shift_date, c.status, c.checked_by, c.checked_username,
              c.checked_at, c.comment_text
       FROM app_db_status_checks c
       JOIN database_inventory d ON d.id = c.database_id
       WHERE c.shift_number = :shiftNumber
         AND TRUNC(c.shift_date) = TO_DATE(:shiftDate, 'YYYY-MM-DD')
       ORDER BY UPPER(d.database_name)`,
      { shiftNumber, shiftDate }
    );
    return (result.rows || []).map((row) => mapDbStatusCheck(row as DbStatusRow));
  });
}

export async function upsertDbStatusCheck(input: {
  databaseId: number;
  shiftNumber: number;
  shiftDate: string;
  status: DbStatusValue;
  checkedBy: number;
  checkedUsername: string;
  commentText?: string;
  actor: string;
}): Promise<DbStatusCheck> {
  return executeOne(async (connection) => {
    try {
      const existing = await connection.execute<DbRow>(
        `SELECT check_id FROM app_db_status_checks
         WHERE database_id = :databaseId
           AND shift_number = :shiftNumber
           AND TRUNC(shift_date) = TO_DATE(:shiftDate, 'YYYY-MM-DD')
         FETCH FIRST 1 ROWS ONLY`,
        {
          databaseId: input.databaseId,
          shiftNumber: input.shiftNumber,
          shiftDate: input.shiftDate
        }
      );

      const existingRow = existing.rows?.[0];

      if (existingRow) {
        await connection.execute(
          `UPDATE app_db_status_checks
           SET status = :status,
               checked_by = :checkedBy,
               checked_username = :checkedUsername,
               checked_at = SYSTIMESTAMP,
               comment_text = :commentText,
               updated_by = :actor
           WHERE check_id = :checkId`,
          {
            checkId: Number(existingRow.CHECK_ID),
            status: input.status,
            checkedBy: input.checkedBy,
            checkedUsername: input.checkedUsername,
            commentText: input.commentText || null,
            actor: input.actor
          }
        );
        await connection.commit();
        const checks = await listDbStatusChecks(input.shiftNumber, input.shiftDate);
        return checks.find((c) => c.check_id === Number(existingRow.CHECK_ID)) as DbStatusCheck;
      }

      await connection.execute(
        `INSERT INTO app_db_status_checks (
           database_id, shift_number, shift_date, status,
           checked_by, checked_username, checked_at, comment_text,
           created_by, updated_by
         ) VALUES (
           :databaseId, :shiftNumber, TO_DATE(:shiftDate, 'YYYY-MM-DD'), :status,
           :checkedBy, :checkedUsername, SYSTIMESTAMP, :commentText,
           :actor, :actor
         )`,
        {
          databaseId: input.databaseId,
          shiftNumber: input.shiftNumber,
          shiftDate: input.shiftDate,
          status: input.status,
          checkedBy: input.checkedBy,
          checkedUsername: input.checkedUsername,
          commentText: input.commentText || null,
          actor: input.actor
        }
      );
      await connection.commit();
      const checks = await listDbStatusChecks(input.shiftNumber, input.shiftDate);
      return checks.find((c) => c.database_id === input.databaseId) as DbStatusCheck;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

interface BackupStatusRow extends DbRow {
  CHECK_ID: number;
  BACKUP_ID: number;
  DATABASE_ID: number;
  DATABASE_NAME: string;
  BACKUP_NAME: string;
  SHIFT_NUMBER: number;
  SHIFT_DATE: Date;
  STATUS: string;
  CHECKED_BY: number;
  CHECKED_USERNAME: string;
  CHECKED_AT: Date;
  COMMENT_TEXT?: string;
}

function mapBackupStatusCheck(row: BackupStatusRow): BackupStatusCheck {
  return {
    check_id: Number(row.CHECK_ID),
    backup_id: Number(row.BACKUP_ID),
    database_id: Number(row.DATABASE_ID),
    database_name: String(row.DATABASE_NAME),
    backup_name: String(row.BACKUP_NAME),
    shift_number: Number(row.SHIFT_NUMBER) as 1 | 2 | 3 | 4,
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    status: String(row.STATUS) as BackupStatusValue,
    checked_by: Number(row.CHECKED_BY),
    checked_username: String(row.CHECKED_USERNAME),
    checked_at: toIstIsoString(row.CHECKED_AT),
    comment_text: row.COMMENT_TEXT ? String(row.COMMENT_TEXT) : undefined
  };
}

export async function listBackupStatusChecks(shiftNumber: number, shiftDate: string): Promise<BackupStatusCheck[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<BackupStatusRow>(
      `SELECT c.check_id, c.backup_id, c.database_id, d.database_name,
              t.backup_name, c.shift_number, c.shift_date, c.status,
              c.checked_by, c.checked_username, c.checked_at, c.comment_text
       FROM app_backup_status_checks c
       JOIN database_inventory d ON d.id = c.database_id
       JOIN app_backup_template t ON t.backup_id = c.backup_id
       WHERE c.shift_number = :shiftNumber
         AND TRUNC(c.shift_date) = TO_DATE(:shiftDate, 'YYYY-MM-DD')
       ORDER BY UPPER(d.database_name), UPPER(t.backup_name)`,
      { shiftNumber, shiftDate }
    );
    return (result.rows || []).map((row) => mapBackupStatusCheck(row as BackupStatusRow));
  });
}

export async function upsertBackupStatusCheck(input: {
  backupId: number;
  databaseId: number;
  shiftNumber: number;
  shiftDate: string;
  status: BackupStatusValue;
  checkedBy: number;
  checkedUsername: string;
  commentText?: string;
  actor: string;
}): Promise<BackupStatusCheck> {
  return executeOne(async (connection) => {
    try {
      const existing = await connection.execute<DbRow>(
        `SELECT check_id FROM app_backup_status_checks
         WHERE backup_id = :backupId
           AND shift_number = :shiftNumber
           AND TRUNC(shift_date) = TO_DATE(:shiftDate, 'YYYY-MM-DD')
         FETCH FIRST 1 ROWS ONLY`,
        {
          backupId: input.backupId,
          shiftNumber: input.shiftNumber,
          shiftDate: input.shiftDate
        }
      );

      const existingRow = existing.rows?.[0];

      if (existingRow) {
        await connection.execute(
          `UPDATE app_backup_status_checks
           SET status = :status,
               checked_by = :checkedBy,
               checked_username = :checkedUsername,
               checked_at = SYSTIMESTAMP,
               comment_text = :commentText,
               updated_by = :actor
           WHERE check_id = :checkId`,
          {
            checkId: Number(existingRow.CHECK_ID),
            status: input.status,
            checkedBy: input.checkedBy,
            checkedUsername: input.checkedUsername,
            commentText: input.commentText || null,
            actor: input.actor
          }
        );
        await connection.commit();
        const checks = await listBackupStatusChecks(input.shiftNumber, input.shiftDate);
        return checks.find((c) => c.check_id === Number(existingRow.CHECK_ID)) as BackupStatusCheck;
      }

      await connection.execute(
        `INSERT INTO app_backup_status_checks (
           backup_id, database_id, shift_number, shift_date, status,
           checked_by, checked_username, checked_at, comment_text,
           created_by, updated_by
         ) VALUES (
           :backupId, :databaseId, :shiftNumber, TO_DATE(:shiftDate, 'YYYY-MM-DD'), :status,
           :checkedBy, :checkedUsername, SYSTIMESTAMP, :commentText,
           :actor, :actor
         )`,
        {
          backupId: input.backupId,
          databaseId: input.databaseId,
          shiftNumber: input.shiftNumber,
          shiftDate: input.shiftDate,
          status: input.status,
          checkedBy: input.checkedBy,
          checkedUsername: input.checkedUsername,
          commentText: input.commentText || null,
          actor: input.actor
        }
      );
      await connection.commit();
      const checks = await listBackupStatusChecks(input.shiftNumber, input.shiftDate);
      return checks.find((c) => c.backup_id === input.backupId) as BackupStatusCheck;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

// ============================================================
// DBA Console — Shift Report (app_admin only)
// ============================================================

export async function getShiftReport(filters: ShiftReportFilters): Promise<ShiftReportData> {
  const binds: BindParameters = {};
  const conditions: string[] = [];

  if (filters.fromDate) {
    binds.fromDate = filters.fromDate;
    conditions.push("TRUNC(s.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  }
  if (filters.toDate) {
    binds.toDate = filters.toDate;
    conditions.push("TRUNC(s.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  if (filters.dbaUserId) {
    binds.dbaUserId = filters.dbaUserId;
    conditions.push("s.user_id = :dbaUserId");
  }
  if (filters.shiftNumber) {
    binds.shiftNumber = filters.shiftNumber;
    conditions.push("s.shift_number = :shiftNumber");
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return executeOne(async (connection) => {
    const [activeDbas, dailyAttendance, monthlyAttendance, lateLogins, pendingHandovers, avgResult, mostActiveResult, timelineResult, loginTrend, dbCompletion, backupCompletion, dbStatusChecks, backupStatusChecks, handovers, sessions, coverage] = await Promise.all([
      listActiveShiftSessionsForReport(connection),
      fetchDailyAttendance(connection, binds, whereClause),
      fetchMonthlyAttendance(connection, binds, whereClause),
      fetchLateLogins(connection, binds, whereClause),
      listPendingHandovers(),
      fetchAvgLoginDuration(connection, binds, whereClause),
      fetchMostActiveDba(connection, binds, whereClause),
      fetchActivityTimeline(connection, binds, whereClause, filters),
      fetchLoginTrend(connection, binds, whereClause),
      fetchChecklistCompletion(connection, filters, "db"),
      fetchChecklistCompletion(connection, filters, "backup"),
      fetchDbStatusChecksForReport(connection, filters),
      fetchBackupStatusChecksForReport(connection, filters),
      fetchHandoversForReport(connection, filters),
      fetchSessionsForReport(connection, binds, whereClause),
      fetchShiftCoverage(connection, binds, whereClause)
    ]);

    const unacknowledgedHandovers = pendingHandovers;
    const checklistCompletion = combineCompletion(dbCompletion, backupCompletion);

    return {
      activeDbas,
      dailyAttendance,
      monthlyAttendance,
      avgLoginDurationMin: avgResult,
      lateLogins,
      pendingHandovers,
      unacknowledgedHandovers,
      dbStatusCompletion: dbCompletion,
      backupCompletion,
      checklistCompletion,
      mostActiveDba: mostActiveResult,
      activityTimeline: timelineResult.rows,
      timelineTotal: timelineResult.total,
      loginTrend,
      dbStatusChecks,
      backupStatusChecks,
      handovers,
      sessions,
      coverage
    };
  });
}

async function listActiveShiftSessionsForReport(connection: Connection): Promise<ShiftReportData["activeDbas"]> {
  const result = await connection.execute<DbRow>(
    `SELECT session_id, user_id, username, shift_number, login_at
     FROM app_shift_sessions
     WHERE is_active = 'Y'
     ORDER BY login_at`
  );
  return (result.rows || []).map((row) => ({
    session_id: Number(row.SESSION_ID),
    user_id: Number(row.USER_ID),
    username: String(row.USERNAME),
    shift_number: Number(row.SHIFT_NUMBER) as 1 | 2 | 3 | 4,
    login_at: toIstIsoString(row.LOGIN_AT)
  }));
}

async function fetchDailyAttendance(connection: Connection, binds: BindParameters, whereClause: string): Promise<ShiftReportData["dailyAttendance"]> {
  const result = await connection.execute<DbRow>(
    `SELECT TRUNC(s.shift_date) AS attendance_date,
            COUNT(DISTINCT s.user_id) AS unique_dbas,
            COUNT(*) AS total_logins
     FROM app_shift_sessions s
     ${whereClause}
     GROUP BY TRUNC(s.shift_date)
     ORDER BY TRUNC(s.shift_date) DESC`,
    binds
  );
  return (result.rows || []).map((row) => ({
    attendance_date: toOracleDateString(asDate(row.ATTENDANCE_DATE) || new Date()),
    unique_dbas: Number(row.UNIQUE_DBAS),
    total_logins: Number(row.TOTAL_LOGINS)
  }));
}

async function fetchMonthlyAttendance(connection: Connection, binds: BindParameters, whereClause: string): Promise<ShiftReportData["monthlyAttendance"]> {
  const result = await connection.execute<DbRow>(
    `SELECT TO_CHAR(s.shift_date, 'YYYY-MM') AS month,
            COUNT(DISTINCT s.user_id) AS unique_dbas,
            COUNT(*) AS total_logins
     FROM app_shift_sessions s
     ${whereClause}
     GROUP BY TO_CHAR(s.shift_date, 'YYYY-MM')
     ORDER BY month DESC`,
    binds
  );
  return (result.rows || []).map((row) => ({
    month: String(row.MONTH),
    unique_dbas: Number(row.UNIQUE_DBAS),
    total_logins: Number(row.TOTAL_LOGINS)
  }));
}

async function fetchAvgLoginDuration(connection: Connection, binds: BindParameters, whereClause: string): Promise<number> {
  const closedClause = whereClause
    ? whereClause.replace("WHERE", "WHERE s.status = 'CLOSED' AND s.logout_at IS NOT NULL AND")
    : "WHERE s.status = 'CLOSED' AND s.logout_at IS NOT NULL";
  const result = await connection.execute<DbRow>(
    `SELECT AVG((CAST(s.logout_at AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60) AS avg_min
     FROM app_shift_sessions s
     ${closedClause}`,
    binds
  );
  const row = result.rows?.[0];
  return row && row.AVG_MIN != null ? Math.round(Number(row.AVG_MIN)) : 0;
}

async function fetchMostActiveDba(connection: Connection, binds: BindParameters, whereClause: string): Promise<{ username: string; total_logins: number } | undefined> {
  const result = await connection.execute<DbRow>(
    `SELECT s.username, COUNT(*) AS total_logins
     FROM app_shift_sessions s
     ${whereClause}
     GROUP BY s.username
     ORDER BY total_logins DESC
     FETCH FIRST 1 ROWS ONLY`,
    binds
  );
  const row = result.rows?.[0];
  return row ? { username: String(row.USERNAME), total_logins: Number(row.TOTAL_LOGINS) } : undefined;
}

async function fetchActivityTimeline(
  connection: Connection,
  binds: BindParameters,
  whereClause: string,
  filters: ShiftReportFilters
): Promise<{ rows: ShiftReportData["activityTimeline"]; total: number }> {
  // Apply optional event-type + free-text filters.
  const eventConditions: string[] = [];
  const timelineBinds: Record<string, unknown> = { ...(binds as Record<string, unknown>) };

  if (filters.timelineEvent && filters.timelineEvent !== "all") {
    const evt = filters.timelineEvent;
    if (evt === "login") {
      eventConditions.push("evt.event = 'login'");
    } else if (evt === "logout") {
      eventConditions.push("evt.event = 'logout'");
    } else if (evt === "acknowledge") {
      eventConditions.push("evt.event = 'acknowledge'");
    }
  }
  if (filters.timelineSearch && filters.timelineSearch.trim()) {
    timelineBinds.timelineSearch = `%${filters.timelineSearch.trim().toUpperCase()}%`;
    eventConditions.push("UPPER(evt.username) LIKE :timelineSearch");
  }

  const eventWhere = eventConditions.length ? `WHERE ${eventConditions.join(" AND ")}` : "";

  const unionSql = `
    SELECT 'login' AS event, s.username, s.shift_number, s.login_at AS ts, NULL AS detail
    FROM app_shift_sessions s
    ${whereClause}
    UNION ALL
    SELECT 'logout' AS event, s.username, s.shift_number, s.logout_at AS ts, NULL AS detail
    FROM app_shift_sessions s
    ${whereClause ? whereClause + " AND s.logout_at IS NOT NULL" : "WHERE s.logout_at IS NOT NULL"}
    UNION ALL
    SELECT 'acknowledge' AS event, h.ack_username AS username, h.shift_number, h.ack_at AS ts,
           SUBSTR('Acknowledged ' || h.author_username || '''s handover', 1, 200) AS detail
    FROM app_handovers h
    WHERE h.status = 'ACKNOWLEDGED' AND h.ack_at IS NOT NULL
  `;

  const countResult = await connection.execute<DbRow>(
    `SELECT COUNT(*) AS total FROM (${unionSql}) evt ${eventWhere}`,
    timelineBinds as BindParameters
  );
  const total = Number(countResult.rows?.[0]?.TOTAL ?? 0);

  const page = Math.max(1, filters.timelinePage || 1);
  const pageSize = Math.min(100, Math.max(1, filters.timelinePageSize || 20));
  const offset = (page - 1) * pageSize;

  const pageResult = await connection.execute<DbRow>(
    `SELECT * FROM (${unionSql}) evt ${eventWhere} ORDER BY evt.ts DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
    timelineBinds as BindParameters
  );

  const rows: ShiftReportData["activityTimeline"] = (pageResult.rows || []).map((row) => ({
    event: String(row.EVENT),
    username: String(row.USERNAME || ""),
    shift_number: Number(row.SHIFT_NUMBER || 0),
    timestamp: toIstIsoString(row.TS),
    detail: row.DETAIL ? String(row.DETAIL) : undefined
  }));

  return { rows, total };
}

async function fetchLoginTrend(connection: Connection, binds: BindParameters, whereClause: string): Promise<ShiftReportData["loginTrend"]> {
  const result = await connection.execute<DbRow>(
    `SELECT TRUNC(s.shift_date) AS shift_date, s.shift_number, COUNT(*) AS logins,
            SUM(CASE WHEN s.status = 'CLOSED' AND s.logout_at IS NOT NULL
                     THEN (CAST(s.logout_at AS DATE) - CAST(s.login_at AS DATE)) * 24
                     ELSE 0 END) AS hours
     FROM app_shift_sessions s
     ${whereClause}
     GROUP BY TRUNC(s.shift_date), s.shift_number
     ORDER BY TRUNC(s.shift_date) DESC, s.shift_number`,
    binds
  );
  return (result.rows || []).map((row) => ({
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    shift_number: Number(row.SHIFT_NUMBER),
    logins: Number(row.LOGINS),
    hours: Math.round(Number(row.HOURS ?? 0) * 10) / 10
  }));
}

async function fetchLateLogins(connection: Connection, binds: BindParameters, whereClause: string): Promise<ShiftReportData["lateLogins"]> {
  const shiftStartMinute: Record<number, number> = { 1: 420, 2: 870, 3: 1350 };
  const allLate: ShiftReportData["lateLogins"] = [];

  for (const shiftNumber of [1, 2, 3] as const) {
    const startMinute = shiftStartMinute[shiftNumber];
    const shiftBinds = { ...binds, shiftNumber };
    const shiftCondition = whereClause
      ? whereClause + ` AND s.shift_number = :shiftNumber`
      : `WHERE s.shift_number = :shiftNumber`;
    const result = await connection.execute<DbRow>(
      `SELECT s.session_id, s.username, s.shift_number, s.shift_date, s.login_at,
              (EXTRACT(HOUR FROM CAST(s.login_at AS TIMESTAMP(0))) * 60
               + EXTRACT(MINUTE FROM CAST(s.login_at AS TIMESTAMP(0))) - :startMinute) AS minutes_late
       FROM app_shift_sessions s
       ${shiftCondition}
       ORDER BY s.login_at DESC
       FETCH FIRST 100 ROWS ONLY`,
      { ...shiftBinds, startMinute }
    );
    for (const row of result.rows || []) {
      const minutesLate = Number(row.MINUTES_LATE ?? 0);
      if (minutesLate > 60) {
        allLate.push({
          session_id: Number(row.SESSION_ID),
          username: String(row.USERNAME),
          shift_number: Number(row.SHIFT_NUMBER),
          shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
          login_at: toIstIsoString(row.LOGIN_AT),
          minutes_late: minutesLate
        });
      }
    }
  }

  return allLate.sort((a, b) => (a.login_at < b.login_at ? 1 : -1)).slice(0, 50);
}

function scheduledFinishMinuteSql(alias: string): string {
  return `CASE
            WHEN REGEXP_LIKE(TRIM(${alias}.scheduled_time), '^([0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$')
            THEN TO_NUMBER(SUBSTR(TRIM(${alias}.scheduled_time), 1, INSTR(TRIM(${alias}.scheduled_time), ':') - 1)) * 60
                 + TO_NUMBER(SUBSTR(TRIM(${alias}.scheduled_time), INSTR(TRIM(${alias}.scheduled_time), ':') + 1, 2))
            ELSE NULL
          END`;
}

async function fetchChecklistCompletion(
  connection: Connection,
  filters: ShiftReportFilters,
  type: "db" | "backup"
): Promise<ChecklistCompletion> {
  // Filter scope for the CHECKS tables (no table alias — these are un-aliased).
  const checkBinds: BindParameters = {};
  const checkConditions: string[] = [];
  if (filters.fromDate) {
    checkBinds.fromDate = filters.fromDate;
    checkConditions.push("TRUNC(shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  }
  if (filters.toDate) {
    checkBinds.toDate = filters.toDate;
    checkConditions.push("TRUNC(shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  if (filters.shiftNumber) {
    checkBinds.shiftNumber = filters.shiftNumber;
    checkConditions.push("shift_number = :shiftNumber");
  }
  const checkWhere = checkConditions.length ? `WHERE ${checkConditions.join(" AND ")}` : "";

  // The same date/shift scope applied to app_shift_sessions (alias s) so we can derive
  // the number of (day, shift) opportunities that actually ran in the period.
  const sessBinds: BindParameters = {};
  const sessConditions: string[] = [];
  if (filters.fromDate) {
    sessBinds.fromDate = filters.fromDate;
    sessConditions.push("TRUNC(s.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  }
  if (filters.toDate) {
    sessBinds.toDate = filters.toDate;
    sessConditions.push("TRUNC(s.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  if (filters.shiftNumber) {
    sessBinds.shiftNumber = filters.shiftNumber;
    sessConditions.push("s.shift_number = :shiftNumber");
  }
  const sessWhere = sessConditions.length ? `WHERE ${sessConditions.join(" AND ")}` : "";

  if (type === "backup") {
    const backupCheckBinds: BindParameters = {};
    const backupCheckConditions: string[] = ["b.is_active = 'Y'"];
    if (filters.fromDate) {
      backupCheckBinds.fromDate = filters.fromDate;
      backupCheckConditions.push("TRUNC(c.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
    }
    if (filters.toDate) {
      backupCheckBinds.toDate = filters.toDate;
      backupCheckConditions.push("TRUNC(c.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
    }
    if (filters.shiftNumber) {
      backupCheckBinds.shiftNumber = filters.shiftNumber;
      backupCheckConditions.push("c.shift_number = :shiftNumber");
    }

    const templateFinishMin = scheduledFinishMinuteSql("t");
    const checkFinishMin = scheduledFinishMinuteSql("b");

    const [expectedResult, doneResult] = await Promise.all([
      connection.execute<DbRow>(
        `WITH slots AS (
           SELECT s.shift_number,
                  COUNT(DISTINCT TRUNC(s.shift_date) || '-' || s.shift_number) AS slot_count
           FROM app_shift_sessions s
           ${sessWhere}
           GROUP BY s.shift_number
         ),
         backup_counts AS (
           SELECT responsible_shift AS shift_number, COUNT(*) AS backup_count
           FROM (
             SELECT CASE
                      WHEN finish_min >= 420 AND finish_min <= 930 THEN 1
                      WHEN finish_min > 930 AND finish_min <= 1380 THEN 2
                      ELSE 3
                    END AS responsible_shift
             FROM (
               SELECT ${templateFinishMin} AS finish_min
               FROM app_backup_template t
               WHERE t.is_active = 'Y'
             )
             WHERE finish_min IS NOT NULL
           )
           GROUP BY responsible_shift
         )
         SELECT NVL(SUM(slots.slot_count * NVL(backup_counts.backup_count, 0)), 0) AS total
         FROM slots
         LEFT JOIN backup_counts ON backup_counts.shift_number = slots.shift_number`,
        sessBinds
      ),
      connection.execute<DbRow>(
        `WITH checked_backups AS (
           SELECT DISTINCT c.backup_id, c.shift_number, TRUNC(c.shift_date) AS shift_day,
                  CASE
                    WHEN finish_min >= 420 AND finish_min <= 930 THEN 1
                    WHEN finish_min > 930 AND finish_min <= 1380 THEN 2
                    WHEN finish_min IS NOT NULL THEN 3
                    ELSE NULL
                  END AS responsible_shift
           FROM (
             SELECT c.backup_id, c.shift_number, c.shift_date, ${checkFinishMin} AS finish_min
             FROM app_backup_status_checks c
             JOIN app_backup_template b ON b.backup_id = c.backup_id
             WHERE ${backupCheckConditions.join(" AND ")}
           ) c
         )
         SELECT COUNT(*) AS completed
         FROM checked_backups
         WHERE responsible_shift = shift_number`,
        backupCheckBinds
      )
    ]);

    const expectedTotal = Number(expectedResult.rows?.[0]?.TOTAL ?? 0);
    const completed = Number(doneResult.rows?.[0]?.COMPLETED ?? 0);
    const effectiveCompleted = Math.min(completed, expectedTotal);

    return {
      total: expectedTotal,
      completed: effectiveCompleted,
      completion_pct: expectedTotal > 0 ? Math.round((effectiveCompleted / expectedTotal) * 100) : 0
    };
  }

  const invTable = type === "db" ? "database_inventory" : "app_backup_template";
  const invFilter = type === "db" ? "status = 'active'" : "is_active = 'Y'";
  const checksTable = type === "db" ? "app_db_status_checks" : "app_backup_status_checks";
  const idCol = type === "db" ? "database_id" : "backup_id";

  // Run the three counting queries in parallel so we don't add latency.
  const [invResult, slotsResult, doneResult] = await Promise.all([
    connection.execute<DbRow>(
      `SELECT COUNT(*) AS total FROM ${invTable} WHERE ${invFilter}`,
      {}
    ),
    connection.execute<DbRow>(
      `SELECT COUNT(DISTINCT TRUNC(s.shift_date) || '-' || s.shift_number) AS slots
       FROM app_shift_sessions s
       ${sessWhere}`,
      sessBinds
    ),
    connection.execute<DbRow>(
      `SELECT COUNT(DISTINCT ${idCol} || '-' || shift_number || '-' || TRUNC(shift_date)) AS completed
       FROM ${checksTable}
       ${checkWhere}`,
      checkBinds
    )
  ]);

  // Expected checks = active inventory × (day, shift) opportunities that ran.
  // A (day, shift) where a DBA logged in but no checks were performed counts toward
  // expected (and not completed), so neglected shifts reduce the rate instead of being masked.
  const inventoryCount = Number(invResult.rows?.[0]?.TOTAL ?? 0);
  const shiftDaySlots = Number(slotsResult.rows?.[0]?.SLOTS ?? 0);
  const expectedTotal = inventoryCount * shiftDaySlots;

  // Completed checks are de-duplicated per (item, shift, day) so repeat-checking the
  // same item in the same slot cannot inflate the count.
  const completed = Number(doneResult.rows?.[0]?.COMPLETED ?? 0);

  // Clamp to expected so the rate never exceeds 100% even if checks exist for slots
  // without a tracked session (data inconsistencies).
  const effectiveCompleted = Math.min(completed, expectedTotal);
  const completion_pct = expectedTotal > 0
    ? Math.round((effectiveCompleted / expectedTotal) * 100)
    : 0;

  return {
    total: expectedTotal,
    completed: effectiveCompleted,
    completion_pct
  };
}

function combineCompletion(db: ChecklistCompletion, backup: ChecklistCompletion): ChecklistCompletion {
  const total = db.total + backup.total;
  const completed = db.completed + backup.completed;
  return {
    total,
    completed,
    completion_pct: total > 0 ? Math.round((completed / total) * 100) : 0
  };
}

// ============================================================
// Shift Report — detailed audit datasets (for PDF/Excel export)
// Each row carries the DBA username + timestamp for audit purposes.
// ============================================================

function reportChecklistBinds(filters: ShiftReportFilters): { binds: BindParameters; whereClause: string } {
  const binds: BindParameters = {};
  const conditions: string[] = [];
  if (filters.fromDate) {
    binds.fromDate = filters.fromDate;
    conditions.push("TRUNC(c.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  }
  if (filters.toDate) {
    binds.toDate = filters.toDate;
    conditions.push("TRUNC(c.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  if (filters.shiftNumber) {
    binds.shiftNumber = filters.shiftNumber;
    conditions.push("c.shift_number = :shiftNumber");
  }
  if (filters.dbaUserId) {
    binds.dbaUserId = filters.dbaUserId;
    conditions.push("c.checked_by = :dbaUserId");
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { binds, whereClause };
}

async function fetchDbStatusChecksForReport(
  connection: Connection,
  filters: ShiftReportFilters
): Promise<ShiftReportData["dbStatusChecks"]> {
  const { binds, whereClause } = reportChecklistBinds(filters);
  const result = await connection.execute<DbStatusRow>(
    `SELECT c.check_id, c.database_id, d.database_name, c.shift_number,
            c.shift_date, c.status, c.checked_by, c.checked_username,
            c.checked_at, c.comment_text
     FROM app_db_status_checks c
     JOIN database_inventory d ON d.id = c.database_id
     ${whereClause}
     ORDER BY c.shift_date DESC, UPPER(d.database_name)`,
    binds
  );
  return (result.rows || []).map((row) => mapDbStatusCheck(row as DbStatusRow));
}

async function fetchBackupStatusChecksForReport(
  connection: Connection,
  filters: ShiftReportFilters
): Promise<ShiftReportData["backupStatusChecks"]> {
  const { binds, whereClause } = reportChecklistBinds(filters);
  const result = await connection.execute<BackupStatusRow>(
    `SELECT c.check_id, c.backup_id, c.database_id, d.database_name,
            b.backup_name, c.shift_number, c.shift_date, c.status,
            c.checked_by, c.checked_username, c.checked_at, c.comment_text
     FROM app_backup_status_checks c
     JOIN database_inventory d ON d.id = c.database_id
     JOIN app_backup_template b ON b.backup_id = c.backup_id
     ${whereClause}
     ORDER BY c.shift_date DESC, UPPER(d.database_name), UPPER(b.backup_name)`,
    binds
  );
  return (result.rows || []).map((row) => mapBackupStatusCheck(row as BackupStatusRow));
}

function reportHandoverBinds(filters: ShiftReportFilters): { binds: BindParameters; whereClause: string } {
  const binds: BindParameters = {};
  const conditions: string[] = [];
  if (filters.fromDate) {
    binds.fromDate = filters.fromDate;
    conditions.push("TRUNC(h.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  }
  if (filters.toDate) {
    binds.toDate = filters.toDate;
    conditions.push("TRUNC(h.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  if (filters.shiftNumber) {
    binds.shiftNumber = filters.shiftNumber;
    conditions.push("h.shift_number = :shiftNumber");
  }
  if (filters.dbaUserId) {
    binds.dbaUserId = filters.dbaUserId;
    conditions.push("(h.author_user_id = :dbaUserId OR h.ack_user_id = :dbaUserId)");
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { binds, whereClause };
}

async function fetchHandoversForReport(
  connection: Connection,
  filters: ShiftReportFilters
): Promise<ShiftReportData["handovers"]> {
  const { binds, whereClause } = reportHandoverBinds(filters);
  const result = await connection.execute<HandoverRow>(
    `SELECT handover_id, session_id, author_user_id, author_username,
            shift_number, shift_date, handover_text, status,
            ack_user_id, ack_username, ack_at, override_reason, is_override,
            created_at, updated_at
     FROM app_handovers h
     ${whereClause}
     ORDER BY h.created_at DESC
     FETCH FIRST 500 ROWS ONLY`,
    binds
  );
  return (result.rows || []).map((row) => mapHandover(row as HandoverRow));
}

async function fetchSessionsForReport(
  connection: Connection,
  binds: BindParameters,
  whereClause: string
): Promise<ShiftReportData["sessions"]> {
  const result = await connection.execute<DbRow>(
    `SELECT s.session_id, s.user_id, s.username, s.shift_number, s.shift_date,
            s.login_at, s.logout_at, s.status, s.is_active,
            CASE WHEN s.logout_at IS NOT NULL
              THEN ROUND((CAST(s.logout_at AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60)
              ELSE NULL END AS duration_min
     FROM app_shift_sessions s
     ${whereClause}
     ORDER BY s.login_at DESC
     FETCH FIRST 500 ROWS ONLY`,
    binds
  );
  return (result.rows || []).map((row) => ({
    session_id: Number(row.SESSION_ID),
    user_id: Number(row.USER_ID),
    username: String(row.USERNAME),
    shift_number: Number(row.SHIFT_NUMBER),
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    login_at: toIstIsoString(row.LOGIN_AT),
    logout_at: row.LOGOUT_AT ? toIstIsoString(row.LOGOUT_AT) : undefined,
    status: String(row.STATUS || ""),
    is_active: String(row.IS_ACTIVE || "N") === "Y",
    duration_min: row.DURATION_MIN != null ? Math.round(Number(row.DURATION_MIN)) : undefined
  }));
}

async function fetchShiftCoverage(
  connection: Connection,
  binds: BindParameters,
  whereClause: string
): Promise<ShiftReportData["coverage"]> {
  // Per shift-per-day coverage. Expected DBAs is derived from distinct
  // DBAs who have ever logged into that shift (rolling baseline). When no
  // baseline exists, fall back to 1 so coverage is non-zero once a DBA logs in.
  const result = await connection.execute<DbRow>(
    `SELECT TRUNC(s.shift_date) AS shift_date,
            s.shift_number,
            COUNT(DISTINCT s.user_id) AS actual_dbas,
            COUNT(DISTINCT s.user_id) AS baseline,
            SUM(CASE WHEN (EXTRACT(HOUR FROM CAST(s.login_at AS TIMESTAMP(0))) * 60
                        + EXTRACT(MINUTE FROM CAST(s.login_at AS TIMESTAMP(0)))
                        - CASE s.shift_number WHEN 1 THEN 420 WHEN 2 THEN 870 WHEN 3 THEN 1350 ELSE 0 END) > 60
                     THEN 1 ELSE 0 END) AS late_logins
     FROM app_shift_sessions s
     ${whereClause}
     GROUP BY TRUNC(s.shift_date), s.shift_number
     ORDER BY TRUNC(s.shift_date) DESC, s.shift_number`,
    binds
  );
  return (result.rows || []).map((row) => {
    const actual = Number(row.ACTUAL_DBAS ?? 0);
    const expected = Math.max(1, Number(row.BASELINE ?? 0));
    return {
      shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
      shift_number: Number(row.SHIFT_NUMBER),
      expected_dbas: expected,
      actual_dbas: actual,
      coverage_pct: expected > 0 ? Math.min(100, Math.round((actual / expected) * 100)) : 0,
      late_logins: Number(row.LATE_LOGINS ?? 0)
    };
  });
}

// ============================================================
// User Profile / Preferences — theme toggling
// ============================================================
//
// The app_user_preferences table stores per-user UI preferences.  Today the
// only persisted value is theme_preference ('light' | 'dark'), chosen from
// the navbar theme toggle.  The functions below are defensive: if the table
// has not been created yet (ORA-00942) they fall back to 'dark' so the rest
// of the app keeps working.

function mapThemePreference(value: unknown): ThemePreference {
  const normalized = String(value || "dark").trim().toLowerCase();
  if (normalized === "light") return "light";
  return "dark";
}

/** Read a user's stored theme preference. Returns 'dark' when no row exists. */
export async function getUserThemePreference(userId: number): Promise<ThemePreference> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT theme_preference
         FROM app_user_preferences
         WHERE user_id = :userId`,
        { userId }
      );
      const row = result.rows?.[0];
      if (!row) return "dark";
      return mapThemePreference(row.THEME_PREFERENCE);
    } catch (error) {
      // Table missing (schema not migrated yet) — degrade gracefully.
      if (isOracleMissingTableError(error)) return "dark";
      throw error;
    }
  });
}

/** Insert or update a user's theme preference (idempotent MERGE). */
export async function upsertUserThemePreference(
  userId: number,
  theme: ThemePreference
): Promise<void> {
  const normalized: ThemePreference = theme === "light" ? "light" : "dark";
  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `MERGE INTO app_user_preferences dst
         USING (SELECT :userId AS user_id FROM dual) src
         ON (dst.user_id = src.user_id)
         WHEN MATCHED THEN
           UPDATE SET dst.theme_preference = :theme
         WHEN NOT MATCHED THEN
           INSERT (user_id, theme_preference)
           VALUES (src.user_id, :theme2)`,
        { userId, theme: normalized, theme2: normalized },
        { autoCommit: true }
      );
    } catch (error) {
      // Table missing — swallow so the UI toggle still works locally.
      if (isOracleMissingTableError(error)) return;
      throw error;
    }
  });
}


