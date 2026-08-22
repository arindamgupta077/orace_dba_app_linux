import "server-only";

import oracledb, { type BindParameters, type Connection } from "oracledb";

import {
  DEFAULT_SECURITY_POSTURE_POLICY,
  type SecurityPosturePolicyConfig
} from "@/lib/security-posture-policy";
import { getServerEnv } from "@/lib/server/env";
import { withOracleConnection } from "@/lib/server/oracle";
import { generatePasswordSalt, generateSessionToken, hashPassword, hashSessionToken, normalizeUsername, sha256Hex } from "@/lib/server/security";
import { getBackupResponsibleShift } from "@/lib/backup-shifts";
import { checkShiftMinDuration, getActiveShifts, getSelectableShifts, getShiftStartDate, toOracleDateString } from "@/lib/server/shift-utils";
import { stripHtmlText } from "@/lib/utils";
import type {
  AlertNotification,
  AlertNotificationSeverity,
  AlertNotificationStatus,
  AlertNotificationType,
  AppUser,
  AppUserRole,
  AuditLogItem,
  AuditLogRetentionPolicyConfig,
  AuditLogStats,
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
  NotificationPayload,
  RequestHistoryItem,
  ShiftReportData,
  ShiftReportFilters,
  ShiftLogoutChecklistReadiness,
  ShiftSession,
  SecurityPostureProcessingStatus,
  SecurityPostureReport,
  ThemePreference,
  UserSession,
  ApprovalRequest,
  ApprovalHistoryEvent,
  ApprovalRequestStatus,
  ApprovalHistoryEventType,
  ApprovalRiskLevel,
  ExpdpParams,
  ExpdpTemplate,
  ImpdpParams,
  ImpdpTemplate,
  DataPumpJob,
  DataPumpJobStatus,
  DataPumpOperation,
  RmanJob,
  RmanJobStatus,
  MonitoringIncident,
  MonitoringIncidentStatus,
  AlertClearanceStatus,
  RebootHistoryItem,
  RebootEventType
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
  absoluteExpiresAt: string;
  lastActivityAt: string;
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
    psid: row.PSID ? String(row.PSID) : null,
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
  const raw = String(value || "").trim();
  if (raw === "RAC & Datagaurd" || raw === "RAC & Dataguard") return "RAC & Datagaurd";
  if (raw === "Active Dataguard") return "Active Dataguard";
  if (raw === "Dataguard") return "Dataguard";
  if (raw === "RAC") return "RAC";
  if (raw === "Standalone") return "Standalone";

  const normalized = raw
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[\s_-]+/g, "_");
  if (normalized === "rac") return "RAC";
  if (normalized === "dataguard" || normalized === "data_guard") return "Dataguard";
  if (normalized === "active_dataguard" || normalized === "active_data_guard") return "Active Dataguard";
  if (
    normalized === "rac_datagaurd" ||
    normalized === "rac_dataguard" ||
    normalized === "rac_and_datagaurd" ||
    normalized === "rac_and_dataguard"
  ) {
    return "RAC & Datagaurd";
  }
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

function normalizeEnableAccess(value: unknown): boolean {
  return String(value ?? "Y").trim().toUpperCase() !== "N";
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
    incident_status: row.INCIDENT_STATUS ? String(row.INCIDENT_STATUS).trim().toUpperCase() : undefined,
    latest_reboot_event: row.LATEST_EVENT_TYPE ? String(row.LATEST_EVENT_TYPE).trim().toUpperCase() : undefined,
    server_name: row.SERVER_NAME ? String(row.SERVER_NAME) : undefined,
    server_ip: row.SERVER_IP ? String(row.SERVER_IP) : undefined,
    zone: row.ZONE ? String(row.ZONE) : undefined,
    server_type: normalizeServerType(row.SERVER_TYPE),
    db_version: row.DB_VERSION ? String(row.DB_VERSION) : undefined,
    db_edition: row.DB_EDITION ? String(row.DB_EDITION) : undefined,
    database_instance: row.DATABASE_INSTANCE ? String(row.DATABASE_INSTANCE) : undefined,
    enable_access: normalizeEnableAccess(row.ENABLE_ACCESS),
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
  const databaseInstance = String(input.database_instance || "").trim();
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
  if (!databaseInstance || databaseInstance.length > 128) {
    throw new Error("Database instance is required and must be 128 characters or fewer.");
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
    databaseInstance,
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

function isOracleMissingColumnError(error: unknown) {
  return error instanceof Error && error.message.includes("ORA-00904");
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
    read: String(row.IS_READ || "N").toUpperCase() === "Y",
    readBy: row.READ_BY ? String(row.READ_BY) : undefined,
    readAt: row.READ_AT ? toIstIsoString(row.READ_AT) : undefined,
    read_by: row.READ_BY ? String(row.READ_BY) : undefined,
    read_at: row.READ_AT ? toIstIsoString(row.READ_AT) : undefined,
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

export interface OutdatedSecurityPostureNotification {
  reportId: number;
  databaseName: string;
  databaseOwnerName: string;
  databaseOwnerEmail: string;
  lastUploadDate: string;
}

/**
 * Atomically claims overdue active reports that are due for another n8n notification.
 * Claims expire after five minutes so a terminated app process cannot block a retry.
 */
export async function claimOutdatedSecurityPostureNotifications(): Promise<OutdatedSecurityPostureNotification[]> {
  const policy = await getSecurityPosturePolicyConfig().catch(() => memorySecurityPosturePolicy);
  const outdatedAfterMin = policy.outdatedAfterMinutes;
  const maxSends = policy.outdatedWebhookMaxSends;

  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT r.report_id, d.database_name, u.username AS owner_name,
              u.email AS owner_email, r.uploaded_at
       FROM app_security_posture_reports r
       JOIN database_inventory d ON d.id = r.database_id
       LEFT JOIN app_users u ON u.user_id = d.owner_id
       WHERE r.is_active = 'Y'
         AND r.uploaded_at < SYSTIMESTAMP - NUMTODSINTERVAL(${outdatedAfterMin}, 'MINUTE')
         AND NVL(r.outdated_webhook_send_count, 0) < ${maxSends}
         AND (r.outdated_webhook_next_send_at IS NULL
              OR r.outdated_webhook_next_send_at <= SYSTIMESTAMP)
         AND (r.outdated_webhook_claimed_at IS NULL
              OR r.outdated_webhook_claimed_at < SYSTIMESTAMP - INTERVAL '5' MINUTE)`,
    );

    const notifications: OutdatedSecurityPostureNotification[] = [];
    for (const row of result.rows || []) {
      const reportId = Number(row.REPORT_ID);
      const claimed = await connection.execute(
        `UPDATE app_security_posture_reports
         SET outdated_webhook_claimed_at = SYSTIMESTAMP
         WHERE report_id = :reportId
           AND is_active = 'Y'
           AND outdated_webhook_sent_at IS NULL
           AND (outdated_webhook_claimed_at IS NULL
                OR outdated_webhook_claimed_at < SYSTIMESTAMP - INTERVAL '5' MINUTE)`,
        { reportId },
        { autoCommit: true }
      );
      if (!claimed.rowsAffected) continue;
      notifications.push({
        reportId,
        databaseName: String(row.DATABASE_NAME || ""),
        databaseOwnerName: String(row.OWNER_NAME || ""),
        databaseOwnerEmail: String(row.OWNER_EMAIL || ""),
        lastUploadDate: toIsoString(row.UPLOADED_AT)
      });
    }
    return notifications;
  });
}

export async function markSecurityPostureOutdatedWebhookSent(reportId: number) {
  const policy = await getSecurityPosturePolicyConfig().catch(() => memorySecurityPosturePolicy);
  const maxSends = policy.outdatedWebhookMaxSends;
  const intervalHours = policy.outdatedWebhookIntervalHours;

  return executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_security_posture_reports
       SET outdated_webhook_send_count = NVL(outdated_webhook_send_count, 0) + 1,
           outdated_webhook_next_send_at = CASE
             WHEN NVL(outdated_webhook_send_count, 0) + 1 < ${maxSends}
               THEN SYSTIMESTAMP + NUMTODSINTERVAL(${intervalHours}, 'HOUR')
             ELSE NULL
           END,
           outdated_webhook_sent_at = SYSTIMESTAMP,
           outdated_webhook_claimed_at = NULL
       WHERE report_id = :reportId`,
      { reportId },
      { autoCommit: true }
    );
  });
}

export async function releaseSecurityPostureOutdatedWebhookClaim(reportId: number) {
  const policy = await getSecurityPosturePolicyConfig().catch(() => memorySecurityPosturePolicy);
  const maxSends = policy.outdatedWebhookMaxSends;

  return executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_security_posture_reports
       SET outdated_webhook_claimed_at = NULL
       WHERE report_id = :reportId
         AND NVL(outdated_webhook_send_count, 0) < ${maxSends}`,
      { reportId },
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
  psid: string;
  role: AppUserRole;
  initialPassword: string;
  isActive?: boolean;
}

export interface UpdateAppUserInput {
  userId: number;
  username: string;
  email: string;
  psid?: string | null;
  role: AppUserRole;
  isActive: boolean;
}

function normalizeAppUserInput(
  input: { username: string; email: string; role: string; psid?: string | null },
  isCreate = false
) {
  const username = normalizeUsername(input.username);
  const email = input.email.trim().toLowerCase();
  const role = input.role.trim().toLowerCase();
  const psid = input.psid !== undefined && input.psid !== null ? input.psid.trim() : "";

  if (!username || username.length > 128) {
    throw new Error("Username is required and must be 128 characters or fewer.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error("Enter a valid email address.");
  }
  if (isCreate && !psid) {
    throw new Error("PSID is a mandatory field for creating a new user.");
  }
  if (psid && psid.length > 64) {
    throw new Error("PSID must be 64 characters or fewer.");
  }
  if (!isAppUserRole(role)) {
    throw new Error("Invalid role.");
  }

  return { username, email, role, psid: psid || null };
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
         psid,
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
       (
         SELECT i.incident_status
         FROM app_db_monitoring_incidents i
         WHERE UPPER(i.db_name) = UPPER(d.database_name)
         ORDER BY i.last_reported DESC, i.created_at DESC
         FETCH FIRST 1 ROWS ONLY
       ) AS incident_status,
       (
         SELECT h.event_type
         FROM db_reboot_history h
         WHERE UPPER(h.db_name) = UPPER(d.database_name)
         ORDER BY h.created_at DESC
         FETCH FIRST 1 ROWS ONLY
       ) AS latest_event_type,
       d.server_type,
       d.db_version,
       d.db_edition,
       d.database_instance,
       d.enable_access,
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

export async function listDatabaseInventory(input: { role?: UserRole; userId?: number; selectorOnly?: boolean; logicalOnly?: boolean; prodOnly?: boolean } = {}): Promise<DatabaseInventoryItem[]> {
  return executeOne(async (connection) => {
    const binds: BindParameters = {};
    const filters: string[] = [];
    if (input.role === "client" && input.userId) {
      filters.push("d.owner_id = :ownerId");
      binds.ownerId = input.userId;
    }
    if (input.selectorOnly && (input.role === "dba_admin" || input.role === "client")) {
      filters.push("d.enable_access = 'Y'");
    }
    if (input.selectorOnly) {
      filters.push("LOWER(d.status) NOT IN ('decommissioned', 'decomissioned', 'inactive')");
    }
    if (input.prodOnly) {
      filters.push("d.environment_label = 'PROD'");
    }
    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const policy = await getSecurityPosturePolicyConfig().catch(() => memorySecurityPosturePolicy);
    const outdatedAfterMin = policy.outdatedAfterMinutes;

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
             AND r.uploaded_at < SYSTIMESTAMP - NUMTODSINTERVAL(${outdatedAfterMin}, 'MINUTE')
         ) THEN 'Y' ELSE 'N' END AS security_posture_outdated,
         (
           SELECT i.incident_status
           FROM app_db_monitoring_incidents i
           WHERE UPPER(i.db_name) = UPPER(d.database_name)
           ORDER BY i.last_reported DESC, i.created_at DESC
           FETCH FIRST 1 ROWS ONLY
         ) AS incident_status,
         (
           SELECT h.event_type
           FROM db_reboot_history h
           WHERE UPPER(h.db_name) = UPPER(d.database_name)
           ORDER BY h.created_at DESC
           FETCH FIRST 1 ROWS ONLY
         ) AS latest_event_type,
         d.server_type,
         d.db_version,
         d.db_edition,
         d.database_instance,
         d.enable_access,
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
       ${whereClause}
       ORDER BY d.division, UPPER(d.database_name), d.id`,
      binds
    );

    const databases = (result.rows || []).map(mapDatabaseInventoryRow);
    if (!input.logicalOnly && !input.selectorOnly) return databases;

    // Inventory rows represent RAC instances. Everywhere outside the inventory
    // page, operate at the logical-database level and retain one deterministic
    // representative (the lowest inventory ID) for each database name.
    const representatives = new Map<string, DatabaseInventoryItem>();
    for (const database of databases) {
      const key = database.database_name.trim().toUpperCase();
      const existing = representatives.get(key);
      if (!existing || database.id < existing.id) representatives.set(key, database);
    }
    return databases.filter((database) => {
      const key = database.database_name.trim().toUpperCase();
      return representatives.get(key)?.id === database.id;
    });
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

export async function getDatabaseTargetByName(
  name: string,
  input: { role?: UserRole; userId?: number; enforceAccess?: boolean } = {}
): Promise<DatabaseTarget | undefined> {
  const normalizedName = name.trim();
  if (!normalizedName) return undefined;

  return executeOne(async (connection) => {
    const binds: BindParameters = { name: normalizedName };
    const filters = ["UPPER(d.database_name) = UPPER(:name)"];
    if (input.enforceAccess && (input.role === "dba_admin" || input.role === "client")) {
      filters.push("d.enable_access = 'Y'");
    }
    if (input.enforceAccess && input.role === "client" && input.userId) {
      filters.push("d.owner_id = :ownerId");
      binds.ownerId = input.userId;
    }
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
        (
          SELECT i.incident_status
          FROM app_db_monitoring_incidents i
          WHERE UPPER(i.db_name) = UPPER(d.database_name)
          ORDER BY i.last_reported DESC, i.created_at DESC
          FETCH FIRST 1 ROWS ONLY
        ) AS incident_status,
        (
          SELECT h.event_type
          FROM db_reboot_history h
          WHERE UPPER(h.db_name) = UPPER(d.database_name)
          ORDER BY h.created_at DESC
          FETCH FIRST 1 ROWS ONLY
        ) AS latest_event_type,
        d.server_type,
        d.db_version,
        d.db_edition,
        d.database_instance,
        d.enable_access,
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
      WHERE ${filters.join(" AND ")}
      FETCH FIRST 1 ROW ONLY`,
      binds
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
           AND UPPER(database_instance) = UPPER(:databaseInstance)
         FETCH FIRST 1 ROW ONLY`,
        { databaseName: normalized.databaseName, databaseInstance: normalized.databaseInstance }
      );
      if (duplicate.rows?.length) {
        throw new Error("A database with that name and instance already exists.");
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
           database_instance,
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
           :databaseInstance,
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
          databaseInstance: normalized.databaseInstance || null,
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
           AND UPPER(database_instance) = UPPER(:databaseInstance)
         FETCH FIRST 1 ROW ONLY`,
        { id, databaseName: normalized.databaseName, databaseInstance: normalized.databaseInstance }
      );
      if (duplicate.rows?.length) {
        throw new Error("Another database already has that name and instance.");
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
             database_instance = :databaseInstance,
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
          databaseInstance: normalized.databaseInstance || null,
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
        `DELETE FROM app_db_status_checks
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
  const normalized = normalizeAppUserInput(input, true);
  if (input.initialPassword.length < 8 || input.initialPassword.length > 128) {
    throw new Error("Initial password must be between 8 and 128 characters.");
  }

  const passwordSalt = generatePasswordSalt();
  const passwordHash = hashPassword(input.initialPassword, passwordSalt);

  return executeOne(async (connection) => {
    const duplicate = await connection.execute<DbRow>(
      `SELECT username, email
       FROM app_users
       WHERE UPPER(TRIM(username)) = :username
          OR LOWER(TRIM(email)) = :email
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
         psid,
         password_salt,
         password_hash,
         role,
         is_active,
         must_change_password,
         failed_login_count
       ) VALUES (
         :username,
         :email,
         :psid,
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
        psid: normalized.psid,
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
         psid,
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
  const normalized = normalizeAppUserInput(input, false);

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
      `SELECT user_id, username, email
       FROM app_users
       WHERE user_id <> :userId
         AND (UPPER(TRIM(username)) = :username OR LOWER(TRIM(email)) = :email)
       FETCH FIRST 1 ROW ONLY`,
      { userId: input.userId, username: normalized.username, email: normalized.email }
    );
    if (duplicate.rows?.length) {
      const match = duplicate.rows[0];
      const matchId = match.USER_ID ?? match.user_id;
      const matchName = match.USERNAME ?? match.username;
      throw new Error(`Another user (ID: ${matchId}, Name: ${matchName}) already has that username or email.`);
    }

    await connection.execute(
      `UPDATE app_users
       SET username = :username,
           email = :email,
           psid = :psid,
           role = :role,
           is_active = :isActive,
           locked_until = CASE WHEN :isActive = 'Y' THEN locked_until ELSE NULL END,
           failed_login_count = CASE WHEN :isActive = 'Y' THEN failed_login_count ELSE 0 END
       WHERE user_id = :userId`,
      {
        username: normalized.username,
        email: normalized.email,
        psid: normalized.psid,
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
         psid,
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
  const { rememberSessionTtlDays, sessionTtlHours, sessionAbsoluteTimeoutHours } = getServerEnv();
  const rawToken = generateSessionToken();
  const hashedToken = hashSessionToken(rawToken);

  // Compute the absolute hard cap — always based on the configured absolute timeout.
  const absoluteExpiresAt = new Date();
  absoluteExpiresAt.setHours(absoluteExpiresAt.getHours() + sessionAbsoluteTimeoutHours);

  // The "soft" expires_at is the lesser of the legacy TTL and the absolute cap.
  const expiresAt = new Date();
  if (rememberSession) {
    expiresAt.setDate(expiresAt.getDate() + rememberSessionTtlDays);
  } else {
    expiresAt.setHours(expiresAt.getHours() + sessionTtlHours);
  }
  // Cap expires_at at the absolute limit — session can never outlive the hard cap.
  if (expiresAt.getTime() > absoluteExpiresAt.getTime()) {
    expiresAt.setTime(absoluteExpiresAt.getTime());
  }

  await executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO app_sessions (
         session_token_hash,
         user_id,
         auth_mode,
         expires_at,
         ip_address,
         user_agent,
         absolute_expires_at,
         last_activity_at
       ) VALUES (
         :sessionTokenHash,
         :userId,
         :authMode,
         :expiresAt,
         :ipAddress,
         :userAgent,
         :absoluteExpiresAt,
         SYSTIMESTAMP
       )`,
      {
        sessionTokenHash: hashedToken,
        userId,
        authMode,
        expiresAt,
        ipAddress: ipAddress ? ipAddress.slice(0, 64) : null,
        userAgent: userAgent ? userAgent.slice(0, 512) : null,
        absoluteExpiresAt
      },
      { autoCommit: true }
    );
  });

  return {
    rawToken,
    expiresAt: expiresAt.toISOString(),
    absoluteExpiresAt: absoluteExpiresAt.toISOString()
  };
}

export async function getSessionByToken(sessionToken: string): Promise<SessionRecord | null> {
  if (!sessionToken) return null;

  const { sessionInactivityTimeoutMinutes } = getServerEnv();
  const tokenHash = hashSessionToken(sessionToken);
  return executeOne(async (connection) => {
    // Try the joined query first (preferences table present).  If the
    // app_user_preferences table hasn't been created yet (ORA-00942),
    // fall back to the base session query and default the theme to 'dark'.
    //
    // Session validity conditions:
    //   1. Not revoked
    //   2. Not past expires_at (legacy / soft expiry)
    //   3. Not past absolute_expires_at (hard 24-hour cap)
    //   4. Not idle longer than inactivity timeout
    //   5. User is active
    const inactivityFilter = `AND (s.last_activity_at IS NULL OR s.last_activity_at > SYSTIMESTAMP - INTERVAL '${Math.round(sessionInactivityTimeoutMinutes)}' MINUTE)`;
    const absoluteFilter = `AND (s.absolute_expires_at IS NULL OR s.absolute_expires_at > SYSTIMESTAMP)`;

    let result;
    let preferencesJoined = true;
    try {
      result = await connection.execute<DbRow>(
        `SELECT
            s.user_id,
            s.auth_mode,
            s.expires_at,
            s.absolute_expires_at,
            s.last_activity_at,
            u.username,
            u.role,
            p.theme_preference
          FROM app_sessions s
          JOIN app_users u ON u.user_id = s.user_id
          LEFT JOIN app_user_preferences p ON p.user_id = u.user_id
          WHERE s.session_token_hash = :sessionTokenHash
            AND s.revoked_at IS NULL
            AND s.expires_at > SYSTIMESTAMP
            ${absoluteFilter}
            ${inactivityFilter}
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
            s.absolute_expires_at,
            s.last_activity_at,
            u.username,
            u.role
          FROM app_sessions s
          JOIN app_users u ON u.user_id = s.user_id
          WHERE s.session_token_hash = :sessionTokenHash
            AND s.revoked_at IS NULL
            AND s.expires_at > SYSTIMESTAMP
            ${absoluteFilter}
            ${inactivityFilter}
            AND u.is_active = 'Y'`,
        { sessionTokenHash: tokenHash }
      );
    }

    const row = result.rows?.[0];
    if (!row) return null;

    const userId = Number(row.USER_ID);
    const expiresAt = toIsoString(row.EXPIRES_AT);
    const absoluteExpiresAt = row.ABSOLUTE_EXPIRES_AT ? toIsoString(row.ABSOLUTE_EXPIRES_AT) : expiresAt;
    const lastActivityAt = row.LAST_ACTIVITY_AT ? toIsoString(row.LAST_ACTIVITY_AT) : new Date().toISOString();

    return {
      userId,
      expiresAt,
      absoluteExpiresAt,
      lastActivityAt,
      user: {
        username: String(row.USERNAME),
        userId,
        role: mapUserRole(row.ROLE),
        authMode: mapAuthMode(),
        themePreference: preferencesJoined ? mapThemePreference(row.THEME_PREFERENCE) : "light"
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

/**
 * Update last_activity_at for a session (by hashed token).
 * Only updates if the session is still valid and not past the absolute cap.
 * Returns true if the row was updated.
 */
export async function touchSessionActivity(sessionTokenHash: string): Promise<boolean> {
  const result = await executeOne(async (connection) => {
    return connection.execute(
      `UPDATE app_sessions
       SET last_activity_at = SYSTIMESTAMP
       WHERE session_token_hash = :tokenHash
         AND revoked_at IS NULL
         AND (absolute_expires_at IS NULL OR absolute_expires_at > SYSTIMESTAMP)`,
      { tokenHash: sessionTokenHash },
      { autoCommit: true }
    );
  });
  return ((result as { rowsAffected?: number })?.rowsAffected ?? 0) > 0;
}

const APP_AUDITED_ACTIONS = new Set<string>([
  "disk_utilization",
  "alert_log",
  "Tablespace Alert",
  "approval_workflow",
  "expdp",
  "impdp",
  "db_monitoring",
  "test_connection",
  "dashboard_schedule",
  "APP_DASHBOARD_SCHEDULES",
  "schedule_auto_refresh",
  "auto_refresh_schedule",
  "configure_audit_retention",
  "purge_audit_logs",
  "configure_performance_trends",
  "configure_security_posture_policy"
]);
const APP_AUDITED_STATUSES = new Set<string>([
  "pending_approval",
  "acknowledged",
  "approved",
  "rejected",
  "completed",
  "failed",
  "error",
  "open",
  "resolved",
  // Data Pump lifecycle states. "running"/"initiated" capture the start of
  // an EXPDP/IMPDP job; "success" captures a clean completion (the callback
  // route records the final state).
  "success",
  "running",
  "initiated",
  // Database monitoring lifecycle states.
  "down",
  "up",
  "duplicate",
  "info"
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
  // states are skipped â€” they represent alert creation/refresh, not a
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

  // Data Pump job dedup: when both /api/dba/actions (sync n8n completion)
  // AND /api/datapump/callback (async n8n callback) record the success/error
  // for the same job_id, suppress the second insert so the audit page shows
  // one canonical completion row per job. Start ("initiated") rows remain
  // unaffected because their status is not success/error/completed.
  // (The trigger also fires for "running" but that is filtered out above.)
  const jobId = input.metadata?.job_id;
  if (
    jobId &&
    typeof jobId === "string" &&
    (statusValue === "success" || statusValue === "completed" || statusValue === "failed" || statusValue === "error")
  ) {
    try {
      const exists = await executeOne(async (connection) => {
        // Exclude the "initiated" start row when checking for an existing
        // completion. The start audit also carries job_id in its metadata, so
        // we must filter to non-start statuses (success/error/completed/
        // failed) — otherwise the dedup looks at the start row, believes the
        // completion has already been recorded, and skips the completion
        // audit entirely.
        const checkResult = await connection.execute<DbRow>(
          `SELECT COUNT(*) AS count FROM app_audit_logs
           WHERE action = :action
             AND (db_name = :dbName OR (db_name IS NULL AND :dbName IS NULL))
             AND UPPER(status) IN ('SUCCESS','ERROR','COMPLETED','FAILED')
             AND DBMS_LOB.INSTR(metadata_json, :jobIdStr) > 0`,
          {
            action: safeAction,
            dbName,
            jobIdStr: `"job_id":"${jobId}"`
          }
        );
        return Number(checkResult.rows?.[0]?.COUNT || 0) > 0;
      });

      if (exists) {
        console.log(`[Audit Log Duplicate Avoided] job_id: ${jobId}, action: ${safeAction}`);
        return;
      }
    } catch (checkError) {
      console.error(`[Audit Log Duplicate Check Failed (job_id)]`, checkError);
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

/* ── Change Audit Log (field-level change tracking) ──────────────────── */

export type ChangeAuditEntityType = "DATABASE_INVENTORY" | "APP_USER";
export type ChangeAuditAction = "CREATE" | "UPDATE" | "DELETE" | "TOGGLE_STATUS";

export interface ChangeAuditEntry {
  changeId: number;
  entityType: ChangeAuditEntityType;
  entityId: number;
  entityName: string;
  action: ChangeAuditAction;
  changedBy: string;
  changedAt: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  changeSummary?: string;
}

/**
 * Insert one or more rows into APP_CHANGE_AUDIT_LOG.
 *
 * For UPDATE actions, pass `changes` — an array of field-level diffs.
 * For CREATE / DELETE / TOGGLE_STATUS, a single summary row is inserted.
 */
export async function insertChangeAuditLog(input: {
  entityType: ChangeAuditEntityType;
  entityId: number;
  entityName: string;
  action: ChangeAuditAction;
  changedBy: string;
  changes?: Array<{ field: string; oldValue?: string; newValue?: string }>;
  changeSummary?: string;
}): Promise<void> {
  try {
    await executeOne(async (connection) => {
      if (input.action === "UPDATE" && input.changes?.length) {
        // One row per changed field
        for (const change of input.changes) {
          await connection.execute(
            `INSERT INTO app_change_audit_log (
               entity_type, entity_id, entity_name, action, changed_by,
               field_name, old_value, new_value, change_summary
             ) VALUES (
               :entityType, :entityId, :entityName, :action, :changedBy,
               :fieldName, :oldValue, :newValue, :changeSummary
             )`,
            {
              entityType: input.entityType,
              entityId: input.entityId,
              entityName: String(input.entityName || "").slice(0, 256),
              action: input.action,
              changedBy: String(input.changedBy || "").slice(0, 128),
              fieldName: String(change.field || "").slice(0, 64),
              oldValue: change.oldValue != null ? String(change.oldValue).slice(0, 4000) : null,
              newValue: change.newValue != null ? String(change.newValue).slice(0, 4000) : null,
              changeSummary: `${change.field}: "${change.oldValue ?? ""}" → "${change.newValue ?? ""}"`
            },
            { autoCommit: false }
          );
        }
        await connection.commit();
      } else {
        // Single summary row for CREATE / DELETE / TOGGLE_STATUS
        const summary =
          input.changeSummary ||
          `${input.action} ${input.entityType.toLowerCase().replace("_", " ")} "${input.entityName}"`;
        await connection.execute(
          `INSERT INTO app_change_audit_log (
             entity_type, entity_id, entity_name, action, changed_by,
             field_name, old_value, new_value, change_summary
           ) VALUES (
             :entityType, :entityId, :entityName, :action, :changedBy,
             NULL, :oldValue, :newValue, :changeSummary
           )`,
          {
            entityType: input.entityType,
            entityId: input.entityId,
            entityName: String(input.entityName || "").slice(0, 256),
            action: input.action,
            changedBy: String(input.changedBy || "").slice(0, 128),
            oldValue: input.action === "DELETE" ? input.entityName : null,
            newValue: input.action === "CREATE" ? input.entityName : null,
            changeSummary: summary.slice(0, 4000)
          },
          { autoCommit: true }
        );
      }
    });
  } catch (error) {
    console.error(
      `[Change Audit Log Insert Failed] entity: ${input.entityType}/${input.entityId}, action: ${input.action}, error:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Query APP_CHANGE_AUDIT_LOG filtered by entity type and optionally entity id.
 */
export async function listChangeAuditLogs(
  entityType: ChangeAuditEntityType,
  limit: number = 500
): Promise<ChangeAuditEntry[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10000);

  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT
           change_id, entity_type, entity_id, entity_name, action,
           changed_by, changed_at, field_name, old_value, new_value,
           change_summary
         FROM app_change_audit_log
         WHERE entity_type = :entityType
         ORDER BY changed_at DESC, change_id DESC
         FETCH FIRST :lim ROWS ONLY`,
        { entityType, lim: safeLimit }
      );

      return (result.rows || []).map((row) => ({
        changeId: Number(row.CHANGE_ID),
        entityType: String(row.ENTITY_TYPE) as ChangeAuditEntityType,
        entityId: Number(row.ENTITY_ID),
        entityName: String(row.ENTITY_NAME || ""),
        action: String(row.ACTION) as ChangeAuditAction,
        changedBy: String(row.CHANGED_BY),
        changedAt: toIstIsoString(row.CHANGED_AT),
        fieldName: row.FIELD_NAME ? String(row.FIELD_NAME) : undefined,
        oldValue: row.OLD_VALUE ? String(row.OLD_VALUE) : undefined,
        newValue: row.NEW_VALUE ? String(row.NEW_VALUE) : undefined,
        changeSummary: row.CHANGE_SUMMARY ? String(row.CHANGE_SUMMARY) : undefined
      }));
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      throw error;
    }
  });
}

/**
 * Fetch a single app user by ID. Returns null if not found.
 */
export async function getAppUserById(userId: number): Promise<AppUser | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT
         user_id, username, email, psid, role, is_active,
         must_change_password, failed_login_count, locked_until,
         last_login_at, created_at, updated_at
       FROM app_users
       WHERE user_id = :userId`,
      { userId }
    );
    const row = result.rows?.[0];
    return row ? mapAppUserRow(row) : null;
  });
}

export async function listAuditLogs(
  limit?: number,
  input: { role?: UserRole; userId?: number; offset?: number; startDate?: string; endDate?: string } = {}
): Promise<AuditLogItem[]> {
  const safeLimit = limit !== undefined ? Math.min(Math.max(limit, 1), 1000000) : undefined;
  const safeOffset = input.offset !== undefined ? Math.max(input.offset, 0) : 0;

  // For "client" role users, restrict to audit logs whose db_name belongs
  // to a database they own in db_inventory.
  const isClientRestricted = input.role === "client" && !!input.userId;
  const conditions: string[] = [];
  const binds: BindParameters = {};

  if (isClientRestricted) {
    conditions.push(`db_name IN (
         SELECT database_name FROM database_inventory WHERE owner_id = :ownerId
       )`);
    binds.ownerId = input.userId;
  }

  if (input.startDate) {
    conditions.push(`created_at >= TO_DATE(:startDate, 'YYYY-MM-DD')`);
    binds.startDate = input.startDate;
  }

  if (input.endDate) {
    conditions.push(`created_at < TO_DATE(:endDate, 'YYYY-MM-DD') + 1`);
    binds.endDate = input.endDate;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let paginationClause = "";
  if (safeLimit !== undefined) {
    if (safeOffset > 0) {
      paginationClause = `OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
    } else {
      paginationClause = `FETCH FIRST ${safeLimit} ROWS ONLY`;
    }
  } else if (safeOffset > 0) {
    paginationClause = `OFFSET ${safeOffset} ROWS`;
  }

  return executeOne(async (connection) => {
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
       ${paginationClause}`,
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
         WHERE UPPER(db_name) = UPPER(:dbName)
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
         is_read,
         read_at,
         read_by,
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
         is_read,
         read_at,
         read_by,
         metadata_json
       FROM app_alert_notifications
       WHERE UPPER(db_name) = UPPER(:dbName)
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
    where.push("UPPER(db_name) = UPPER(:dbName)");
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
         is_read,
         read_at,
         read_by,
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
// DBA Alert Log â€” dba_alert_log table
// ================================================================

/** P1 ORA error codes â€” database-critical. */
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

/** P2 ORA error codes â€” high severity. */
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

  // Normalise timestamp â€” accept string or Date.
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
      // ORA-00001 = unique constraint violation â†’ duplicate, ignore silently.
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
    created_at:   toIstIsoString(row.CREATED_AT ?? row.created_at),
    updated_at:   toIstIsoString(row.UPDATED_AT ?? row.updated_at),
    last_run_at:  (row.LAST_RUN_AT ?? row.last_run_at) ? toIstIsoString(row.LAST_RUN_AT ?? row.last_run_at) : null,
    next_run_at:  (row.NEXT_RUN_AT ?? row.next_run_at) ? toIstIsoString(row.NEXT_RUN_AT ?? row.next_run_at) : null,
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
         h.id,
         h.db_name,
         h.environment AS hist_environment,
         h.os,
         h.refreshed_by,
         h.refresh_timestamp,
         h.metrics_payload,
         d.environment_label AS inv_environment_label,
         d.environment AS inv_environment
       FROM dashboard_history h
       LEFT JOIN (
         SELECT database_name, environment_label, environment
         FROM (
           SELECT database_name, environment_label, environment,
                  ROW_NUMBER() OVER (PARTITION BY UPPER(database_name) ORDER BY id ASC) as rn
           FROM database_inventory
         ) WHERE rn = 1
       ) d ON UPPER(d.database_name) = UPPER(h.db_name)
       WHERE UPPER(h.db_name) = UPPER(:dbName)
       ORDER BY h.refresh_timestamp DESC
       FETCH FIRST 1 ROWS ONLY`,
      { dbName }
    );

    const row = result.rows?.[0];
    if (!row) return null;

    const invLabel = row.INV_ENVIRONMENT_LABEL ?? row.inv_environment_label;
    const invEnv = row.INV_ENVIRONMENT ?? row.inv_environment;
    const histEnv = row.HIST_ENVIRONMENT ?? row.ENVIRONMENT ?? row.hist_environment ?? row.environment;
    const envVal = invLabel || invEnv
      ? normalizeEnvironmentLabel(invLabel, String(invEnv || ""))
      : normalizeEnvironmentLabel(histEnv, String(histEnv || ""));

    return {
      id: Number(row.ID ?? row.id),
      db_name: String(row.DB_NAME ?? row.db_name ?? dbName),
      environment: envVal,
      os: row.OS != null ? String(row.OS) : null,
      refreshed_by: row.REFRESHED_BY != null ? String(row.REFRESHED_BY) : null,
      refresh_timestamp: toIsoString(row.REFRESH_TIMESTAMP ?? row.refresh_timestamp),
      metrics: parseJson<DashboardMetrics>(row.METRICS_PAYLOAD ?? row.metrics_payload) ?? null
    };
  });
}

export async function getDashboardHistoryList(
  dbName: string,
  limit: number = 10,
  offset: number = 0
): Promise<{ rows: DashboardHistoryRow[]; total: number }> {
  return withOracleConnection(async (connection) => {
    const countResult = await connection.execute<DbRow>(
      `SELECT COUNT(*) AS total_cnt FROM dashboard_history WHERE UPPER(db_name) = UPPER(:dbName)`,
      { dbName }
    );
    const total = Number(countResult.rows?.[0]?.TOTAL_CNT ?? countResult.rows?.[0]?.total_cnt ?? 0);

    if (total === 0) {
      return { rows: [], total: 0 };
    }

    const result = await connection.execute<DbRow>(
      `SELECT
         h.id,
         h.db_name,
         h.environment AS hist_environment,
         h.os,
         h.refreshed_by,
         h.refresh_timestamp,
         h.metrics_payload,
         d.environment_label AS inv_environment_label,
         d.environment AS inv_environment
       FROM dashboard_history h
       LEFT JOIN (
         SELECT database_name, environment_label, environment
         FROM (
           SELECT database_name, environment_label, environment,
                  ROW_NUMBER() OVER (PARTITION BY UPPER(database_name) ORDER BY id ASC) as rn
           FROM database_inventory
         ) WHERE rn = 1
       ) d ON UPPER(d.database_name) = UPPER(h.db_name)
       WHERE UPPER(h.db_name) = UPPER(:dbName)
       ORDER BY h.refresh_timestamp DESC
       OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { dbName, offset, limit }
    );

    const rows = (result.rows ?? []).map((row) => {
      const invLabel = row.INV_ENVIRONMENT_LABEL ?? row.inv_environment_label;
      const invEnv = row.INV_ENVIRONMENT ?? row.inv_environment;
      const histEnv = row.HIST_ENVIRONMENT ?? row.ENVIRONMENT ?? row.hist_environment ?? row.environment;
      const envVal = invLabel || invEnv
        ? normalizeEnvironmentLabel(invLabel, String(invEnv || ""))
        : normalizeEnvironmentLabel(histEnv, String(histEnv || ""));

      return {
        id: Number(row.ID ?? row.id),
        db_name: String(row.DB_NAME ?? row.db_name ?? dbName),
        environment: envVal,
        os: row.OS != null ? String(row.OS) : null,
        refreshed_by: row.REFRESHED_BY != null ? String(row.REFRESHED_BY) : null,
        refresh_timestamp: toIsoString(row.REFRESH_TIMESTAMP ?? row.refresh_timestamp),
        metrics: parseJson<DashboardMetrics>(row.METRICS_PAYLOAD ?? row.metrics_payload) ?? null
      };
    });

    return { rows, total };
  });
}

export async function getDashboardHistoryTrends(
  dbName: string,
  hours: number | null,
  limit: number = 500
): Promise<{ rows: DashboardHistoryRow[]; total: number }> {
  return withOracleConnection(async (connection) => {
    // Range window is computed DB-side with SYSTIMESTAMP so refresh_timestamp
    // (DEFAULT CURRENT_TIMESTAMP) is compared against the database's own clock,
    // avoiding any Node/Oracle timezone drift.
    const rangeClause =
      hours != null
        ? "AND h.refresh_timestamp >= SYSTIMESTAMP - NUMTODSINTERVAL(:hours, 'HOUR')"
        : "";
    const baseBinds: Record<string, string | number> = hours != null ? { dbName, hours } : { dbName };

    const countResult = await connection.execute<DbRow>(
      `SELECT COUNT(*) AS total_cnt FROM dashboard_history h WHERE UPPER(h.db_name) = UPPER(:dbName) ${rangeClause}`,
      baseBinds
    );
    const total = Number(countResult.rows?.[0]?.TOTAL_CNT ?? countResult.rows?.[0]?.total_cnt ?? 0);
    if (total === 0) {
      return { rows: [], total: 0 };
    }

    // Take the newest :limit rows, then re-sort ascending so the UI receives a
    // chronological series (refresh_timestamp ASC).
    const result = await connection.execute<DbRow>(
      `SELECT * FROM (
         SELECT
           h.id,
           h.db_name,
           h.environment AS hist_environment,
           h.os,
           h.refreshed_by,
           h.refresh_timestamp,
           h.metrics_payload,
           d.environment_label AS inv_environment_label,
           d.environment AS inv_environment
         FROM dashboard_history h
         LEFT JOIN (
           SELECT database_name, environment_label, environment
           FROM (
             SELECT database_name, environment_label, environment,
                    ROW_NUMBER() OVER (PARTITION BY UPPER(database_name) ORDER BY id ASC) as rn
             FROM database_inventory
           ) WHERE rn = 1
         ) d ON UPPER(d.database_name) = UPPER(h.db_name)
         WHERE UPPER(h.db_name) = UPPER(:dbName) ${rangeClause}
         ORDER BY h.refresh_timestamp DESC
         FETCH FIRST :limit ROWS ONLY
       )
       ORDER BY refresh_timestamp ASC`,
      { ...baseBinds, limit }
    );

    const rows = (result.rows ?? []).map((row) => {
      const invLabel = row.INV_ENVIRONMENT_LABEL ?? row.inv_environment_label;
      const invEnv = row.INV_ENVIRONMENT ?? row.inv_environment;
      const histEnv = row.HIST_ENVIRONMENT ?? row.ENVIRONMENT ?? row.hist_environment ?? row.environment;
      const envVal = invLabel || invEnv
        ? normalizeEnvironmentLabel(invLabel, String(invEnv || ""))
        : normalizeEnvironmentLabel(histEnv, String(histEnv || ""));

      return {
        id: Number(row.ID ?? row.id),
        db_name: String(row.DB_NAME ?? row.db_name ?? dbName),
        environment: envVal,
        os: row.OS != null ? String(row.OS) : null,
        refreshed_by: row.REFRESHED_BY != null ? String(row.REFRESHED_BY) : null,
        refresh_timestamp: toIsoString(row.REFRESH_TIMESTAMP ?? row.refresh_timestamp),
        metrics: parseJson<DashboardMetrics>(row.METRICS_PAYLOAD ?? row.metrics_payload) ?? null
      };
    });

    return { rows, total };
  });
}


// ============================================================
// Performance Run All History â€” performance_run_all_hist
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

export async function getPerformanceRunAllHistoryList(
  db: string,
  limit: number = 50
): Promise<PerformanceRunAllRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
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
       FETCH FIRST :fetchLimit ROWS ONLY`,
      { dbName: db, fetchLimit: safeLimit }
    );

    const rows = result.rows || [];
    return rows.map((row) => ({
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
    }));
  });
}

// ============================================================
// DBA Console â€” Shift Management
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
  LATE_COMMENT?: string;
  EMERGENCY_COMMENT?: string;
  FORCE_CLOSE_COMMENT?: string;
  FORCE_CLOSED_BY?: string;
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
    ack_at: row.ACK_AT ? toIstIsoString(row.ACK_AT) : undefined,
    late_comment: row.LATE_COMMENT ? String(row.LATE_COMMENT) : undefined,
    emergency_comment: row.EMERGENCY_COMMENT ? String(row.EMERGENCY_COMMENT) : undefined,
    force_close_comment: row.FORCE_CLOSE_COMMENT ? String(row.FORCE_CLOSE_COMMENT) : undefined,
    force_closed_by: row.FORCE_CLOSED_BY ? String(row.FORCE_CLOSED_BY) : undefined
  };
}

const SHIFT_SESSION_COLUMNS = `
  s.session_id, s.user_id, s.username, s.email, u.role,
  s.shift_number, s.shift_date, s.login_at, s.logout_at,
  s.status, s.is_active, s.late_comment, s.emergency_comment,
  s.force_close_comment, s.force_closed_by,
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
  lateComment?: string;
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
           login_at, status, is_active, created_by, updated_by, late_comment
         ) VALUES (
           :userId, :username, :email, :shiftNumber, TO_DATE(:shiftDate, 'YYYY-MM-DD'),
           SYSTIMESTAMP, 'ACTIVE', 'Y', :actor, :actor, :lateComment
         )`,
        {
          userId: input.userId,
          username: input.username,
          email,
          shiftNumber: input.shiftNumber,
          shiftDate: toOracleDateString(shiftDate),
          actor: input.actor,
          lateComment: input.lateComment || null
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
 * Returns historical shift sessions (both active and closed) ordered by most recent login_at first.
 */
export async function listShiftSessionHistory(
  limit = 50,
  filters?: { fromDate?: string; toDate?: string; dbaUserId?: number; shiftNumber?: number }
): Promise<ShiftSession[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const binds: BindParameters = {};
  const conditions: string[] = [];

  if (filters?.fromDate) {
    binds.fromDate = filters.fromDate;
    conditions.push("TRUNC(s.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  }
  if (filters?.toDate) {
    binds.toDate = filters.toDate;
    conditions.push("TRUNC(s.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  if (filters?.dbaUserId) {
    binds.dbaUserId = filters.dbaUserId;
    conditions.push("s.user_id = :dbaUserId");
  }
  if (filters?.shiftNumber) {
    binds.shiftNumber = filters.shiftNumber;
    conditions.push("s.shift_number = :shiftNumber");
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return executeOne(async (connection) => {
    const result = await connection.execute<ShiftSessionRow>(
      `SELECT ${SHIFT_SESSION_COLUMNS}
       ${SHIFT_SESSION_JOIN}
       ${whereClause}
       ORDER BY s.login_at DESC
       FETCH FIRST ${safeLimit} ROWS ONLY`,
      binds
    );
    return (result.rows || []).map((row) => mapShiftSession(row as ShiftSessionRow));
  });
}


/**
 * Returns the set of time-based shift numbers (1,2,3) that already have an
 * active DBA logged in. Used by the login API to block duplicate shift logins.
 * General Shift (4) is excluded â€” multiple DBAs can be on general shift.
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
  emergencyComment?: string;
  forceCloseComment?: string;
  forceClosedBy?: string;
}): Promise<ShiftSession> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute(
        `UPDATE app_shift_sessions
         SET logout_at = SYSTIMESTAMP,
             status = 'CLOSED',
             is_active = 'N',
             updated_by = :actor,
             emergency_comment = :emergencyComment,
             force_close_comment = :forceCloseComment,
             force_closed_by = :forceClosedBy
         WHERE session_id = :sessionId AND is_active = 'Y'`,
        {
          sessionId: input.sessionId,
          actor: input.actor,
          emergencyComment: input.emergencyComment || null,
          forceCloseComment: input.forceCloseComment || null,
          forceClosedBy: input.forceClosedBy || null
        }
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

export async function cancelShiftSession(input: {
  sessionId: number;
  actor: string;
}): Promise<{ sessionId: number; shiftNumber: number; username: string }> {
  return executeOne(async (connection) => {
    try {
      const fetchRes = await connection.execute<DbRow>(
        `SELECT session_id, shift_number, username
         FROM app_shift_sessions
         WHERE session_id = :sessionId`,
        { sessionId: input.sessionId }
      );
      const row = fetchRes.rows?.[0];
      if (!row) {
        throw new Error("Shift session not found.");
      }
      const shiftNumber = Number(row.SHIFT_NUMBER ?? row.shift_number);
      const username = String(row.USERNAME ?? row.username);

      // Delete associated handovers for this session
      await connection.execute(
        `DELETE FROM app_handovers WHERE session_id = :sessionId`,
        { sessionId: input.sessionId }
      );

      // Delete the shift session record itself
      const result = await connection.execute(
        `DELETE FROM app_shift_sessions WHERE session_id = :sessionId`,
        { sessionId: input.sessionId }
      );

      const affected = result.rowsAffected ?? 0;
      if (affected === 0) {
        throw new Error("Failed to delete shift session record.");
      }

      await connection.commit();

      return {
        sessionId: input.sessionId,
        shiftNumber,
        username
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
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

export async function setDatabaseAccess(id: number, enableAccess: boolean, actor: string): Promise<DatabaseInventoryItem> {
  return executeOne(async (connection) => {
    try {
      const existing = await fetchDatabaseInventoryById(connection, id);
      if (!existing) throw new Error("Database not found.");

      await connection.execute(
        `UPDATE database_inventory
         SET enable_access = :enableAccess,
             updated_by = :actor
         WHERE UPPER(database_name) = UPPER(:databaseName)`,
        { databaseName: existing.database_name, enableAccess: enableAccess ? "Y" : "N", actor }
      );
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



/**
 * Returns the cumulative IST time window for a time-based shift on the given
 * shift_date. The window always starts at 07:00 IST on the shift date.
 *
 *   Shift 1 → 07:00 to 15:30 same day
 *   Shift 2 → 07:00 to 23:00 same day (cumulative)
 *   Shift 3 → 07:00 to 07:00 next day  (cumulative, full 24h)
 *
 * Returns Oracle TIMESTAMP literals for direct use in SQL.
 */
function getCumulativeShiftWindowIST(
  shiftDate: string,
  shiftNumber: 1 | 2 | 3
): { windowStart: string; windowEnd: string } {
  // shiftDate is 'YYYY-MM-DD' (IST calendar day).
  const windowStart = `${shiftDate} 07:00:00`;
  let windowEnd: string;
  switch (shiftNumber) {
    case 1:
      windowEnd = `${shiftDate} 15:30:00`;
      break;
    case 2:
      windowEnd = `${shiftDate} 23:00:00`;
      break;
    case 3: {
      // Next day 07:00 IST.
      const parts = shiftDate.split("-").map(Number);
      const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      d.setUTCDate(d.getUTCDate() + 1);
      const nextDay = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      windowEnd = `${nextDay} 07:00:00`;
      break;
    }
  }
  return { windowStart, windowEnd };
}

/**
 * Counts unresolved n8n-delivered alerts that arrived within the cumulative
 * shift time window across three tables:
 *   1. app_alert_notifications (tablespace / datafile_extend / filesystem_drive)
 *   2. app_db_monitoring_incidents
 *   3. dba_alert_log
 */
async function getShiftAlertClearanceStatus(
  connection: Connection,
  shiftDate: string,
  shiftNumber: 1 | 2 | 3
): Promise<AlertClearanceStatus> {
  const { windowStart, windowEnd } = getCumulativeShiftWindowIST(shiftDate, shiftNumber);
  const tsFormat = "YYYY-MM-DD HH24:MI:SS";

  // All three queries run in parallel.
  const [alertNotifResult, monitoringResult, alertLogResult] = await Promise.all([
    // 1. app_alert_notifications — tablespace, datafile_extend, filesystem_drive
    connection.execute<DbRow>(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN alert_status = 'pending_approval' THEN 1 ELSE 0 END) AS pending_count
       FROM app_alert_notifications
       WHERE alert_type IN ('tablespace', 'datafile_extend', 'filesystem_drive')
         AND created_at >= TO_TIMESTAMP(:windowStart, '${tsFormat}')
         AND created_at <  TO_TIMESTAMP(:windowEnd,   '${tsFormat}')`,
      { windowStart, windowEnd }
    ),
    // 2. app_db_monitoring_incidents
    connection.execute<DbRow>(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN incident_status = 'DOWN' THEN 1 ELSE 0 END) AS pending_count
       FROM app_db_monitoring_incidents
       WHERE first_reported >= TO_TIMESTAMP(:windowStart, '${tsFormat}')
         AND first_reported <  TO_TIMESTAMP(:windowEnd,   '${tsFormat}')`,
      { windowStart, windowEnd }
    ),
    // 3. dba_alert_log
    connection.execute<DbRow>(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS pending_count
       FROM dba_alert_log
       WHERE created_at >= TO_TIMESTAMP(:windowStart, '${tsFormat}')
         AND created_at <  TO_TIMESTAMP(:windowEnd,   '${tsFormat}')`,
      { windowStart, windowEnd }
    )
  ]);

  const sum = (rows: DbRow[] | undefined, col: string): number =>
    rows?.[0] ? Number(rows[0][col] ?? 0) : 0;

  const total =
    sum(alertNotifResult.rows, "TOTAL_COUNT") +
    sum(monitoringResult.rows, "TOTAL_COUNT") +
    sum(alertLogResult.rows, "TOTAL_COUNT");
  const pending =
    sum(alertNotifResult.rows, "PENDING_COUNT") +
    sum(monitoringResult.rows, "PENDING_COUNT") +
    sum(alertLogResult.rows, "PENDING_COUNT");

  return { total, pending, is_clear: pending === 0 };
}

/**
 * Calculates the Daily Checklist work required for a time-based shift to
 * logout. Shift 2 inherits Shift 1's checks and Shift 3 inherits both prior
 * shifts. General Shift deliberately has no checklist requirement.
 *
 * Also checks that all n8n alert notifications within the cumulative shift
 * time window have been acknowledged / approved / rejected.
 */
export async function getLogoutChecklistReadiness(
  session: ShiftSession
): Promise<ShiftLogoutChecklistReadiness> {
  if (session.shift_number === 4) {
    return {
      shift_date: session.shift_date,
      required_shifts: [],
      database_status: { total: 0, completed: 0, completion_pct: 100 },
      backup_status: { total: 0, completed: 0, completion_pct: 100 },
      alert_clearance: { total: 0, pending: 0, is_clear: true },
      duration_check: {
        is_met: true,
        required_hours: 0,
        shift_start_time: "",
        earliest_logout_time: "",
        minutes_remaining: 0
      },
      is_complete: true
    };
  }

  const durationCheck = checkShiftMinDuration(session.shift_number, session.shift_date);

  const requiredShifts = Array.from(
    { length: session.shift_number },
    (_, index) => (index + 1) as 1 | 2 | 3
  );
  const shiftList = requiredShifts.join(", ");

  return executeOne(async (connection) => {
    const [databaseResult, templateResult, dbCheckResult, backupCheckResult] = await Promise.all([
      connection.execute<DbRow>(
        `SELECT MIN(id) AS id,
                UPPER(TRIM(database_name)) AS database_key
         FROM database_inventory
         WHERE status = 'active'
           AND environment_label = 'PROD'
         GROUP BY UPPER(TRIM(database_name))`
      ),
      connection.execute<DbRow>(
        `SELECT backup_id, scheduled_time
         FROM app_backup_template
         WHERE is_active = 'Y'`
      ),
      connection.execute<DbRow>(
        `SELECT DISTINCT UPPER(TRIM(d.database_name)) AS database_key, c.shift_number
         FROM app_db_status_checks c
         JOIN database_inventory d ON d.id = c.database_id
         WHERE d.status = 'active'
           AND d.environment_label = 'PROD'
           AND TRUNC(c.shift_date) = TO_DATE(:shiftDate, 'YYYY-MM-DD')
           AND c.shift_number IN (${shiftList})`,
        { shiftDate: session.shift_date }
      ),
      connection.execute<DbRow>(
        `SELECT DISTINCT c.backup_id, c.shift_number
         FROM app_backup_status_checks c
         JOIN app_backup_template t ON t.backup_id = c.backup_id
         WHERE t.is_active = 'Y'
           AND TRUNC(c.shift_date) = TO_DATE(:shiftDate, 'YYYY-MM-DD')
           AND c.shift_number IN (${shiftList})`,
        { shiftDate: session.shift_date }
      )
    ]);

    const activeDatabaseKeys = new Set(
      (databaseResult.rows || []).map((row) => String(row.DATABASE_KEY))
    );
    const backupIdsByShift = new Map<number, Set<number>>();
    for (const shift of requiredShifts) backupIdsByShift.set(shift, new Set());
    for (const row of templateResult.rows || []) {
      const responsibleShift = getBackupResponsibleShift(
        row.SCHEDULED_TIME ? String(row.SCHEDULED_TIME) : undefined
      );
      if (responsibleShift && backupIdsByShift.has(responsibleShift)) {
        backupIdsByShift.get(responsibleShift)!.add(Number(row.BACKUP_ID));
      }
    }

    const completedDbChecks = new Set(
      (dbCheckResult.rows || [])
        .filter((row) => activeDatabaseKeys.has(String(row.DATABASE_KEY)))
        .map((row) => `${Number(row.SHIFT_NUMBER)}:${String(row.DATABASE_KEY)}`)
    );
    const completedBackupChecks = new Set(
      (backupCheckResult.rows || [])
        .filter((row) => backupIdsByShift.get(Number(row.SHIFT_NUMBER))?.has(Number(row.BACKUP_ID)))
        .map((row) => `${Number(row.SHIFT_NUMBER)}:${Number(row.BACKUP_ID)}`)
    );

    const databaseTotal = activeDatabaseKeys.size * requiredShifts.length;
    const backupTotal = Array.from(backupIdsByShift.values()).reduce((total, ids) => total + ids.size, 0);
    const databaseCompleted = completedDbChecks.size;
    const backupCompleted = completedBackupChecks.size;
    const completion = (completed: number, total: number): ChecklistCompletion => ({
      total,
      completed,
      // No configured tasks is already complete; it must not prevent logout.
      completion_pct: total === 0 ? 100 : Math.round((completed / total) * 100)
    });
    const databaseStatus = completion(databaseCompleted, databaseTotal);
    const backupStatus = completion(backupCompleted, backupTotal);

    const alertClearance = await getShiftAlertClearanceStatus(
      connection,
      session.shift_date,
      session.shift_number as 1 | 2 | 3
    );

    return {
      shift_date: session.shift_date,
      required_shifts: requiredShifts,
      database_status: databaseStatus,
      backup_status: backupStatus,
      alert_clearance: alertClearance,
      duration_check: {
        is_met: durationCheck.isMet,
        required_hours: durationCheck.requiredHours,
        shift_start_time: durationCheck.shiftStartTimeFormatted,
        earliest_logout_time: durationCheck.earliestLogoutTimeFormatted,
        minutes_remaining: durationCheck.minutesRemaining,
        formatted_remaining: durationCheck.formattedRemaining
      },
      is_complete:
        databaseCompleted === databaseTotal &&
        backupCompleted === backupTotal &&
        alertClearance.is_clear &&
        durationCheck.isMet
    };
  });
}

// ============================================================
// DBA Console â€” Handovers
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

/**
 * Updates the text of an existing handover and resets it back to PENDING status,
 * clearing any prior acknowledgement. Used when the author edits and resubmits
 * their handover notes before logging out (supports both Case 1: was PENDING,
 * and Case 2: was already ACKNOWLEDGED).
 */
export async function updateHandoverText(input: {
  handoverId: number;
  handoverText: string;
  actor: string;
}): Promise<Handover> {
  return executeOne(async (connection) => {
    try {
      const existing = await getHandoverById(connection, input.handoverId);
      if (!existing) throw new Error("Handover not found.");

      await connection.execute(
        `UPDATE app_handovers
         SET handover_text  = :handoverText,
             status         = 'PENDING',
             ack_user_id    = NULL,
             ack_username   = NULL,
             ack_at         = NULL,
             is_override    = 'N',
             override_reason = NULL,
             updated_by     = :actor
         WHERE handover_id = :handoverId`,
        {
          handoverId: input.handoverId,
          handoverText: input.handoverText,
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

async function listPendingHandoversWithConnection(connection: Connection): Promise<Handover[]> {
  const result = await connection.execute<HandoverRow>(
    `SELECT handover_id, session_id, author_user_id, author_username,
            shift_number, shift_date, handover_text, status,
            ack_user_id, ack_username, ack_at, override_reason, is_override,
            created_at, updated_at
     FROM app_handovers
     WHERE status = 'PENDING'
     ORDER BY created_at DESC
     FETCH FIRST 300 ROWS ONLY`
  );
  return (result.rows || []).map((row) => mapHandover(row as HandoverRow));
}

export async function listPendingHandovers(): Promise<Handover[]> {
  return executeOne(async (connection) => {
    return listPendingHandoversWithConnection(connection);
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
// DBA Console â€” Backup Template (app_admin maintained)
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
// DBA Console â€” Daily Checklist (DB status + Backup status)
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
  IS_REALTIME_CHECK?: string;
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
    comment_text: row.COMMENT_TEXT ? String(row.COMMENT_TEXT) : undefined,
    is_realtime_check: row.IS_REALTIME_CHECK === "Y"
  };
}

export async function listDbStatusChecks(shiftNumber: number, shiftDate: string): Promise<DbStatusCheck[]> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbStatusRow>(
      `SELECT c.check_id, c.database_id, d.database_name, c.shift_number,
              c.shift_date, c.status, c.checked_by, c.checked_username,
              c.checked_at, c.comment_text, c.is_realtime_check
       FROM app_db_status_checks c
       JOIN database_inventory d ON d.id = c.database_id
       WHERE c.shift_number = :shiftNumber
         AND d.status = 'active'
         AND d.environment_label = 'PROD'
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
  isRealtimeCheck?: boolean;
}): Promise<DbStatusCheck> {
  return executeOne(async (connection) => {
    try {
      const eligibleDatabase = await connection.execute<DbRow>(
        `SELECT id
         FROM database_inventory
         WHERE id = :databaseId
           AND status = 'active'
           AND environment_label = 'PROD'`,
        { databaseId: input.databaseId }
      );
      if (!eligibleDatabase.rows?.[0]) {
        throw new Error("Database availability checks are only available for active PROD databases.");
      }

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
               is_realtime_check = :isRealtimeCheck,
               updated_by = :actor
           WHERE check_id = :checkId`,
          {
            checkId: Number(existingRow.CHECK_ID),
            status: input.status,
            checkedBy: input.checkedBy,
            checkedUsername: input.checkedUsername,
            commentText: input.commentText || null,
            isRealtimeCheck: input.isRealtimeCheck ? "Y" : "N",
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
           is_realtime_check, created_by, updated_by
         ) VALUES (
           :databaseId, :shiftNumber, TO_DATE(:shiftDate, 'YYYY-MM-DD'), :status,
           :checkedBy, :checkedUsername, SYSTIMESTAMP, :commentText,
           :isRealtimeCheck, :actor, :actor
         )`,
        {
          databaseId: input.databaseId,
          shiftNumber: input.shiftNumber,
          shiftDate: input.shiftDate,
          status: input.status,
          checkedBy: input.checkedBy,
          checkedUsername: input.checkedUsername,
          commentText: input.commentText || null,
          isRealtimeCheck: input.isRealtimeCheck ? "Y" : "N",
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
// DBA Console â€” Shift Report (app_admin only)
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

  // Coverage is a team-wide, cross-shift metric — only date filters apply.
  const coverageConditions: string[] = [];
  const coverageBinds: BindParameters = {};
  if (filters.fromDate) {
    coverageBinds.fromDate = filters.fromDate;
    // Fetch sessions starting 1 day prior so previous day's Shift 3 sessions extending past 07:00 AM are included
    coverageConditions.push("TRUNC(s.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD') - 1");
  }
  if (filters.toDate) {
    coverageBinds.toDate = filters.toDate;
    coverageConditions.push("TRUNC(s.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  }
  const coverageWhere = coverageConditions.length ? `WHERE ${coverageConditions.join(" AND ")}` : "";

  return executeOne(async (connection) => {
    const [activeDbas, dailyAttendance, monthlyAttendance, lateLogins, pendingHandovers, avgResult, mostActiveResult, timelineResult, loginTrend, dbCompletion, backupCompletion, dbStatusChecks, backupStatusChecks, handovers, sessions, coverage, userWorkHours] = await Promise.all([
      listActiveShiftSessionsForReport(connection),
      fetchDailyAttendance(connection, binds, whereClause),
      fetchMonthlyAttendance(connection, binds, whereClause),
      fetchLateLogins(connection, binds, whereClause),
      listPendingHandoversWithConnection(connection),
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
      fetchShiftCoverage(connection, coverageBinds, coverageWhere, filters),
      fetchUserWorkHours(connection, binds, whereClause)
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
      coverage,
      userWorkHours
    };
  });
}

/**
 * Lightweight endpoint: only fetches the activity timeline slice.
 * Used when the user paginates / filters the timeline without changing core report filters.
 */
export async function getShiftReportTimeline(
  filters: ShiftReportFilters
): Promise<{ rows: ShiftReportData["activityTimeline"]; total: number }> {
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
    return fetchActivityTimeline(connection, binds, whereClause, filters);
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
    } else if (evt === "handover" || evt === "handover_notes") {
      eventConditions.push("(evt.event = 'handover' OR evt.event = 'handover_notes')");
    }
  }
  if (filters.timelineSearch && filters.timelineSearch.trim()) {
    timelineBinds.timelineSearch = `%${filters.timelineSearch.trim().toUpperCase()}%`;
    eventConditions.push("(UPPER(evt.username) LIKE :timelineSearch OR UPPER(NVL(evt.detail, ' ')) LIKE :timelineSearch OR UPPER(TO_CHAR(evt.session_id)) LIKE :timelineSearch)");
  }

  const eventWhere = eventConditions.length ? `WHERE ${eventConditions.join(" AND ")}` : "";

  // Conditions for handovers (author submission)
  const hConditions: string[] = [];
  if (filters.fromDate) hConditions.push("TRUNC(h.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  if (filters.toDate) hConditions.push("TRUNC(h.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  if (filters.dbaUserId) hConditions.push("h.author_user_id = :dbaUserId");
  if (filters.shiftNumber) hConditions.push("h.shift_number = :shiftNumber");
  const hWhere = hConditions.length ? `WHERE ${hConditions.join(" AND ")}` : "";

  // Conditions for handover acknowledgements
  const hAckConditions: string[] = ["h.status = 'ACKNOWLEDGED'", "h.ack_at IS NOT NULL"];
  if (filters.fromDate) hAckConditions.push("TRUNC(h.shift_date) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
  if (filters.toDate) hAckConditions.push("TRUNC(h.shift_date) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
  if (filters.dbaUserId) hAckConditions.push("h.ack_user_id = :dbaUserId");
  if (filters.shiftNumber) hAckConditions.push("h.shift_number = :shiftNumber");
  const hAckWhere = `WHERE ${hAckConditions.join(" AND ")}`;

  const unionSql = `
    SELECT 'login' AS event, s.username, s.shift_number, s.login_at AS ts,
           CAST('Shift ' || s.shift_number || ' Login' AS VARCHAR2(200)) AS detail,
           CAST(NULL AS NUMBER) AS handover_id, CAST(NULL AS VARCHAR2(3500)) AS handover_text, s.session_id
    FROM app_shift_sessions s
    ${whereClause}
    UNION ALL
    SELECT 'logout' AS event, s.username, s.shift_number, s.logout_at AS ts,
           CAST('Shift ' || s.shift_number || ' Logout' AS VARCHAR2(200)) AS detail,
           CAST(NULL AS NUMBER) AS handover_id, CAST(NULL AS VARCHAR2(3500)) AS handover_text, s.session_id
    FROM app_shift_sessions s
    ${whereClause ? whereClause + " AND s.logout_at IS NOT NULL" : "WHERE s.logout_at IS NOT NULL"}
    UNION ALL
    SELECT 'acknowledge' AS event, h.ack_username AS username, h.shift_number, h.ack_at AS ts,
           CAST(SUBSTR('Acknowledged ' || h.author_username || '''s handover', 1, 200) AS VARCHAR2(200)) AS detail,
           h.handover_id, DBMS_LOB.SUBSTR(h.handover_text, 3500, 1) AS handover_text, h.session_id
    FROM app_handovers h
    ${hAckWhere}
    UNION ALL
    SELECT 'handover' AS event, h.author_username AS username, h.shift_number, h.created_at AS ts,
           CAST('Submitted shift handover notes' AS VARCHAR2(200)) AS detail,
           h.handover_id, DBMS_LOB.SUBSTR(h.handover_text, 3500, 1) AS handover_text, h.session_id
    FROM app_handovers h
    ${hWhere}
  `;

  // Single-pass: COUNT(*) OVER() computes total before OFFSET/FETCH pagination,
  // eliminating the separate COUNT(*) query over the same UNION ALL.
  const page = Math.max(1, filters.timelinePage || 1);
  const pageSize = Math.min(100, Math.max(1, filters.timelinePageSize || 20));
  const offset = (page - 1) * pageSize;

  const pageResult = await connection.execute<DbRow>(
    `SELECT evt.*, COUNT(*) OVER() AS total_count
     FROM (${unionSql}) evt ${eventWhere}
     ORDER BY evt.ts DESC
     OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
    timelineBinds as BindParameters
  );

  const resultRows = pageResult.rows || [];
  const total = resultRows.length > 0 ? Number(resultRows[0].TOTAL_COUNT ?? 0) : 0;

  const rows: ShiftReportData["activityTimeline"] = resultRows.map((row) => ({
    event: String(row.EVENT),
    username: String(row.USERNAME || ""),
    shift_number: Number(row.SHIFT_NUMBER || 0),
    timestamp: toIstIsoString(row.TS),
    detail: row.DETAIL ? String(row.DETAIL) : undefined,
    handover_id: row.HANDOVER_ID != null ? Number(row.HANDOVER_ID) : undefined,
    handover_text: row.HANDOVER_TEXT ? String(row.HANDOVER_TEXT) : undefined,
    session_id: row.SESSION_ID != null ? Number(row.SESSION_ID) : undefined
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
  // Single query replaces 3 sequential per-shift queries.
  // CASE maps each shift_number to its start minute; WHERE filters minutes_late > 60 in SQL.
  const shiftCondition = whereClause
    ? whereClause + ` AND s.shift_number IN (1, 2, 3)`
    : `WHERE s.shift_number IN (1, 2, 3)`;

  const result = await connection.execute<DbRow>(
    `SELECT s.session_id, s.username, s.shift_number, s.shift_date, s.login_at, s.late_comment,
            (EXTRACT(HOUR FROM CAST(s.login_at AS TIMESTAMP(0))) * 60
             + EXTRACT(MINUTE FROM CAST(s.login_at AS TIMESTAMP(0)))
             - CASE s.shift_number WHEN 1 THEN 420 WHEN 2 THEN 870 WHEN 3 THEN 1350 END
            ) AS minutes_late
     FROM app_shift_sessions s
     ${shiftCondition}
       AND (EXTRACT(HOUR FROM CAST(s.login_at AS TIMESTAMP(0))) * 60
            + EXTRACT(MINUTE FROM CAST(s.login_at AS TIMESTAMP(0)))
            - CASE s.shift_number WHEN 1 THEN 420 WHEN 2 THEN 870 WHEN 3 THEN 1350 END
           ) > 60
     ORDER BY s.login_at DESC
     FETCH FIRST 50 ROWS ONLY`,
    binds
  );

  return (result.rows || []).map((row) => ({
    session_id: Number(row.SESSION_ID),
    username: String(row.USERNAME),
    shift_number: Number(row.SHIFT_NUMBER),
    shift_date: toOracleDateString(asDate(row.SHIFT_DATE) || new Date()),
    login_at: toIstIsoString(row.LOGIN_AT),
    minutes_late: Number(row.MINUTES_LATE ?? 0),
    late_comment: row.LATE_COMMENT ? String(row.LATE_COMMENT) : undefined
  }));
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
  // Filter scope for the CHECKS tables (no table alias â€” these are un-aliased).
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
  if (type === "db") {
    // General Shift (shift 4) personnel do not perform DB availability checks.
    checkConditions.push("shift_number != 4");
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
  if (type === "db") {
    // General Shift (shift 4) personnel do not perform DB availability checks.
    sessConditions.push("s.shift_number != 4");
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

  // Database Availability Check is intentionally limited to active PROD
  // inventory records, matching the Daily Checklist and logout requirement.
  // Backup checks are handled above from all active backup templates.
  const [invResult, slotsResult, doneResult] = await Promise.all([
    connection.execute<DbRow>(
      `SELECT COUNT(DISTINCT UPPER(TRIM(database_name))) AS total
       FROM database_inventory
       WHERE status = 'active'
         AND environment_label = 'PROD'`,
      {}
    ),
    connection.execute<DbRow>(
      `SELECT COUNT(DISTINCT TRUNC(s.shift_date) || '-' || s.shift_number) AS slots
       FROM app_shift_sessions s
       ${sessWhere}`,
      sessBinds
    ),
    connection.execute<DbRow>(
      `SELECT COUNT(DISTINCT UPPER(TRIM(d.database_name)) || '-' || c.shift_number || '-' || TRUNC(c.shift_date)) AS completed
       FROM app_db_status_checks c
       JOIN database_inventory d ON d.id = c.database_id
       ${checkWhere}
       ${checkWhere ? "AND" : "WHERE"} d.status = 'active'
         AND d.environment_label = 'PROD'`,
      checkBinds
    )
  ]);

  // Expected checks = active inventory Ã— (day, shift) opportunities that ran.
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
// Shift Report â€” detailed audit datasets (for PDF/Excel export)
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
  const prodWhereClause = `${whereClause}${whereClause ? " AND" : "WHERE"} d.status = 'active'
       AND d.environment_label = 'PROD'`;
  const result = await connection.execute<DbStatusRow>(
    `SELECT c.check_id, c.database_id, d.database_name, c.shift_number,
            c.shift_date, c.status, c.checked_by, c.checked_username,
            c.checked_at, c.comment_text
     FROM app_db_status_checks c
     JOIN database_inventory d ON d.id = c.database_id
     ${prodWhereClause}
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

async function fetchUserWorkHours(
  connection: Connection,
  binds: BindParameters,
  whereClause: string
): Promise<ShiftReportData["userWorkHours"]> {
  const result = await connection.execute<DbRow>(
    `SELECT s.user_id,
            s.username,
            COUNT(*) AS total_sessions,
            SUM(CASE WHEN s.logout_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_sessions,
            SUM(CASE WHEN s.logout_at IS NULL OR s.is_active = 'Y' THEN 1 ELSE 0 END) AS active_sessions,
            ROUND(SUM(GREATEST(0, (CAST(NVL(s.logout_at, SYSTIMESTAMP) AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60))) AS total_minutes,
            ROUND(AVG(GREATEST(0, (CAST(NVL(s.logout_at, SYSTIMESTAMP) AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60))) AS avg_session_minutes,
            ROUND(SUM(CASE WHEN s.shift_number = 1 THEN GREATEST(0, (CAST(NVL(s.logout_at, SYSTIMESTAMP) AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60) ELSE 0 END)) AS shift1_minutes,
            ROUND(SUM(CASE WHEN s.shift_number = 2 THEN GREATEST(0, (CAST(NVL(s.logout_at, SYSTIMESTAMP) AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60) ELSE 0 END)) AS shift2_minutes,
            ROUND(SUM(CASE WHEN s.shift_number = 3 THEN GREATEST(0, (CAST(NVL(s.logout_at, SYSTIMESTAMP) AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60) ELSE 0 END)) AS shift3_minutes,
            ROUND(SUM(CASE WHEN s.shift_number = 4 THEN GREATEST(0, (CAST(NVL(s.logout_at, SYSTIMESTAMP) AS DATE) - CAST(s.login_at AS DATE)) * 24 * 60) ELSE 0 END)) AS shift4_minutes,
            SUM(CASE WHEN s.shift_number = 1 AND s.logout_at IS NOT NULL THEN 1 ELSE 0 END) AS shift1_completed,
            SUM(CASE WHEN s.shift_number = 2 AND s.logout_at IS NOT NULL THEN 1 ELSE 0 END) AS shift2_completed,
            SUM(CASE WHEN s.shift_number = 3 AND s.logout_at IS NOT NULL THEN 1 ELSE 0 END) AS shift3_completed,
            SUM(CASE WHEN s.shift_number = 4 AND s.logout_at IS NOT NULL THEN 1 ELSE 0 END) AS shift4_completed,
            MAX(s.login_at) AS last_login_at
     FROM app_shift_sessions s
     ${whereClause}
     GROUP BY s.user_id, s.username
     ORDER BY total_minutes DESC`,
    binds
  );

  return (result.rows || []).map((row) => {
    const totalMin = Math.max(0, Number(row.TOTAL_MINUTES || 0));
    const shift1Min = Math.max(0, Number(row.SHIFT1_MINUTES || 0));
    const shift2Min = Math.max(0, Number(row.SHIFT2_MINUTES || 0));
    const shift3Min = Math.max(0, Number(row.SHIFT3_MINUTES || 0));
    const shift4Min = Math.max(0, Number(row.SHIFT4_MINUTES || 0));

    return {
      user_id: Number(row.USER_ID),
      username: String(row.USERNAME || ""),
      total_sessions: Number(row.TOTAL_SESSIONS || 0),
      completed_sessions: Number(row.COMPLETED_SESSIONS || 0),
      active_sessions: Number(row.ACTIVE_SESSIONS || 0),
      total_minutes: totalMin,
      total_hours: Math.round((totalMin / 60) * 10) / 10,
      avg_session_minutes: Math.round(Number(row.AVG_SESSION_MINUTES || 0)),
      shift1_hours: Math.round((shift1Min / 60) * 10) / 10,
      shift2_hours: Math.round((shift2Min / 60) * 10) / 10,
      shift3_hours: Math.round((shift3Min / 60) * 10) / 10,
      shift4_hours: Math.round((shift4Min / 60) * 10) / 10,
      shift1_completed: Number(row.SHIFT1_COMPLETED || 0),
      shift2_completed: Number(row.SHIFT2_COMPLETED || 0),
      shift3_completed: Number(row.SHIFT3_COMPLETED || 0),
      shift4_completed: Number(row.SHIFT4_COMPLETED || 0),
      last_login_at: row.LAST_LOGIN_AT ? toIstIsoString(row.LAST_LOGIN_AT) : undefined
    };
  });
}

async function fetchShiftCoverage(
  connection: Connection,
  binds: BindParameters,
  whereClause: string,
  filters?: ShiftReportFilters
): Promise<ShiftReportData["coverage"]> {
  // Day-level gap coverage. For each day we calculate how much of the 24-hour
  // cycle (07:00 IST -> 07:00 IST next day = 1440 minutes) is covered by any
  // active DBA sessions (shifts 1/2/3).
  // Sessions starting on previous days (e.g. Shift 3 running until 08:00 or 09:00 AM
  // on the next day) contribute their overlapping duration to the next day's coverage.

  const TOTAL_DAY_MINUTES = 1440;

  // Query raw session intervals — only shifts 1/2/3 contribute to coverage.
  // Active sessions (logout_at IS NULL) use SYSTIMESTAMP as their effective end.
  const result = await connection.execute<DbRow>(
    `SELECT TRUNC(s.shift_date) AS shift_date,
            s.shift_number,
            s.login_at,
            NVL(s.logout_at, SYSTIMESTAMP) AS effective_logout
     FROM app_shift_sessions s
     ${whereClause}
     ${whereClause ? "AND" : "WHERE"} s.shift_number IN (1, 2, 3)
     ORDER BY TRUNC(s.shift_date) ASC, s.login_at ASC`,
    binds
  );

  interface ProcessedSession {
    shiftDateStr: string;
    shiftNumber: number;
    loginAt: Date;
    logoutAt: Date;
    loginMs: number;
    logoutMs: number;
  }

  // Convert Date (read as UTC by node-oracledb) to linear IST wall-clock epoch ms.
  function getIstWallClockMs(d: Date): number {
    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds()
    );
  }

  const allSessions: ProcessedSession[] = [];
  const dateKeysSet = new Set<string>();

  for (const row of result.rows || []) {
    const shiftDate = asDate(row.SHIFT_DATE);
    const loginAt = asDate(row.LOGIN_AT);
    const logoutAt = asDate(row.EFFECTIVE_LOGOUT);
    if (!shiftDate || !loginAt || !logoutAt) continue;

    const shiftDateStr = toOracleDateString(shiftDate);
    const loginMs = getIstWallClockMs(loginAt);
    const logoutMs = getIstWallClockMs(logoutAt);

    allSessions.push({
      shiftDateStr,
      shiftNumber: Number(row.SHIFT_NUMBER),
      loginAt,
      logoutAt,
      loginMs,
      logoutMs
    });

    dateKeysSet.add(shiftDateStr);
  }

  // Helper: merge a sorted array of [start, end] intervals.
  function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
    if (intervals.length === 0) return [];
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1];
      if (intervals[i][0] <= last[1]) {
        last[1] = Math.max(last[1], intervals[i][1]);
      } else {
        merged.push(intervals[i]);
      }
    }
    return merged;
  }

  const rows: ShiftReportData["coverage"] = [];

  for (const dateKey of dateKeysSet) {
    // If fromDate filter was specified, ignore context dates prior to fromDate
    if (filters?.fromDate && dateKey < filters.fromDate) {
      continue;
    }
    if (filters?.toDate && dateKey > filters.toDate) {
      continue;
    }

    const [yyyy, mm, dd] = dateKey.split("-").map(Number);
    if (!yyyy || !mm || !dd) continue;

    // Daily window starts at 07:00 IST on dateKey and ends at 07:00 IST next day
    const windowStartMs = Date.UTC(yyyy, mm - 1, dd, 7, 0, 0);
    const windowEndMs = windowStartMs + TOTAL_DAY_MINUTES * 60 * 1000;

    const intervals: Array<[number, number]> = [];
    const shiftsPresent = new Set<number>();

    for (const sess of allSessions) {
      // Record shift presence for sessions logged under this specific shift date
      if (sess.shiftDateStr === dateKey) {
        shiftsPresent.add(sess.shiftNumber);
      }

      // Check if session overlaps with target day's 24-hour cycle (07:00 -> 07:00 next day)
      if (sess.loginMs < windowEndMs && sess.logoutMs > windowStartMs) {
        const overlapStartMs = Math.max(sess.loginMs, windowStartMs);
        const overlapEndMs = Math.min(sess.logoutMs, windowEndMs);

        const startMin = Math.max(0, Math.min(TOTAL_DAY_MINUTES, Math.round((overlapStartMs - windowStartMs) / 60000)));
        const endMin = Math.max(0, Math.min(TOTAL_DAY_MINUTES, Math.round((overlapEndMs - windowStartMs) / 60000)));

        if (endMin > startMin) {
          intervals.push([startMin, endMin]);
        }
      }
    }

    const merged = mergeIntervals(intervals);
    const coveredMinutes = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
    const gapMinutes = TOTAL_DAY_MINUTES - coveredMinutes;
    const coveragePct = Math.min(100, Math.round((coveredMinutes / TOTAL_DAY_MINUTES) * 100));

    // Determine which of the 3 shifts had zero logged sessions for dateKey
    const uncoveredShifts = [1, 2, 3].filter((sn) => !shiftsPresent.has(sn));

    rows.push({
      shift_date: dateKey,
      covered_minutes: coveredMinutes,
      gap_minutes: gapMinutes,
      coverage_pct: coveragePct,
      uncovered_shifts: uncoveredShifts
    });
  }

  // Sort by date descending.
  rows.sort((a, b) => (a.shift_date > b.shift_date ? -1 : a.shift_date < b.shift_date ? 1 : 0));
  return rows;
}

// ============================================================
// User Profile / Preferences â€” theme toggling
// ============================================================
//
// The app_user_preferences table stores per-user UI preferences.  Today the
// only persisted value is theme_preference ('light' | 'dark'), chosen from
// the navbar theme toggle.  The functions below are defensive: if the table
// has not been created yet (ORA-00942) they fall back to 'dark' so the rest
// of the app keeps working.

const DEFAULT_DB_INVENTORY_COLUMNS = [
  "division", "database_name", "environment", "db_version",
  "db_edition", "server_name", "server_ip", "db_port", "zone", "location",
  "operating_system", "database_type"
] as const;

const DB_INVENTORY_COLUMNS = new Set([
  ...DEFAULT_DB_INVENTORY_COLUMNS,
  "database_instance", "db_edition", "database_role", "server_type", "owner", "status", "enable_access"
]);

function normalizeDatabaseInventoryColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_DB_INVENTORY_COLUMNS];
  const columns = Array.from(new Set(value.filter((item): item is string => typeof item === "string" && DB_INVENTORY_COLUMNS.has(item))));
  return columns.length ? columns : [...DEFAULT_DB_INVENTORY_COLUMNS];
}

export async function getUserDatabaseInventoryColumns(userId: number): Promise<string[]> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT db_inventory_columns FROM app_user_preferences WHERE user_id = :userId`,
        { userId }
      );
      const value = result.rows?.[0]?.DB_INVENTORY_COLUMNS;
      if (!value) return [...DEFAULT_DB_INVENTORY_COLUMNS];
      try {
        return normalizeDatabaseInventoryColumns(JSON.parse(String(value)));
      } catch {
        return [...DEFAULT_DB_INVENTORY_COLUMNS];
      }
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) return [...DEFAULT_DB_INVENTORY_COLUMNS];
      throw error;
    }
  });
}

export async function upsertUserDatabaseInventoryColumns(userId: number, columns: unknown): Promise<string[]> {
  const normalized = normalizeDatabaseInventoryColumns(columns);
  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `MERGE INTO app_user_preferences dst
         USING (SELECT :userId AS user_id FROM dual) src
         ON (dst.user_id = src.user_id)
         WHEN MATCHED THEN UPDATE SET dst.db_inventory_columns = :columns
         WHEN NOT MATCHED THEN
           INSERT (user_id, theme_preference, db_inventory_columns)
           VALUES (src.user_id, 'dark', :columns2)`,
        { userId, columns: JSON.stringify(normalized), columns2: JSON.stringify(normalized) },
        { autoCommit: true }
      );
      return normalized;
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) return normalized;
      throw error;
    }
  });
}

function mapThemePreference(value: unknown): ThemePreference {
  const normalized = String(value || "light").trim().toLowerCase();
  if (normalized === "dark") return "dark";
  return "light";
}

/** Read a user's stored theme preference. Returns 'light' when no row exists. */
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
      if (!row) return "light";
      return mapThemePreference(row.THEME_PREFERENCE);
    } catch (error) {
      // Table missing (schema not migrated yet) — degrade gracefully.
      if (isOracleMissingTableError(error)) return "light";
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
      // Table missing â€” swallow so the UI toggle still works locally.
      if (isOracleMissingTableError(error)) return;
      throw error;
    }
  });
}


// ── Approval Workflow ────────────────────────────────────────────────────────

function mapApprovalRow(row: DbRow): ApprovalRequest {
  return {
    request_id:         String(row.REQUEST_ID),
    action_name:        String(row.ACTION_NAME),
    display_name:       String(row.DISPLAY_NAME),
    db_name:            String(row.DB_NAME),
    environment:        String(row.ENVIRONMENT),
    requester_user_id:  Number(row.REQUESTER_USER_ID),
    requester_username: String(row.REQUESTER_USERNAME),
    requester_email:    row.REQUESTER_EMAIL ? String(row.REQUESTER_EMAIL) : undefined,
    request_status:     String(row.REQUEST_STATUS) as ApprovalRequestStatus,
    risk_level:         String(row.RISK_LEVEL) as ApprovalRiskLevel,
    reviewer_user_id:   row.REVIEWER_USER_ID ? Number(row.REVIEWER_USER_ID) : undefined,
    reviewer_username:  row.REVIEWER_USERNAME ? String(row.REVIEWER_USERNAME) : undefined,
    reviewer_comment:   row.REVIEWER_COMMENT ? String(row.REVIEWER_COMMENT) : undefined,
    reviewed_at:        row.REVIEWED_AT ? toIstIsoString(row.REVIEWED_AT) : undefined,
    request_params:     row.REQUEST_PARAMS
      ? (() => { try { return JSON.parse(String(row.REQUEST_PARAMS)) as Record<string, unknown>; } catch { return undefined; } })()
      : undefined,
    execution_status:   row.EXECUTION_STATUS
      ? (String(row.EXECUTION_STATUS) as ApprovalRequest["execution_status"])
      : undefined,
    expires_at:         row.EXPIRES_AT ? toIstIsoString(row.EXPIRES_AT) : undefined,
    created_at:         toIstIsoString(row.CREATED_AT),
    updated_at:         toIstIsoString(row.UPDATED_AT)
  };
}

function mapApprovalHistoryRow(row: DbRow): ApprovalHistoryEvent {
  return {
    history_id:      Number(row.HISTORY_ID),
    request_id:      String(row.REQUEST_ID),
    event_type:      String(row.EVENT_TYPE) as ApprovalHistoryEventType,
    actor_user_id:   row.ACTOR_USER_ID ? Number(row.ACTOR_USER_ID) : undefined,
    actor_username:  String(row.ACTOR_USERNAME),
    comment_text:    row.COMMENT_TEXT ? String(row.COMMENT_TEXT) : undefined,
    snapshot_status: String(row.SNAPSHOT_STATUS) as ApprovalRequestStatus,
    metadata:        row.METADATA_JSON
      ? (() => { try { return JSON.parse(String(row.METADATA_JSON)) as Record<string, unknown>; } catch { return undefined; } })()
      : undefined,
    created_at:      toIstIsoString(row.CREATED_AT)
  };
}

const APPROVAL_SELECT = `
  SELECT r.request_id, r.action_name, r.display_name, r.db_name, r.environment,
         r.requester_user_id, r.requester_username, r.request_status, r.risk_level,
         r.reviewer_user_id, r.reviewer_username, r.reviewer_comment, r.reviewed_at,
         r.request_params, r.execution_status, r.expires_at, r.created_at, r.updated_at,
         u.email AS requester_email
    FROM app_approval_requests r
    LEFT JOIN app_users u ON u.user_id = r.requester_user_id`;

/**
 * Returns true when the given action name is registered in app_protected_actions
 * with is_active = 'Y'. Degrades gracefully if the migration has not yet been run.
 */
export async function isProtectedAction(actionName: string): Promise<boolean> {
  return Boolean(await getProtectedAction(actionName));
}

export interface ProtectedActionRecord {
  action_name: string;
  display_name: string;
  risk_level: ApprovalRiskLevel;
}

/**
 * Loads a single protected-action registry row (display name + risk level) so
 * the approval workflow uses ONE source of truth — the seeded
 * `app_protected_actions` table — instead of re-deriving risk level from the
 * action catalog. Returns null when the action is not registered, inactive, or
 * the migration has not yet been installed.
 */
export async function getProtectedAction(actionName: string): Promise<ProtectedActionRecord | null> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT action_name, display_name, risk_level
           FROM app_protected_actions
          WHERE UPPER(action_name) = UPPER(:actionName)
            AND is_active = 'Y'`,
        { actionName }
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return {
        action_name:   String(row.ACTION_NAME),
        display_name:  String(row.DISPLAY_NAME),
        risk_level:    String(row.RISK_LEVEL) as ApprovalRiskLevel
      };
    } catch (error) {
      if (isOracleMissingTableError(error)) return null;
      throw error;
    }
  });
}

/**
 * Find an existing pending approval request for the same action / db /
 * requester so that a repeated submission (double-click, retry, retry after
 * network drop) does NOT create a duplicate pending row. The first pending
 * request is returned so the caller can respond idempotently.
 *
 * When `paramsSignature` is provided (used by the dynamic `query` action so
 * that distinct destructive SQL statements each get their own request), the
 * search additionally requires that the `request_params` CLOB contains the
 * signature text — mirroring the `DBMS_LOB.INSTR` dedup pattern already used
 * by `insertAuditLog`.
 */
export async function findPendingApprovalRequest(input: {
  actionName: string;
  dbName: string;
  requesterUserId: number;
  paramsSignature?: string;
}): Promise<ApprovalRequest | null> {
  return executeOne(async (connection) => {
    try {
      const binds: BindParameters = {
        actionName:      input.actionName,
        dbName:          input.dbName,
        requesterUserId: input.requesterUserId
      };
      const lobFilter = input.paramsSignature
        ? "AND DBMS_LOB.INSTR(request_params, :paramsSignature) > 0"
        : "";
      if (input.paramsSignature) {
        (binds as Record<string, unknown>).paramsSignature = input.paramsSignature;
      }

      const result = await connection.execute<DbRow>(
        `${APPROVAL_SELECT}
          WHERE r.action_name        = :actionName
            AND r.db_name            = :dbName
            AND r.requester_user_id  = :requesterUserId
            AND r.request_status     = 'pending'
            ${lobFilter}
          ORDER BY r.created_at DESC
          FETCH FIRST 1 ROW ONLY`,
        binds
      );
      const row = result.rows?.[0];
      return row ? mapApprovalRow(row) : null;
    } catch (error) {
      if (isOracleMissingTableError(error)) return null;
      throw error;
    }
  });
}

export interface InsertApprovalRequestInput {
  requestId: string;
  actionName: string;
  displayName: string;
  dbName: string;
  environment: string;
  requesterUserId: number;
  requesterUsername: string;
  riskLevel: string;
  webhookPayload: string;  // frozen JSON — replayed verbatim on approval
  requestParams?: string;  // human-readable JSON for the admin UI
}

export async function insertApprovalRequest(input: InsertApprovalRequestInput): Promise<ApprovalRequest> {
  return executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO app_approval_requests (
         request_id, action_name, display_name, db_name, environment,
         requester_user_id, requester_username, request_status, risk_level,
         webhook_payload, request_params
       ) VALUES (
         :requestId, :actionName, :displayName, :dbName, :environment,
         :requesterUserId, :requesterUsername, 'pending', :riskLevel,
         :webhookPayload, :requestParams
       )`,
      {
        requestId:         input.requestId,
        actionName:        input.actionName,
        displayName:       input.displayName,
        dbName:            input.dbName,
        environment:       input.environment,
        requesterUserId:   input.requesterUserId,
        requesterUsername: input.requesterUsername,
        riskLevel:         input.riskLevel,
        webhookPayload:    input.webhookPayload,
        requestParams:     input.requestParams ?? null
      },
      { autoCommit: false }
    );

    await connection.execute(
      `INSERT INTO app_approval_history (
         request_id, event_type, actor_user_id, actor_username, snapshot_status
       ) VALUES (:requestId, 'requested', :actorUserId, :actorUsername, 'pending')`,
      {
        requestId:    input.requestId,
        actorUserId:  input.requesterUserId,
        actorUsername: input.requesterUsername
      },
      { autoCommit: true }
    );

    const result = await connection.execute<DbRow>(
      `${APPROVAL_SELECT} WHERE r.request_id = :requestId`,
      { requestId: input.requestId }
    );
    return mapApprovalRow(result.rows![0]);
  });
}

export async function getApprovalRequest(requestId: string): Promise<ApprovalRequest | null> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `${APPROVAL_SELECT} WHERE r.request_id = :requestId`,
        { requestId }
      );
      const row = result.rows?.[0];
      return row ? mapApprovalRow(row) : null;
    } catch (error) {
      if (isOracleMissingTableError(error)) return null;
      throw error;
    }
  });
}

/** Read the raw frozen webhook_payload CLOB for a request. */
export async function getApprovalWebhookPayload(requestId: string): Promise<string | null> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT webhook_payload FROM app_approval_requests WHERE request_id = :requestId`,
        { requestId }
      );
      const row = result.rows?.[0];
      return row ? String(row.WEBHOOK_PAYLOAD) : null;
    } catch (error) {
      if (isOracleMissingTableError(error)) return null;
      throw error;
    }
  });
}

export async function listApprovalRequests(input: {
  status?: string;
  search?: string;
  action?: string;
  dbName?: string;
  requester?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
  requesterUserId?: number;
}): Promise<{
  items: ApprovalRequest[];
  total: number;
  counts: { pending: number; approved: number; rejected: number };
  options: {
    actions: string[];
    databases: string[];
    requesters: string[];
  };
}> {
  const limit  = Math.min(Math.max(input.limit  ?? 50, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);

  return executeOne(async (connection) => {
    try {
      const queryBinds: BindParameters = { limit, offset };
      const countBinds: BindParameters = {};
      const conditions: string[] = [];

      if (input.status) {
        conditions.push(`r.request_status = :status`);
        (queryBinds as Record<string, unknown>).status = input.status;
        (countBinds as Record<string, unknown>).status = input.status;
      }

      if (typeof input.requesterUserId === "number") {
        conditions.push(`r.requester_user_id = :requesterUserId`);
        (queryBinds as Record<string, unknown>).requesterUserId = input.requesterUserId;
        (countBinds as Record<string, unknown>).requesterUserId = input.requesterUserId;
      }

      if (input.search && input.search.trim()) {
        const term = `%${input.search.trim().toLowerCase()}%`;
        conditions.push(
          `(LOWER(r.display_name) LIKE :searchTerm OR LOWER(r.action_name) LIKE :searchTerm OR LOWER(r.db_name) LIKE :searchTerm OR LOWER(r.requester_username) LIKE :searchTerm OR LOWER(r.environment) LIKE :searchTerm)`
        );
        (queryBinds as Record<string, unknown>).searchTerm = term;
        (countBinds as Record<string, unknown>).searchTerm = term;
      }

      if (input.action && input.action.trim()) {
        conditions.push(`(UPPER(r.action_name) = UPPER(:actionVal) OR UPPER(r.display_name) = UPPER(:actionVal))`);
        (queryBinds as Record<string, unknown>).actionVal = input.action.trim();
        (countBinds as Record<string, unknown>).actionVal = input.action.trim();
      }

      if (input.dbName && input.dbName.trim()) {
        conditions.push(`UPPER(r.db_name) = UPPER(:dbNameVal)`);
        (queryBinds as Record<string, unknown>).dbNameVal = input.dbName.trim();
        (countBinds as Record<string, unknown>).dbNameVal = input.dbName.trim();
      }

      if (input.requester && input.requester.trim()) {
        conditions.push(`UPPER(r.requester_username) = UPPER(:requesterVal)`);
        (queryBinds as Record<string, unknown>).requesterVal = input.requester.trim();
        (countBinds as Record<string, unknown>).requesterVal = input.requester.trim();
      }

      if (input.fromDate && input.fromDate.trim()) {
        conditions.push(`r.created_at >= TO_TIMESTAMP(:fromDateVal || ' 00:00:00', 'YYYY-MM-DD HH24:MI:SS')`);
        (queryBinds as Record<string, unknown>).fromDateVal = input.fromDate.trim();
        (countBinds as Record<string, unknown>).fromDateVal = input.fromDate.trim();
      }

      if (input.toDate && input.toDate.trim()) {
        conditions.push(`r.created_at <= TO_TIMESTAMP(:toDateVal || ' 23:59:59', 'YYYY-MM-DD HH24:MI:SS')`);
        (queryBinds as Record<string, unknown>).toDateVal = input.toDate.trim();
        (countBinds as Record<string, unknown>).toDateVal = input.toDate.trim();
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ``;

      const countResult = await connection.execute<DbRow>(
        `SELECT COUNT(*) AS total FROM app_approval_requests r ${whereClause}`,
        countBinds
      );
      const total = Number(countResult.rows?.[0]?.TOTAL ?? 0);

      const countsResult = await connection.execute<DbRow>(
        `SELECT
           SUM(CASE WHEN request_status = 'pending' THEN 1 ELSE 0 END) AS pending_cnt,
           SUM(CASE WHEN request_status = 'approved' THEN 1 ELSE 0 END) AS approved_cnt,
           SUM(CASE WHEN request_status = 'rejected' THEN 1 ELSE 0 END) AS rejected_cnt
         FROM app_approval_requests`
      );
      const countsRow = countsResult.rows?.[0] ?? {};
      const counts = {
        pending: Number(countsRow.PENDING_CNT ?? 0),
        approved: Number(countsRow.APPROVED_CNT ?? 0),
        rejected: Number(countsRow.REJECTED_CNT ?? 0)
      };

      const optionsResult = await connection.execute<DbRow>(
        `SELECT DISTINCT display_name, db_name, requester_username FROM app_approval_requests`
      );
      const actionsSet = new Set<string>();
      const dbsSet = new Set<string>();
      const requestersSet = new Set<string>();

      (optionsResult.rows ?? []).forEach((row) => {
        if (row.DISPLAY_NAME) actionsSet.add(String(row.DISPLAY_NAME));
        if (row.DB_NAME) dbsSet.add(String(row.DB_NAME));
        if (row.REQUESTER_USERNAME) requestersSet.add(String(row.REQUESTER_USERNAME));
      });

      const options = {
        actions: Array.from(actionsSet).sort(),
        databases: Array.from(dbsSet).sort(),
        requesters: Array.from(requestersSet).sort()
      };

      const result = await connection.execute<DbRow>(
        `${APPROVAL_SELECT}
         ${whereClause}
         ORDER BY
           CASE r.request_status WHEN 'pending' THEN 0 ELSE 1 END,
           r.created_at DESC
         OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
        queryBinds
      );

      return { items: (result.rows ?? []).map(mapApprovalRow), total, counts, options };
    } catch (error) {
      if (isOracleMissingTableError(error)) return {
        items: [],
        total: 0,
        counts: { pending: 0, approved: 0, rejected: 0 },
        options: { actions: [], databases: [], requesters: [] }
      };
      throw error;
    }
  });
}

export async function updateApprovalDecision(input: {
  requestId: string;
  decision: "approved" | "rejected";
  reviewerUserId: number;
  reviewerUsername: string;
  comment?: string;
}): Promise<ApprovalRequest | null> {
  return executeOne(async (connection) => {
    const update = await connection.execute(
      `UPDATE app_approval_requests
          SET request_status    = :decision,
              reviewer_user_id  = :reviewerUserId,
              reviewer_username = :reviewerUsername,
              reviewer_comment  = :commentText,
              reviewed_at       = SYSTIMESTAMP
        WHERE request_id     = :requestId
          AND request_status = 'pending'`,
      {
        decision:         input.decision,
        reviewerUserId:   input.reviewerUserId,
        reviewerUsername: input.reviewerUsername,
        commentText:      input.comment ?? null,
        requestId:        input.requestId
      },
      { autoCommit: false }
    );

    // rowsAffected === 0 means the request was already approved/rejected
    // (concurrent reviewer or a stale retry). Bail out WITHOUT writing a
    // phantom history row or dispatching the webhook a second time.
    if (!update.rowsAffected) {
      await connection.rollback();
      return null;
    }

    const eventType: ApprovalHistoryEventType = input.decision === "approved" ? "approved" : "rejected";
    await connection.execute(
      `INSERT INTO app_approval_history (
         request_id, event_type, actor_user_id, actor_username,
         comment_text, snapshot_status
       ) VALUES (:requestId, :eventType, :actorUserId, :actorUsername, :commentText, :snapshotStatus)`,
      {
        requestId:      input.requestId,
        eventType,
        actorUserId:    input.reviewerUserId,
        actorUsername:  input.reviewerUsername,
        commentText:    input.comment ?? null,
        snapshotStatus: input.decision
      },
      { autoCommit: true }
    );

    return getApprovalRequest(input.requestId);
  });
}

export async function updateApprovalExecution(input: {
  requestId: string;
  executionStatus: "executing" | "success" | "failed";
  actorUsername: string;
  response?: unknown;
}): Promise<void> {
  return executeOne(async (connection) => {
    const responseJson = input.response ? JSON.stringify(input.response) : null;
    const update = await connection.execute(
      `UPDATE app_approval_requests
          SET execution_status   = :executionStatus,
              execution_response = :responseJson,
              executed_at        = CASE WHEN :executionStatus != 'executing'
                                        THEN SYSTIMESTAMP ELSE executed_at END
        WHERE request_id = :requestId`,
      {
        executionStatus: input.executionStatus,
        responseJson,
        requestId:       input.requestId
      },
      { autoCommit: false }
    );

    // No row matched — the request was removed (or never existed). Avoid
    // writing an orphan history row and abort the calling execution.
    if (!update.rowsAffected) {
      await connection.rollback();
      throw new Error(`Approval request ${input.requestId} not found while recording execution status.`);
    }

    const eventType: ApprovalHistoryEventType =
      input.executionStatus === "executing" ? "executing" :
      input.executionStatus === "success"   ? "executed"  : "execute_failed";

    await connection.execute(
      `INSERT INTO app_approval_history (
         request_id, event_type, actor_user_id, actor_username,
         snapshot_status, metadata_json
       ) VALUES (:requestId, :eventType, NULL, :actorUsername, 'approved', :metadataJson)`,
      {
        requestId:     input.requestId,
        eventType,
        actorUsername:  input.actorUsername,
        metadataJson:  responseJson
      },
      { autoCommit: true }
    );
  });
}

export async function getApprovalHistory(requestId: string): Promise<ApprovalHistoryEvent[]> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT history_id, request_id, event_type, actor_user_id, actor_username,
                comment_text, snapshot_status, metadata_json, created_at
           FROM app_approval_history
          WHERE request_id = :requestId
          ORDER BY created_at ASC`,
        { requestId }
      );
      return (result.rows ?? []).map(mapApprovalHistoryRow);
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      throw error;
    }
  });
}

export async function countPendingApprovals(): Promise<number> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT COUNT(*) AS cnt FROM app_approval_requests WHERE request_status = 'pending'`
      );
      return Number(result.rows?.[0]?.CNT ?? 0);
    } catch (error) {
      if (isOracleMissingTableError(error)) return 0;
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Data Pump Export (EXPDP) & Import (IMPDP) Templates Database Persistence
// ---------------------------------------------------------------------------

export async function listDataPumpExpdpTemplates(): Promise<ExpdpTemplate[]> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT template_id, template_name, database_name, created_by, created_at, params_json
           FROM datapump_expdp_templates
          ORDER BY created_at DESC`
      );
      return (result.rows ?? []).map((row) => {
        const rawJson = String(row.PARAMS_JSON || "{}");
        let parsedParams: Record<string, unknown> = {};
        try {
          parsedParams = JSON.parse(rawJson);
        } catch {
          parsedParams = {};
        }
        return {
          id: String(row.TEMPLATE_ID),
          name: String(row.TEMPLATE_NAME),
          db: String(row.DATABASE_NAME || ""),
          created_by: String(row.CREATED_BY || ""),
          created_at: toIstIsoString(row.CREATED_AT),
          params: parsedParams as unknown as ExpdpParams
        };
      });
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      throw error;
    }
  });
}

export async function createDataPumpExpdpTemplate(input: {
  name: string;
  db?: string;
  createdBy: string;
  params: ExpdpParams;
}): Promise<ExpdpTemplate> {
  return executeOne(async (connection) => {
    const paramsJson = JSON.stringify(input.params || {});
    const dumpTransferReq = input.params.dump_transfer_required === "yes" ? "yes" : "no";
    const transferServer = input.params.transfer_server || null;
    const compression = input.params.COMPRESSION || null;
    const schemasList = Array.isArray(input.params.SCHEMAS) ? input.params.SCHEMAS.join(",") : (input.params.SCHEMAS || null);

    const result = await connection.execute<{ templateId: number[] }>(
      `INSERT INTO datapump_expdp_templates (
         template_name, database_name, created_by, params_json,
         dump_transfer_req, transfer_server, compression, schemas_list
       ) VALUES (
         :name, :db, :createdBy, :paramsJson,
         :dumpTransferReq, :transferServer, :compression, :schemasList
       ) RETURNING template_id INTO :templateId`,
      {
        name: input.name,
        db: input.db || "",
        createdBy: input.createdBy,
        paramsJson,
        dumpTransferReq,
        transferServer,
        compression,
        schemasList,
        templateId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    const insertedId = result.outBinds?.templateId?.[0] ? String(result.outBinds.templateId[0]) : `EXPTPL-${Date.now()}`;
    return {
      id: insertedId,
      name: input.name,
      db: input.db || "",
      created_by: input.createdBy,
      created_at: new Date().toISOString(),
      params: input.params
    };
  });
}

export async function deleteDataPumpExpdpTemplate(id: string | number): Promise<boolean> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute(
        `DELETE FROM datapump_expdp_templates WHERE template_id = :id`,
        { id: Number(id) || id },
        { autoCommit: true }
      );
      return (result.rowsAffected ?? 0) > 0;
    } catch (error) {
      if (isOracleMissingTableError(error)) return false;
      throw error;
    }
  });
}

export async function listDataPumpImpdpTemplates(): Promise<ImpdpTemplate[]> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT template_id, template_name, database_name, created_by, created_at, params_json
           FROM datapump_impdp_templates
          ORDER BY created_at DESC`
      );
      return (result.rows ?? []).map((row) => {
        const rawJson = String(row.PARAMS_JSON || "{}");
        let parsedParams: Record<string, unknown> = {};
        try {
          parsedParams = JSON.parse(rawJson);
        } catch {
          parsedParams = {};
        }
        return {
          id: String(row.TEMPLATE_ID),
          name: String(row.TEMPLATE_NAME),
          db: String(row.DATABASE_NAME || ""),
          created_by: String(row.CREATED_BY || ""),
          created_at: toIstIsoString(row.CREATED_AT),
          params: parsedParams as unknown as ImpdpParams
        };
      });
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      throw error;
    }
  });
}

export async function createDataPumpImpdpTemplate(input: {
  name: string;
  db?: string;
  createdBy: string;
  params: ImpdpParams;
}): Promise<ImpdpTemplate> {
  return executeOne(async (connection) => {
    const paramsJson = JSON.stringify(input.params || {});
    const dropUser = input.params.drop_user === "no" ? "no" : "yes";
    const tableExistsAction = input.params.TABLE_EXISTS_ACTION || null;
    const contentType = input.params.CONTENT || null;
    const schemasList = Array.isArray(input.params.SCHEMAS) ? input.params.SCHEMAS.join(",") : (input.params.SCHEMAS || null);

    const result = await connection.execute<{ templateId: number[] }>(
      `INSERT INTO datapump_impdp_templates (
         template_name, database_name, created_by, params_json,
         drop_user, table_exists_action, content_type, schemas_list
       ) VALUES (
         :name, :db, :createdBy, :paramsJson,
         :dropUser, :tableExistsAction, :contentType, :schemasList
       ) RETURNING template_id INTO :templateId`,
      {
        name: input.name,
        db: input.db || "",
        createdBy: input.createdBy,
        paramsJson,
        dropUser,
        tableExistsAction,
        contentType,
        schemasList,
        templateId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    const insertedId = result.outBinds?.templateId?.[0] ? String(result.outBinds.templateId[0]) : `IMPTPL-${Date.now()}`;
    return {
      id: insertedId,
      name: input.name,
      db: input.db || "",
      created_by: input.createdBy,
      created_at: new Date().toISOString(),
      params: input.params
    };
  });
}

export async function deleteDataPumpImpdpTemplate(id: string | number): Promise<boolean> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute(
        `DELETE FROM datapump_impdp_templates WHERE template_id = :id`,
        { id: Number(id) || id },
        { autoCommit: true }
      );
      return (result.rowsAffected ?? 0) > 0;
    } catch (error) {
      if (isOracleMissingTableError(error)) return false;
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Data Pump Job History Database Operations (DATAPUMP_JOB_HISTORY)
// ---------------------------------------------------------------------------

export async function listDataPumpJobHistory(limit = 100, db?: string): Promise<DataPumpJob[]> {
  return executeOne(async (connection) => {
    try {
      const dbFilter = db?.trim() ? db.trim().toUpperCase() : null;
      const sql = dbFilter
        ? `SELECT job_id, operation, database_name, status, started_at, completed_at,
                DBMS_LOB.SUBSTR(dump_file, 500, 1) AS dump_file,
                DBMS_LOB.SUBSTR(transfer_status, 500, 1) AS transfer_status,
                DBMS_LOB.SUBSTR(message, 4000, 1) AS message,
                requested_by,
                DBMS_LOB.SUBSTR(params_json, 4000, 1) AS params_json
           FROM (
             SELECT * FROM datapump_job_history WHERE UPPER(database_name) = :dbFilter ORDER BY started_at DESC
           )
          WHERE ROWNUM <= :limit`
        : `SELECT job_id, operation, database_name, status, started_at, completed_at,
                DBMS_LOB.SUBSTR(dump_file, 500, 1) AS dump_file,
                DBMS_LOB.SUBSTR(transfer_status, 500, 1) AS transfer_status,
                DBMS_LOB.SUBSTR(message, 4000, 1) AS message,
                requested_by,
                DBMS_LOB.SUBSTR(params_json, 4000, 1) AS params_json
           FROM (
             SELECT * FROM datapump_job_history ORDER BY started_at DESC
           )
          WHERE ROWNUM <= :limit`;
      const binds = dbFilter ? { limit, dbFilter } : { limit };
      const result = await connection.execute<DbRow>(sql, binds);
      return (result.rows ?? []).map((row) => {
        const rawParams = String(row.PARAMS_JSON || "{}");
        let parsedParams: Record<string, unknown> = {};
        try {
          parsedParams = JSON.parse(rawParams);
        } catch {
          parsedParams = {};
        }
        return {
          id: String(row.JOB_ID),
          operation: String(row.OPERATION).toLowerCase() as DataPumpOperation,
          db: String(row.DATABASE_NAME || ""),
          status: String(row.STATUS).toLowerCase() as DataPumpJobStatus,
          started_at: toIsoString(row.STARTED_AT),
          completed_at: row.COMPLETED_AT ? toIsoString(row.COMPLETED_AT) : undefined,
          dump_file: row.DUMP_FILE ? String(row.DUMP_FILE) : undefined,
          transfer_status: row.TRANSFER_STATUS ? String(row.TRANSFER_STATUS) : undefined,
          message: row.MESSAGE ? String(row.MESSAGE) : undefined,
          requested_by: row.REQUESTED_BY ? String(row.REQUESTED_BY) : undefined,
          params: parsedParams
        };
      });
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      console.error("[listDataPumpJobHistory] Oracle DB Error:", error);
      throw error;
    }
  });
}

export async function listActiveDataPumpJobs(db?: string): Promise<DataPumpJob[]> {
  return executeOne(async (connection) => {
    try {
      const dbFilter = db?.trim() ? db.trim().toUpperCase() : null;
      const sql = dbFilter
        ? `SELECT job_id, operation, database_name, status, started_at, completed_at,
                DBMS_LOB.SUBSTR(dump_file, 500, 1) AS dump_file,
                DBMS_LOB.SUBSTR(transfer_status, 500, 1) AS transfer_status,
                DBMS_LOB.SUBSTR(message, 4000, 1) AS message,
                requested_by,
                DBMS_LOB.SUBSTR(params_json, 4000, 1) AS params_json
           FROM datapump_job_history
          WHERE LOWER(status) = 'running' AND UPPER(database_name) = :dbFilter
          ORDER BY started_at DESC
          FETCH FIRST 200 ROWS ONLY`
        : `SELECT job_id, operation, database_name, status, started_at, completed_at,
                DBMS_LOB.SUBSTR(dump_file, 500, 1) AS dump_file,
                DBMS_LOB.SUBSTR(transfer_status, 500, 1) AS transfer_status,
                DBMS_LOB.SUBSTR(message, 4000, 1) AS message,
                requested_by,
                DBMS_LOB.SUBSTR(params_json, 4000, 1) AS params_json
           FROM datapump_job_history
          WHERE LOWER(status) = 'running'
          ORDER BY started_at DESC
          FETCH FIRST 200 ROWS ONLY`;
      const binds = dbFilter ? { dbFilter } : {};
      const result = await connection.execute<DbRow>(sql, binds);
      return (result.rows ?? []).map((row) => {
        const rawParams = String(row.PARAMS_JSON || "{}");
        let parsedParams: Record<string, unknown> = {};
        try {
          parsedParams = JSON.parse(rawParams);
        } catch {
          parsedParams = {};
        }
        return {
          id: String(row.JOB_ID),
          operation: String(row.OPERATION).toLowerCase() as DataPumpOperation,
          db: String(row.DATABASE_NAME || ""),
          status: String(row.STATUS).toLowerCase() as DataPumpJobStatus,
          started_at: toIsoString(row.STARTED_AT),
          completed_at: row.COMPLETED_AT ? toIsoString(row.COMPLETED_AT) : undefined,
          dump_file: row.DUMP_FILE ? String(row.DUMP_FILE) : undefined,
          transfer_status: row.TRANSFER_STATUS ? String(row.TRANSFER_STATUS) : undefined,
          message: row.MESSAGE ? String(row.MESSAGE) : undefined,
          requested_by: row.REQUESTED_BY ? String(row.REQUESTED_BY) : undefined,
          params: parsedParams
        };
      });
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      console.error("[listActiveDataPumpJobs] Oracle DB Error:", error);
      throw error;
    }
  });
}

export async function upsertDataPumpJobHistory(job: DataPumpJob): Promise<void> {
  return executeOne(async (connection) => {
    try {
      const jobIdStr = String(job.id || `JOB-${Date.now()}`).slice(0, 50);
      const operationVal = String(job.operation || "expdp").toLowerCase().slice(0, 10);
      const dbName = String(job.db || "DEFAULT").trim().slice(0, 50) || "DEFAULT";
      const statusVal = String(job.status || "running").toLowerCase().slice(0, 20);
      const requestedBy = String(job.requested_by || "dba").slice(0, 50);
      const paramsJson = JSON.stringify(job.params || {});

      const startedAtIso = (job.started_at ? new Date(job.started_at) : new Date()).toISOString();
      const completedAtIso = job.completed_at ? new Date(job.completed_at).toISOString() : null;
      const dumpFile = job.dump_file ? String(job.dump_file).slice(0, 500) : null;
      const transferStatus = job.transfer_status ? String(job.transfer_status).slice(0, 500) : null;
      const messageVal = job.message ? String(job.message) : null;

      // 1. Try UPDATE.
      //
      // NOTE: The `message` and `params_json` columns are CLOBs while the
      // incoming bind values are plain JavaScript strings (VARCHAR2). Oracle's
      // CASE / COALESCE expressions refuse to reconcile VARCHAR2 binds with
      // CLOB columns in their branches — the statement fails at parse time
      // with ORA-00932 ("inconsistent datatypes: expected CHAR got CLOB") and
      // the entire upsert is aborted before the INSERT fallback (below) ever
      // runs. That left DATA_PUMP_JOB_HISTORY permanently empty even though a
      // direct INSERT (without CASE/COALESCE) succeeds.
      //
      // Wrapping the binds in TO_CLOB() forces the value into the LOB type
      // family before the branch reconciliation so the assignment type-matches
      // the existing CLOB column. NULL values pass through TO_CLOB unchanged.
      const updateResult = await connection.execute(
        `UPDATE datapump_job_history
            SET status = :statusVal,
                completed_at = CASE WHEN :completedAtIso IS NOT NULL THEN TO_TIMESTAMP_TZ(:completedAtIso, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') ELSE completed_at END,
                dump_file = COALESCE(:dumpFile, dump_file),
                transfer_status = COALESCE(:transferStatus, transfer_status),
                message = COALESCE(TO_CLOB(:messageVal), message),
                params_json = CASE WHEN :paramsJson IS NOT NULL AND :paramsJson <> '{}' THEN TO_CLOB(:paramsJson) ELSE params_json END
          WHERE job_id = :jobId`,
        {
          jobId: jobIdStr,
          statusVal,
          completedAtIso,
          dumpFile,
          transferStatus,
          messageVal,
          paramsJson
        },
        { autoCommit: true }
      );

      // 2. If row does not exist, INSERT
      if ((updateResult.rowsAffected ?? 0) === 0) {
        await connection.execute(
          `INSERT INTO datapump_job_history (
             job_id, operation, database_name, status, started_at, completed_at,
             dump_file, transfer_status, message, requested_by, params_json
           ) VALUES (
             :jobId, :operationVal, :dbName, :statusVal,
             TO_TIMESTAMP_TZ(:startedAtIso, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
             CASE WHEN :completedAtIso IS NOT NULL THEN TO_TIMESTAMP_TZ(:completedAtIso, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') ELSE NULL END,
             :dumpFile, :transferStatus, :messageVal, :requestedBy, :paramsJson
           )`,
          {
            jobId: jobIdStr,
            operationVal,
            dbName,
            statusVal,
            startedAtIso,
            completedAtIso,
            dumpFile,
            transferStatus,
            messageVal,
            requestedBy,
            paramsJson
          },
          { autoCommit: true }
        );
      }
    } catch (error) {
      if (isOracleMissingTableError(error)) return;
      console.error("[upsertDataPumpJobHistory] Oracle DB Error:", error);
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// RMAN Job History Database Operations (APP_RMAN_JOB_HISTORY)
// ---------------------------------------------------------------------------

async function ensureRmanJobHistoryTable(connection: Connection): Promise<void> {
  try {
    await connection.execute(`
      CREATE TABLE app_rman_job_history (
        job_id          VARCHAR2(100)  NOT NULL PRIMARY KEY,
        database_name   VARCHAR2(50)   NOT NULL,
        backup_type     VARCHAR2(50)   DEFAULT 'FULL',
        status          VARCHAR2(20)   NOT NULL CHECK (status IN ('running','success','error','completed')),
        started_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        completed_at    TIMESTAMP WITH TIME ZONE,
        ai_summary      CLOB,
        raw_output      CLOB,
        params_json     CLOB,
        requested_by    VARCHAR2(100)
      )
    `);
  } catch {
    // Ignore table exists error
  }
}

export async function listRmanJobHistory(limit = 100, db?: string): Promise<RmanJob[]> {
  return executeOne(async (connection) => {
    try {
      const dbFilter = db?.trim() ? db.trim().toUpperCase() : null;
      const sql = dbFilter
        ? `SELECT job_id, database_name, backup_type, status, started_at, completed_at,
                ai_summary,
                raw_output,
                params_json,
                requested_by
           FROM (
             SELECT * FROM app_rman_job_history WHERE UPPER(database_name) = :dbFilter ORDER BY started_at DESC
           )
          WHERE ROWNUM <= :limit`
        : `SELECT job_id, database_name, backup_type, status, started_at, completed_at,
                ai_summary,
                raw_output,
                params_json,
                requested_by
           FROM (
             SELECT * FROM app_rman_job_history ORDER BY started_at DESC
           )
          WHERE ROWNUM <= :limit`;
      const binds = dbFilter ? { limit, dbFilter } : { limit };
      const result = await connection.execute<DbRow>(sql, binds);
      return (result.rows ?? []).map((row) => {
        const rawParams = String(row.PARAMS_JSON || "{}");
        let parsedParams: Record<string, unknown> = {};
        try {
          parsedParams = JSON.parse(rawParams);
        } catch {
          parsedParams = {};
        }
        const statusVal = String(row.STATUS || "running").toLowerCase();
        const normalizedStatus: RmanJobStatus = statusVal === "success" || statusVal === "completed" ? "success" : statusVal === "error" ? "error" : "running";
        const aiSummary = row.AI_SUMMARY ? String(row.AI_SUMMARY) : undefined;
        const rawOutput = row.RAW_OUTPUT ? String(row.RAW_OUTPUT) : undefined;

        return {
          id: String(row.JOB_ID),
          request_id: String(row.JOB_ID),
          db: String(row.DATABASE_NAME || ""),
          status: normalizedStatus,
          started_at: toIsoString(row.STARTED_AT),
          completed_at: row.COMPLETED_AT ? toIsoString(row.COMPLETED_AT) : undefined,
          requested_by: row.REQUESTED_BY ? String(row.REQUESTED_BY) : (parsedParams.requested_by ? String(parsedParams.requested_by) : undefined),
          params: { ...parsedParams, backup_type: row.BACKUP_TYPE ? String(row.BACKUP_TYPE) : parsedParams.backup_type || "FULL" },
          response: (aiSummary || rawOutput) ? {
            status: normalizedStatus === "error" ? "error" : "success",
            request_id: String(row.JOB_ID),
            action: "take_rman_backup",
            db_status: normalizedStatus === "success" ? "healthy" : "critical",
            ai_summary: aiSummary || "Execution completed.",
            findings: [],
            recommendations: [],
            raw_data: {},
            raw_output: rawOutput || ""
          } : undefined
        };
      });
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      console.error("[listRmanJobHistory] Oracle DB Error:", error);
      throw error;
    }
  });
}

export async function listActiveRmanJobs(db?: string): Promise<RmanJob[]> {
  return executeOne(async (connection) => {
    try {
      const dbFilter = db?.trim() ? db.trim().toUpperCase() : null;
      const sql = dbFilter
        ? `SELECT job_id, database_name, backup_type, status, started_at, completed_at,
                ai_summary,
                raw_output,
                params_json,
                requested_by
           FROM app_rman_job_history
          WHERE LOWER(status) = 'running' AND UPPER(database_name) = :dbFilter
          ORDER BY started_at DESC
          FETCH FIRST 200 ROWS ONLY`
        : `SELECT job_id, database_name, backup_type, status, started_at, completed_at,
                ai_summary,
                raw_output,
                params_json,
                requested_by
           FROM app_rman_job_history
          WHERE LOWER(status) = 'running'
          ORDER BY started_at DESC
          FETCH FIRST 200 ROWS ONLY`;
      const binds = dbFilter ? { dbFilter } : {};
      const result = await connection.execute<DbRow>(sql, binds);
      return (result.rows ?? []).map((row) => {
        const rawParams = String(row.PARAMS_JSON || "{}");
        let parsedParams: Record<string, unknown> = {};
        try {
          parsedParams = JSON.parse(rawParams);
        } catch {
          parsedParams = {};
        }
        return {
          id: String(row.JOB_ID),
          request_id: String(row.JOB_ID),
          db: String(row.DATABASE_NAME || ""),
          status: "running",
          started_at: toIsoString(row.STARTED_AT),
          completed_at: row.COMPLETED_AT ? toIsoString(row.COMPLETED_AT) : undefined,
          requested_by: row.REQUESTED_BY ? String(row.REQUESTED_BY) : (parsedParams.requested_by ? String(parsedParams.requested_by) : undefined),
          params: { ...parsedParams, backup_type: row.BACKUP_TYPE ? String(row.BACKUP_TYPE) : parsedParams.backup_type || "FULL" }
        };
      });
    } catch (error) {
      if (isOracleMissingTableError(error)) return [];
      console.error("[listActiveRmanJobs] Oracle DB Error:", error);
      throw error;
    }
  });
}

export async function upsertRmanJobHistory(job: RmanJob): Promise<void> {
  return executeOne(async (connection) => {
    try {
      await ensureRmanJobHistoryTable(connection);

      const jobIdStr = String(job.request_id || job.id || `RMAN-${Date.now()}`).slice(0, 100);
      const dbName = String(job.db || "DEFAULT").trim().slice(0, 50) || "DEFAULT";
      const backupType = String(job.params?.backup_type ?? "FULL").slice(0, 50);
      const statusVal = String(job.status || "running").toLowerCase().slice(0, 20);
      const requestedBy = String(job.requested_by || job.params?.requested_by || "dba").slice(0, 100);
      const paramsJson = JSON.stringify(job.params || {});

      const startedAtIso = (job.started_at ? new Date(job.started_at) : new Date()).toISOString();
      const completedAtIso = job.completed_at ? new Date(job.completed_at).toISOString() : null;
      const aiSummary = job.response?.ai_summary ? String(job.response.ai_summary) : job.error ? String(job.error) : null;
      const rawOutput = job.response?.raw_output ? String(job.response.raw_output) : null;

      const updateResult = await connection.execute(
        `UPDATE app_rman_job_history
            SET status = :statusVal,
                completed_at = CASE WHEN :completedAtIso IS NOT NULL THEN TO_TIMESTAMP_TZ(:completedAtIso, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') ELSE completed_at END,
                ai_summary = COALESCE(TO_CLOB(:aiSummary), ai_summary),
                raw_output = COALESCE(TO_CLOB(:rawOutput), raw_output),
                params_json = CASE WHEN :paramsJson IS NOT NULL AND :paramsJson <> '{}' THEN TO_CLOB(:paramsJson) ELSE params_json END,
                requested_by = CASE WHEN :requestedBy IS NOT NULL AND :requestedBy <> 'dba' THEN :requestedBy ELSE requested_by END
          WHERE job_id = :jobId`,
        {
          jobId: jobIdStr,
          statusVal,
          completedAtIso,
          aiSummary,
          rawOutput,
          paramsJson,
          requestedBy
        },
        { autoCommit: true }
      );

      if ((updateResult.rowsAffected ?? 0) === 0) {
        await connection.execute(
          `INSERT INTO app_rman_job_history (
             job_id, database_name, backup_type, status, started_at, completed_at,
             ai_summary, raw_output, params_json, requested_by
           ) VALUES (
             :jobId, :dbName, :backupType, :statusVal,
             TO_TIMESTAMP_TZ(:startedAtIso, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
             CASE WHEN :completedAtIso IS NOT NULL THEN TO_TIMESTAMP_TZ(:completedAtIso, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') ELSE NULL END,
             :aiSummary, :rawOutput, :paramsJson, :requestedBy
           )`,
          {
            jobId: jobIdStr,
            dbName,
            backupType,
            statusVal,
            startedAtIso,
            completedAtIso,
            aiSummary,
            rawOutput,
            paramsJson,
            requestedBy
          },
          { autoCommit: true }
        );
      }
    } catch (error) {
      if (isOracleMissingTableError(error)) return;
      console.error("[upsertRmanJobHistory] Oracle DB Error:", error);
      throw error;
    }
  });
}

// ============================================================
// Database Monitoring — Availability Incidents
// ============================================================

function mapMonitoringIncidentRow(row: DbRow): MonitoringIncident {
  const status = String(row.INCIDENT_STATUS || "DOWN").toUpperCase();
  return {
    incident_id: String(row.INCIDENT_ID),
    db_name: String(row.DB_NAME),
    status: (status === "DOWN" || status === "ACKNOWLEDGED" || status === "RESOLVED" ? status : "DOWN") as MonitoringIncidentStatus,
    first_reported: toIstIsoString(row.FIRST_REPORTED),
    last_reported: toIstIsoString(row.LAST_REPORTED),
    report_count: Number(row.REPORT_COUNT || 1),
    acknowledged_by: row.ACKNOWLEDGED_BY ? String(row.ACKNOWLEDGED_BY) : undefined,
    acknowledged_at: row.ACKNOWLEDGED_AT ? toIstIsoString(row.ACKNOWLEDGED_AT) : undefined,
    resolved_at: row.RESOLVED_AT ? toIstIsoString(row.RESOLVED_AT) : undefined,
    created_at: toIstIsoString(row.CREATED_AT),
    updated_at: toIstIsoString(row.UPDATED_AT),
    is_read: String(row.IS_READ || "N").toUpperCase() === "Y",
    read: String(row.IS_READ || "N").toUpperCase() === "Y"
  };
}

/**
 * Find an active (DOWN or ACKNOWLEDGED) monitoring incident for the given database.
 * Used for deduplication: ensures only 1 card per database on the General Admin page.
 */
export async function findActiveMonitoringIncident(dbName: string): Promise<MonitoringIncident | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT * FROM app_db_monitoring_incidents
       WHERE UPPER(db_name) = UPPER(:dbName)
         AND incident_status IN ('DOWN', 'ACKNOWLEDGED')
       ORDER BY last_reported DESC
       FETCH FIRST 1 ROWS ONLY`,
      { dbName }
    );
    const row = result.rows?.[0];
    return row ? mapMonitoringIncidentRow(row) : null;
  });
}

/**
 * Get a monitoring incident by ID.
 */
export async function getMonitoringIncident(incidentId: string): Promise<MonitoringIncident | null> {
  return executeOne(async (connection) => {
    const result = await connection.execute<DbRow>(
      `SELECT * FROM app_db_monitoring_incidents WHERE incident_id = :incidentId`,
      { incidentId }
    );
    const row = result.rows?.[0];
    return row ? mapMonitoringIncidentRow(row) : null;
  });
}

/**
 * Create a new monitoring incident.
 */
export async function insertMonitoringIncident(input: {
  id: string;
  dbName: string;
}): Promise<MonitoringIncident> {
  await executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO app_db_monitoring_incidents (
         incident_id, db_name, incident_status, first_reported, last_reported, report_count
       ) VALUES (
         :incidentId, :dbName, 'DOWN', SYSTIMESTAMP, SYSTIMESTAMP, 1
       )`,
      { incidentId: input.id, dbName: input.dbName },
      { autoCommit: true }
    );
  });

  const incident = await getMonitoringIncident(input.id);
  if (!incident) {
    throw new Error(`Unable to read monitoring incident after insert: ${input.id}`);
  }
  return incident;
}

/**
 * Update the status of a monitoring incident (e.g. ACKNOWLEDGED or RESOLVED).
 */
export async function updateMonitoringIncidentStatus(
  incidentId: string,
  status: MonitoringIncidentStatus,
  actor?: string
): Promise<MonitoringIncident | null> {
  await executeOne(async (connection) => {
    if (status === "ACKNOWLEDGED" && actor) {
      await connection.execute(
        `UPDATE app_db_monitoring_incidents
         SET incident_status = :status,
             acknowledged_by = :actor,
             acknowledged_at = SYSTIMESTAMP
         WHERE incident_id = :incidentId`,
        { status, actor, incidentId },
        { autoCommit: true }
      );
    } else if (status === "RESOLVED") {
      await connection.execute(
        `UPDATE app_db_monitoring_incidents
         SET incident_status = :status,
             resolved_at = SYSTIMESTAMP
         WHERE incident_id = :incidentId`,
        { status, incidentId },
        { autoCommit: true }
      );
    } else {
      await connection.execute(
        `UPDATE app_db_monitoring_incidents
         SET incident_status = :status
         WHERE incident_id = :incidentId`,
        { status, incidentId },
        { autoCommit: true }
      );
    }
  });

  return getMonitoringIncident(incidentId);
}

/**
 * Bump the report count and last_reported timestamp for an existing incident
 * when a duplicate DOWN notification is received.
 */
export async function bumpMonitoringIncidentReportCount(incidentId: string): Promise<void> {
  await executeOne(async (connection) => {
    await connection.execute(
      `UPDATE app_db_monitoring_incidents
       SET report_count = report_count + 1,
           last_reported = SYSTIMESTAMP
       WHERE incident_id = :incidentId`,
      { incidentId },
      { autoCommit: true }
    );
  });
}

/**
 * List all active (DOWN or ACKNOWLEDGED) monitoring incidents, optionally filtered by dbName, ordered by last_reported DESC.
 */
export async function listActiveMonitoringIncidents(dbName?: string): Promise<MonitoringIncident[]> {
  return executeOne(async (connection) => {
    let sql = `SELECT incident_id, db_name, incident_status, first_reported, last_reported,
                      report_count, acknowledged_by, acknowledged_at, resolved_at, created_at,
                      updated_at, is_read
               FROM app_db_monitoring_incidents
               WHERE incident_status IN ('DOWN', 'ACKNOWLEDGED')`;
    const binds: BindParameters = {};

    if (dbName && dbName.trim()) {
      sql += ` AND UPPER(db_name) = UPPER(:dbName)`;
      binds.dbName = dbName.trim();
    }

    sql += ` ORDER BY last_reported DESC FETCH FIRST 200 ROWS ONLY`;
    const result = await connection.execute<DbRow>(sql, binds);
    return (result.rows || []).map(mapMonitoringIncidentRow);
  });
}

/**
 * List all monitoring incidents (historical & active), optionally filtered by dbName, ordered by last_reported DESC.
 */
export async function listAllMonitoringIncidents(limit: number = 200, dbName?: string): Promise<MonitoringIncident[]> {
  return executeOne(async (connection) => {
    let sql = `SELECT * FROM app_db_monitoring_incidents`;
    const binds: BindParameters = { limit };

    if (dbName && dbName.trim()) {
      sql += ` WHERE UPPER(db_name) = UPPER(:dbName)`;
      binds.dbName = dbName.trim();
    }

    sql += ` ORDER BY last_reported DESC, created_at DESC FETCH FIRST :limit ROWS ONLY`;
    const result = await connection.execute<DbRow>(sql, binds);
    return (result.rows || []).map(mapMonitoringIncidentRow);
  });
}

export interface ListNotificationHistoryInput {
  page?: number;
  pageSize?: number;
  category?: "all" | "db" | "console";
  type?: "all" | "tablespace" | "filesystem_drive" | "db_monitoring" | "approval_workflow" | "alert_log" | "dba_shift" | "database_start" | "database_stop" | "listener_start" | "listener_stop" | "expdp" | "impdp" | "datapump" | "rman" | "other";
  severity?: "all" | "critical" | "error" | "warning" | "info";
  status?: "all" | "pending_approval" | "approved" | "rejected" | "completed" | "failed" | "acknowledged" | "active";
  db?: string;
  dateRange?: "today" | "7d" | "30d" | "custom";
  startDate?: string;
  endDate?: string;
  search?: string;
}

export interface HistoricalNotificationItem {
  id: string;
  type: string;
  category: "db" | "console";
  severity: "info" | "warning" | "critical" | "error";
  status?: string;
  db?: string;
  title: string;
  message: string;
  timestamp: string;
  updatedAt?: string;
  targetPath?: string;
  read?: boolean;
  readBy?: string;
  readAt?: string;
}

export interface ListNotificationHistoryResult {
  items: HistoricalNotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

let migrationChecked = false;

export async function ensureNotificationReadColumnsExist(): Promise<void> {
  if (migrationChecked) return;

  try {
    await executeOne(async (connection) => {
      const tables = [
        "app_alert_notifications",
        "app_db_monitoring_incidents",
        "app_approval_requests",
        "app_shift_sessions",
        "app_handovers"
      ];

      for (const table of tables) {
        const statements = [
          `ALTER TABLE ${table} ADD (is_read VARCHAR2(1) DEFAULT 'N')`,
          `ALTER TABLE ${table} ADD (read_at TIMESTAMP)`,
          `ALTER TABLE ${table} ADD (read_by VARCHAR2(100))`
        ];
        if (table === "app_shift_sessions") {
          statements.push(
            `ALTER TABLE app_shift_sessions ADD (logout_is_read VARCHAR2(1) DEFAULT 'N')`,
            `ALTER TABLE app_shift_sessions ADD (logout_read_at TIMESTAMP)`,
            `ALTER TABLE app_shift_sessions ADD (logout_read_by VARCHAR2(100))`,
            `ALTER TABLE app_shift_sessions ADD (emergency_comment VARCHAR2(1000 CHAR))`,
            `ALTER TABLE app_shift_sessions ADD (force_close_comment VARCHAR2(1000 CHAR))`,
            `ALTER TABLE app_shift_sessions ADD (force_closed_by VARCHAR2(128 CHAR))`
          );
        }
        for (const stmt of statements) {
          try {
            await connection.execute(stmt, [], { autoCommit: true });
          } catch {
            // Ignore ORA-01430 column exists errors
          }
        }
      }
    });
    migrationChecked = true;
  } catch {
    // Ignore migration runner error and retry on next call
  }
}

export async function listNotificationHistory(input: ListNotificationHistoryInput = {}): Promise<ListNotificationHistoryResult> {
  await ensureNotificationReadColumnsExist();

  const page = Math.max(input.page || 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize || 25, 1), 100);
  const offset = (page - 1) * pageSize;

  const category = input.category || "all";
  const typeFilter = input.type && input.type !== "all" ? input.type : null;
  const severityFilter = input.severity && input.severity !== "all" ? input.severity : null;
  const statusFilter = input.status && input.status !== "all" ? input.status : null;
  const dbFilter = input.db ? input.db.trim() : null;
  const searchFilter = input.search ? input.search.trim().toLowerCase() : null;

  return executeOne(async (connection) => {
    // 1. Fetch items from app_alert_notifications
    const alertWhere: string[] = ["alert_type != 'datafile_extend'"];
    const alertBinds: BindParameters = {};

    if (category === "console") {
      alertWhere.push("alert_type = 'dba_shift'");
    } else if (category === "db") {
      alertWhere.push("alert_type != 'dba_shift'");
    }

    if (typeFilter) {
      alertWhere.push("alert_type = :alertType");
      alertBinds.alertType = typeFilter;
    }

    if (severityFilter) {
      alertWhere.push("severity = :severity");
      alertBinds.severity = severityFilter;
    }

    if (statusFilter) {
      alertWhere.push("alert_status = :statusFilter");
      alertBinds.statusFilter = statusFilter;
    }

    if (dbFilter) {
      alertWhere.push("UPPER(db_name) LIKE UPPER(:dbFilter)");
      alertBinds.dbFilter = `%${dbFilter}%`;
    }

    if (searchFilter) {
      alertWhere.push("(LOWER(message_text) LIKE :searchFilter OR LOWER(db_name) LIKE :searchFilter OR LOWER(tablespace_name) LIKE :searchFilter OR LOWER(object_name) LIKE :searchFilter)");
      alertBinds.searchFilter = `%${searchFilter}%`;
    }

    if (input.dateRange === "today") {
      alertWhere.push("created_at >= TRUNC(SYSDATE)");
    } else if (input.dateRange === "7d") {
      alertWhere.push("created_at >= SYSDATE - 7");
    } else if (input.dateRange === "30d") {
      alertWhere.push("created_at >= SYSDATE - 30");
    } else if (input.dateRange === "custom" && input.startDate && input.endDate) {
      alertWhere.push("created_at >= TO_TIMESTAMP(:startDate, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') AND created_at <= TO_TIMESTAMP(:endDate, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"')");
      alertBinds.startDate = input.startDate;
      alertBinds.endDate = input.endDate;
    }

    const alertWhereSql = alertWhere.length ? `WHERE ${alertWhere.join(" AND ")}` : "";

    const alertRowsRes = await connection.execute<DbRow>(
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
         created_at,
         updated_at,
         is_read,
         read_at,
         read_by
       FROM app_alert_notifications
       ${alertWhereSql}
       ORDER BY created_at DESC
       FETCH FIRST 2000 ROWS ONLY`,
      alertBinds
    );

    const alertItems: HistoricalNotificationItem[] = (alertRowsRes.rows || []).map((row) => {
      const rawType = String(row.ALERT_TYPE || "generic");
      const isConsole = rawType === "dba_shift";
      const id = String(row.ALERT_ID || "");
      const db = row.DB_NAME ? String(row.DB_NAME) : undefined;
      const severity = (row.SEVERITY ? String(row.SEVERITY).toLowerCase() : "info") as HistoricalNotificationItem["severity"];
      const rawStatus = row.ALERT_STATUS ? String(row.ALERT_STATUS) : undefined;
      const status = rawType === "db_monitoring" && (rawStatus === "pending_approval" || !rawStatus) ? "DOWN" : rawStatus;
      const timestamp = row.CREATED_AT ? toIstIsoString(row.CREATED_AT) : new Date().toISOString();
      const updatedAt = row.UPDATED_AT ? toIstIsoString(row.UPDATED_AT) : undefined;
      const message = String(row.MESSAGE_TEXT || "");
      const read = String(row.IS_READ || "N").toUpperCase() === "Y";
      const readBy = row.READ_BY ? String(row.READ_BY) : undefined;
      const readAt = row.READ_AT ? toIstIsoString(row.READ_AT) : undefined;

      const sourceName = String(row.SOURCE_NAME || "").toLowerCase();
      let type = rawType;

      if (rawType === "generic" || !rawType) {
        const isImpdp = id.includes("impdp") || /\bimpdp\b/i.test(message);
        const isExpdp = id.includes("expdp") || /\bexpdp\b/i.test(message);
        const isDatapump = isImpdp || isExpdp || sourceName === "datapump" || id.startsWith("DP-");
        const isRman = sourceName === "rman" || id.startsWith("RMAN-") || /\brman\b/i.test(message);
        const isDbStart = id.startsWith("DB-START-");
        const isDbStop = id.startsWith("DB-STOP-");
        const isLsnrStart = id.startsWith("LSNR-START-");
        const isLsnrStop = id.startsWith("LSNR-STOP-");

        type = isImpdp
          ? "impdp"
          : isExpdp
          ? "expdp"
          : isDatapump
          ? "datapump"
          : isRman
          ? "rman"
          : isDbStart
          ? "database_start"
          : isDbStop
          ? "database_stop"
          : isLsnrStart
          ? "listener_start"
          : isLsnrStop
          ? "listener_stop"
          : rawType;
      }

      let targetPath = "/dashboard";
      if (type === "tablespace") targetPath = "/tablespaces";
      else if (type === "filesystem_drive") targetPath = "/filesystem-drive";
      else if (type === "alert_log") targetPath = "/alerts";
      else if (
        type === "db_monitoring" ||
        type === "database_start" ||
        type === "database_stop" ||
        type === "listener_start" ||
        type === "listener_stop"
      ) targetPath = "/general-admin";
      else if (type === "approval_workflow") targetPath = "/admin-panel/pending-approvals";
      else if (type === "dba_shift") targetPath = "/dba-console/shift-management";
      else if (type === "datapump" || type === "expdp" || type === "impdp") targetPath = "/data-pump";
      else if (type === "rman") targetPath = "/backups";

      let title = `Alert: ${db || "System"}`;
      if (type === "tablespace") title = `Tablespace Alert: ${row.TABLESPACE_NAME || db || ""}`;
      else if (type === "filesystem_drive") title = `Filesystem Alert: ${row.OBJECT_NAME || db || ""}`;
      else if (type === "db_monitoring") {
        const isUp = status === "completed" || status === "UP" || status === "resolved";
        title = isUp ? `Database Online: ${db || ""}` : `DB Monitoring Incident: ${db || ""}`;
      }
      else if (type === "database_start") {
        const isFailed = (status || "").toLowerCase() === "failed";
        title = isFailed ? `Database Start Failed: ${db || ""}` : `Database Started: ${db || ""}`;
      }
      else if (type === "database_stop") {
        const isFailed = (status || "").toLowerCase() === "failed";
        title = isFailed ? `Database Stop Failed: ${db || ""}` : `Database Stopped: ${db || ""}`;
      }
      else if (type === "listener_start") {
        const isFailed = (status || "").toLowerCase() === "failed";
        title = isFailed ? `Listener Start Failed: ${db || ""}` : `Listener Started: ${db || ""}`;
      }
      else if (type === "listener_stop") {
        const isFailed = (status || "").toLowerCase() === "failed";
        title = isFailed ? `Listener Stop Failed: ${db || ""}` : `Listener Stopped: ${db || ""}`;
      }
      else if (type === "approval_workflow") title = `Approval Request: ${db || ""}`;
      else if (type === "dba_shift") title = row.OBJECT_NAME ? String(row.OBJECT_NAME) : `DBA Console Event`;
      else if (type === "impdp") {
        const st = (status || "").toLowerCase();
        if (st === "completed" || st === "success") title = `IMPDP completed: ${db || ""}`;
        else if (st === "failed") title = `IMPDP failed: ${db || ""}`;
        else title = `IMPDP started: ${db || ""}`;
      }
      else if (type === "expdp") {
        const st = (status || "").toLowerCase();
        if (st === "completed" || st === "success") title = `EXPDP completed: ${db || ""}`;
        else if (st === "failed") title = `EXPDP failed: ${db || ""}`;
        else title = `EXPDP started: ${db || ""}`;
      }
      else if (type === "rman") {
        const st = (status || "").toLowerCase();
        if (st === "completed" || st === "success") title = `RMAN Backup completed: ${db || ""}`;
        else if (st === "failed") title = `RMAN Backup failed: ${db || ""}`;
        else title = `RMAN Backup started: ${db || ""}`;
      }

      return {
        id,
        type,
        category: isConsole ? "console" : "db",
        severity,
        status,
        db,
        title,
        message,
        timestamp,
        updatedAt,
        targetPath,
        read,
        readBy,
        readAt
      };
    });

    // Note: Monitoring incidents (app_db_monitoring_incidents) are NOT added here separately.
    // They are already included in alertItems via app_alert_notifications (alert_type='db_monitoring').
    // Including them again would create phantom duplicates that cannot be properly mark-read.

    // 3. Fetch DBA Console Activities (shift sessions & handovers) if category is 'all' or 'console'
    const consoleItems: HistoricalNotificationItem[] = [];
    if (category !== "db" && (!typeFilter || typeFilter === "dba_shift")) {
      try {
        const sessionRes = await connection.execute<DbRow>(
          `SELECT session_id, username, shift_number, login_at, logout_at,
                  is_read, read_at, read_by,
                  logout_is_read, logout_read_at, logout_read_by
           FROM app_shift_sessions
           ORDER BY session_id DESC
           FETCH FIRST 500 ROWS ONLY`
        );
        for (const row of sessionRes.rows || []) {
          const username = String(row.USERNAME || "DBA");
          const shiftNum = Number(row.SHIFT_NUMBER || 1);
          const shiftLabel = `Shift ${shiftNum}`;
          const loginAt = row.LOGIN_AT ? toIstIsoString(row.LOGIN_AT) : new Date().toISOString();
          const isRead = String(row.IS_READ || "N").toUpperCase() === "Y";
          const readBy = row.READ_BY ? String(row.READ_BY) : undefined;
          const readAt = row.READ_AT ? toIstIsoString(row.READ_AT) : undefined;

          consoleItems.push({
            id: `DBA-LOGIN-${row.SESSION_ID}`,
            type: "dba_shift",
            category: "console",
            severity: "info",
            db: shiftLabel,
            title: `DBA Login: ${username}`,
            message: `${username} logged in to ${shiftLabel}.`,
            timestamp: loginAt,
            targetPath: "/dba-console/shift-management",
            read: isRead,
            readBy,
            readAt
          });

          if (row.LOGOUT_AT) {
            const logoutAt = toIstIsoString(row.LOGOUT_AT);
            const logoutIsRead = String(row.LOGOUT_IS_READ || "N").toUpperCase() === "Y";
            const logoutReadBy = row.LOGOUT_READ_BY ? String(row.LOGOUT_READ_BY) : undefined;
            const logoutReadAt = row.LOGOUT_READ_AT ? toIstIsoString(row.LOGOUT_READ_AT) : undefined;

            consoleItems.push({
              id: `DBA-LOGOUT-${row.SESSION_ID}`,
              type: "dba_shift",
              category: "console",
              severity: "info",
              db: shiftLabel,
              title: `DBA Logout: ${username}`,
              message: `${username} logged out from ${shiftLabel}.`,
              timestamp: logoutAt,
              targetPath: "/dba-console/shift-management",
              read: logoutIsRead,
              readBy: logoutReadBy,
              readAt: logoutReadAt
            });
          }
        }
      } catch {
        // Ignore shift sessions query error
      }

      try {
        const handoverRes = await connection.execute<DbRow>(
          `SELECT handover_id, author_username, shift_number, handover_text, status, created_at, is_read, read_at, read_by
           FROM app_handovers
           ORDER BY handover_id DESC
           FETCH FIRST 500 ROWS ONLY`
        );
        for (const row of handoverRes.rows || []) {
          const author = String(row.AUTHOR_USERNAME || "DBA");
          const shiftNum = Number(row.SHIFT_NUMBER || 1);
          const shiftLabel = `Shift ${shiftNum}`;
          const status = String(row.STATUS || "PENDING");
          const createdAt = row.CREATED_AT ? toIstIsoString(row.CREATED_AT) : new Date().toISOString();
          const text = stripHtmlText(row.HANDOVER_TEXT ? String(row.HANDOVER_TEXT) : "");
          const isRead = String(row.IS_READ || "N").toUpperCase() === "Y";
          const readBy = row.READ_BY ? String(row.READ_BY) : undefined;
          const readAt = row.READ_AT ? toIstIsoString(row.READ_AT) : undefined;

          consoleItems.push({
            id: `HANDOVER-${row.HANDOVER_ID}`,
            type: "dba_shift",
            category: "console",
            severity: status === "PENDING" ? "warning" : "info",
            status,
            db: shiftLabel,
            title: `Shift Handover (${status}): ${author}`,
            message: text.slice(0, 150) || `Handover ${status.toLowerCase()} by ${author}.`,
            timestamp: createdAt,
            targetPath: "/dba-console/shift-management",
            read: isRead,
            readBy,
            readAt
          });
        }
      } catch {
        // Ignore handovers query error
      }
    }

    // Combine and deduplicate
    const allItemsMap = new Map<string, HistoricalNotificationItem>();
    const nowMs = Date.now();

    for (const item of [...alertItems, ...consoleItems]) {
      if (searchFilter) {
        const matchesSearch =
          item.title.toLowerCase().includes(searchFilter) ||
          item.message.toLowerCase().includes(searchFilter) ||
          (item.db && item.db.toLowerCase().includes(searchFilter));
        if (!matchesSearch) continue;
      }
      if (severityFilter && item.severity !== severityFilter) continue;
      if (statusFilter && item.status !== statusFilter) continue;

      const itemMs = new Date(item.timestamp).getTime();
      if (input.dateRange === "today") {
        const startOfTodayMs = new Date().setHours(0, 0, 0, 0);
        if (itemMs < startOfTodayMs) continue;
      } else if (input.dateRange === "7d") {
        if (itemMs < nowMs - 7 * 24 * 3600 * 1000) continue;
      } else if (input.dateRange === "30d") {
        if (itemMs < nowMs - 30 * 24 * 3600 * 1000) continue;
      } else if (input.dateRange === "custom" && input.startDate && input.endDate) {
        const startMs = new Date(input.startDate).getTime();
        const endMs = new Date(input.endDate).getTime();
        if (itemMs < startMs || itemMs > endMs) continue;
      }

      allItemsMap.set(item.id, item);
    }

    const sortedAll = Array.from(allItemsMap.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const total = sortedAll.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const paginatedItems = sortedAll.slice(offset, offset + pageSize);

    return {
      items: paginatedItems,
      total,
      page,
      pageSize,
      totalPages
    };
  });
}

/**
 * List recent DBA shift activities (logins, logouts, handovers) to populate initial replay notification streams.
 */
export async function listRecentShiftNotifications(limit: number = 30): Promise<NotificationPayload[]> {
  await ensureNotificationReadColumnsExist();

  return executeOne(async (connection) => {
    const items: NotificationPayload[] = [];

    // 1. Shift sessions (Logins / Logouts)
    try {
      const sessionRes = await connection.execute<DbRow>(
        `SELECT session_id, username, shift_number, login_at, logout_at,
                is_read, read_at, read_by,
                logout_is_read, logout_read_at, logout_read_by
         FROM app_shift_sessions
         ORDER BY session_id DESC
         FETCH FIRST :limit ROWS ONLY`,
        { limit }
      );
      for (const row of sessionRes.rows || []) {
        const username = String(row.USERNAME || "DBA");
        const shiftNum = Number(row.SHIFT_NUMBER || 1);
        const shiftLabel = `Shift ${shiftNum}`;
        const loginAt = row.LOGIN_AT ? toIstIsoString(row.LOGIN_AT) : new Date().toISOString();
        const isRead = String(row.IS_READ || "N").toUpperCase() === "Y";
        const readBy = row.READ_BY ? String(row.READ_BY) : undefined;
        const readAt = row.READ_AT ? toIstIsoString(row.READ_AT) : undefined;

        items.push({
          id: `DBA-LOGIN-${row.SESSION_ID}`,
          type: "dba_shift",
          severity: "info",
          db: shiftLabel,
          title: `DBA Login: ${username}`,
          message: `${username} logged in to ${shiftLabel}.`,
          timestamp: loginAt,
          targetPath: "/dba-console/shift-management",
          read: isRead,
          readBy,
          readAt
        });

        if (row.LOGOUT_AT) {
          const logoutAt = toIstIsoString(row.LOGOUT_AT);
          const logoutIsRead = String(row.LOGOUT_IS_READ || "N").toUpperCase() === "Y";
          const logoutReadBy = row.LOGOUT_READ_BY ? String(row.LOGOUT_READ_BY) : undefined;
          const logoutReadAt = row.LOGOUT_READ_AT ? toIstIsoString(row.LOGOUT_READ_AT) : undefined;

          items.push({
            id: `DBA-LOGOUT-${row.SESSION_ID}`,
            type: "dba_shift",
            severity: "info",
            db: shiftLabel,
            title: `DBA Logout: ${username}`,
            message: `${username} logged out from ${shiftLabel}.`,
            timestamp: logoutAt,
            targetPath: "/dba-console/shift-management",
            read: logoutIsRead,
            readBy: logoutReadBy,
            readAt: logoutReadAt
          });
        }
      }
    } catch {
      // Ignore shift sessions query error
    }

    // 2. Shift Handovers
    try {
      const handoverRes = await connection.execute<DbRow>(
        `SELECT handover_id, author_username, shift_number, handover_text, status, created_at, is_read, read_at, read_by
         FROM app_handovers
         ORDER BY handover_id DESC
         FETCH FIRST :limit ROWS ONLY`,
        { limit }
      );
      for (const row of handoverRes.rows || []) {
        const author = String(row.AUTHOR_USERNAME || "DBA");
        const shiftNum = Number(row.SHIFT_NUMBER || 1);
        const shiftLabel = `Shift ${shiftNum}`;
        const status = String(row.STATUS || "PENDING");
        const createdAt = row.CREATED_AT ? toIstIsoString(row.CREATED_AT) : new Date().toISOString();
        const text = stripHtmlText(row.HANDOVER_TEXT ? String(row.HANDOVER_TEXT) : "");
        const isRead = String(row.IS_READ || "N").toUpperCase() === "Y";
        const readBy = row.READ_BY ? String(row.READ_BY) : undefined;
        const readAt = row.READ_AT ? toIstIsoString(row.READ_AT) : undefined;

        items.push({
          id: `HANDOVER-${row.HANDOVER_ID}`,
          type: "dba_shift",
          severity: status === "PENDING" ? "warning" : "info",
          db: shiftLabel,
          title: `Shift Handover (${status}): ${author}`,
          message: text.slice(0, 120) || `Handover ${status.toLowerCase()} by ${author}.`,
          timestamp: createdAt,
          targetPath: "/dba-console/shift-management",
          read: isRead,
          readBy,
          readAt
        });
      }
    } catch {
      // Ignore handovers query error
    }

    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  });
}

/**
 * List recent approval requests from app_approval_requests so they can be replayed in notification streams.
 * Only returns pending requests for app_admin (decision notifications for requesters live in app_alert_notifications).
 */
export async function listRecentApprovalNotifications(
  limit: number = 30,
  options?: { userRole?: string; userId?: number; username?: string }
): Promise<NotificationPayload[]> {
  // dba_admin users do not receive pending approval requests; their decision alerts are in app_alert_notifications
  if (options?.userRole === "dba_admin") {
    return [];
  }

  await ensureNotificationReadColumnsExist();

  return executeOne(async (connection) => {
    try {
      const binds: Record<string, number | string> = { limit };

      const res = await connection.execute<DbRow>(
        `SELECT request_id, display_name, db_name, environment, requester_user_id, requester_username, request_status, created_at, is_read, read_at, read_by
         FROM app_approval_requests
         WHERE LOWER(request_status) = 'pending'
         ORDER BY created_at DESC
         FETCH FIRST :limit ROWS ONLY`,
        binds
      );

      const items: NotificationPayload[] = [];
      for (const row of res.rows || []) {
        const id = String(row.REQUEST_ID || "");
        const displayName = String(row.DISPLAY_NAME || "Action");
        const db = String(row.DB_NAME || "");
        const env = String(row.ENVIRONMENT || "");
        const username = String(row.REQUESTER_USERNAME || "DBA");
        const createdAt = row.CREATED_AT ? toIstIsoString(row.CREATED_AT) : new Date().toISOString();
        const isRead = String(row.IS_READ || "N").toUpperCase() === "Y";
        const readBy = row.READ_BY ? String(row.READ_BY) : undefined;
        const readAt = row.READ_AT ? toIstIsoString(row.READ_AT) : undefined;

        items.push({
          id,
          type: "approval_workflow",
          severity: "warning",
          db,
          title: "Approval Required",
          message: `${username} requested "${displayName}" on ${db}${env ? ` (${env})` : ""}`,
          timestamp: createdAt,
          targetPath: "/admin-panel/pending-approvals",
          read: isRead,
          readBy,
          readAt,
          targetRole: "app_admin"
        });
      }
      return items;
    } catch {
      return [];
    }
  });
}

export async function markNotificationReadInDb(id: string, actor: string = "system"): Promise<void> {
  await ensureNotificationReadColumnsExist();

  return executeOne(async (connection) => {
    if (id.startsWith("MON-")) {
      // Update app_alert_notifications for db_monitoring entries (inserted by webhook with MON- prefixed alert_id)
      await connection.execute(
        `UPDATE app_alert_notifications
         SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor
         WHERE alert_id = :id
           AND NVL(is_read, 'N') != 'Y'`,
        { actor, id },
        { autoCommit: true }
      );

      // Also update app_db_monitoring_incidents for legacy/incident-sourced MON- notifications
      // incident_id format: INC-DBNAME-... extracted after stripping MON-DBNAME- prefix
      const rawIncidentId = id.replace(/^MON-[^-]+-/, "");
      await connection.execute(
        `UPDATE app_db_monitoring_incidents
         SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor
         WHERE (incident_id = :rawIncidentId OR incident_id = :id)
           AND NVL(is_read, 'N') != 'Y'`,
        { actor, rawIncidentId, id },
        { autoCommit: true }
      );
      return;
    }

    if (id.startsWith("DBA-LOGIN-")) {
      const sessionIdStr = id.replace("DBA-LOGIN-", "");
      const sessionId = Number(sessionIdStr);
      if (!isNaN(sessionId)) {
        await connection.execute(
          `UPDATE app_shift_sessions
           SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor
           WHERE session_id = :sessionId
             AND NVL(is_read, 'N') != 'Y'`,
          { actor, sessionId },
          { autoCommit: true }
        );
        return;
      }
    }

    if (id.startsWith("DBA-LOGOUT-")) {
      const sessionIdStr = id.replace("DBA-LOGOUT-", "");
      const sessionId = Number(sessionIdStr);
      if (!isNaN(sessionId)) {
        await connection.execute(
          `UPDATE app_shift_sessions
           SET logout_is_read = 'Y', logout_read_at = SYSTIMESTAMP, logout_read_by = :actor
           WHERE session_id = :sessionId
             AND NVL(logout_is_read, 'N') != 'Y'`,
          { actor, sessionId },
          { autoCommit: true }
        );
        return;
      }
    }

    if (id.startsWith("HANDOVER-")) {
      const handoverId = Number(id.replace("HANDOVER-", ""));
      if (!isNaN(handoverId)) {
        await connection.execute(
          `UPDATE app_handovers
           SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor
           WHERE handover_id = :handoverId
             AND NVL(is_read, 'N') != 'Y'`,
          { actor, handoverId },
          { autoCommit: true }
        );
        return;
      }
    }

    if (id.startsWith("REQ-")) {
      try {
        await connection.execute(
          `UPDATE app_approval_requests
           SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor
           WHERE request_id = :id
             AND NVL(is_read, 'N') != 'Y'`,
          { actor, id },
          { autoCommit: true }
        );
      } catch {
        // Ignore table column error if any
      }
    }

    await connection.execute(
      `UPDATE app_alert_notifications
       SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor
       WHERE alert_id = :id
         AND NVL(is_read, 'N') != 'Y'`,
      { actor, id },
      { autoCommit: true }
    );
  });
}

export async function markAllNotificationsReadInDb(category: "db" | "console" | "all" = "all", actor: string = "system"): Promise<void> {
  await ensureNotificationReadColumnsExist();

  return executeOne(async (connection) => {
    if (category === "db" || category === "all") {
      await connection.execute(
        `UPDATE app_alert_notifications SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor WHERE NVL(is_read, 'N') != 'Y' AND NVL(alert_type, 'generic') != 'dba_shift'`,
        { actor },
        { autoCommit: true }
      );
      await connection.execute(
        `UPDATE app_db_monitoring_incidents SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor WHERE NVL(is_read, 'N') != 'Y'`,
        { actor },
        { autoCommit: true }
      );
      await connection.execute(
        `UPDATE app_approval_requests SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor WHERE NVL(is_read, 'N') != 'Y'`,
        { actor },
        { autoCommit: true }
      );
    }

    if (category === "console" || category === "all") {
      await connection.execute(
        `UPDATE app_alert_notifications SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor WHERE NVL(is_read, 'N') != 'Y' AND alert_type = 'dba_shift'`,
        { actor },
        { autoCommit: true }
      );
      await connection.execute(
        `UPDATE app_shift_sessions SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor WHERE NVL(is_read, 'N') != 'Y'`,
        { actor },
        { autoCommit: true }
      );
      await connection.execute(
        `UPDATE app_shift_sessions SET logout_is_read = 'Y', logout_read_at = SYSTIMESTAMP, logout_read_by = :actor WHERE logout_at IS NOT NULL AND NVL(logout_is_read, 'N') != 'Y'`,
        { actor },
        { autoCommit: true }
      );
      await connection.execute(
        `UPDATE app_handovers SET is_read = 'Y', read_at = SYSTIMESTAMP, read_by = :actor WHERE NVL(is_read, 'N') != 'Y'`,
        { actor },
        { autoCommit: true }
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reboot History — audit compliance snapshots for DB start / stop events
// ─────────────────────────────────────────────────────────────────────────────

export async function insertRebootHistory(input: {
  dbName: string;
  environment: string;
  eventType: RebootEventType;
  requestedBy: string;
  capturedAt: string;
  spfileValue: string;
  auditSysOps: string;
  auditTrail: string;
  dbNameParam: string;
  isCompliant: boolean;
  failureReasons?: string;
  shutdownOption?: string;
}): Promise<void> {
  const dbName         = String(input.dbName      || "").slice(0, 100);
  const environment    = String(input.environment  || "").slice(0, 20);
  const eventType      = String(input.eventType    || "").slice(0, 30) as RebootEventType;
  const requestedBy    = String(input.requestedBy  || "system").slice(0, 128);
  const capturedAt     = String(input.capturedAt   || "").slice(0, 50);
  const spfileValue    = String(input.spfileValue  || "").slice(0, 500);
  const auditSysOps    = String(input.auditSysOps  || "").slice(0, 50);
  const auditTrail     = String(input.auditTrail   || "").slice(0, 100);
  const dbNameParam    = String(input.dbNameParam   || "").slice(0, 100);
  const isCompliant    = input.isCompliant ? "Y" : "N";
  const failureReasons = input.failureReasons ? String(input.failureReasons).slice(0, 2000) : null;
  const shutdownOption = input.shutdownOption ? String(input.shutdownOption).slice(0, 30) : null;

  await executeOne(async (connection) => {
    await connection.execute(
      `INSERT INTO db_reboot_history
         (db_name, environment, event_type, requested_by,
          captured_at, spfile_value, audit_sys_ops,
          audit_trail, db_name_param, is_compliant,
          failure_reasons, shutdown_option)
       VALUES
         (:dbName, :environment, :eventType, :requestedBy,
          :capturedAt, :spfileValue, :auditSysOps,
          :auditTrail, :dbNameParam, :isCompliant,
          :failureReasons, :shutdownOption)`,
      {
        dbName,
        environment,
        eventType,
        requestedBy,
        capturedAt,
        spfileValue,
        auditSysOps,
        auditTrail,
        dbNameParam,
        isCompliant,
        failureReasons,
        shutdownOption
      },
      { autoCommit: true }
    );
  });
}

export async function listRebootHistory(
  db?: string,
  limit: number = 100,
  input: { startDate?: string; endDate?: string } = {}
): Promise<RebootHistoryItem[]> {
  return executeOne(async (connection) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    const conditions: string[] = [];
    const binds: BindParameters = { limit: safeLimit };

    if (db?.trim()) {
      conditions.push("UPPER(db_name) = :dbName");
      binds.dbName = db.trim().toUpperCase();
    }

    if (input.startDate) {
      conditions.push("created_at >= TO_DATE(:startDate, 'YYYY-MM-DD')");
      binds.startDate = input.startDate;
    }

    if (input.endDate) {
      conditions.push("created_at < TO_DATE(:endDate, 'YYYY-MM-DD') + 1");
      binds.endDate = input.endDate;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await connection.execute<DbRow>(
      `SELECT id, db_name, environment, event_type, requested_by,
              captured_at, spfile_value, audit_sys_ops, audit_trail,
              db_name_param, is_compliant, failure_reasons,
              shutdown_option, created_at
         FROM db_reboot_history
        ${whereClause}
        ORDER BY created_at DESC
        FETCH FIRST :limit ROWS ONLY`,
      binds
    );

    return (result.rows ?? []).map((row): RebootHistoryItem => ({
      id:              Number(row.ID),
      db_name:         String(row.DB_NAME || ""),
      environment:     String(row.ENVIRONMENT || ""),
      event_type:      String(row.EVENT_TYPE || "PRE_SHUTDOWN") as RebootEventType,
      requested_by:    String(row.REQUESTED_BY || ""),
      captured_at:     String(row.CAPTURED_AT || ""),
      spfile_value:    String(row.SPFILE_VALUE ?? ""),
      audit_sys_ops:   String(row.AUDIT_SYS_OPS || ""),
      audit_trail:     String(row.AUDIT_TRAIL || ""),
      db_name_param:   String(row.DB_NAME_PARAM || ""),
      is_compliant:    String(row.IS_COMPLIANT || "N") === "Y",
      failure_reasons: row.FAILURE_REASONS ? String(row.FAILURE_REASONS) : undefined,
      shutdown_option: row.SHUTDOWN_OPTION ? String(row.SHUTDOWN_OPTION) : undefined,
      created_at:      toIstIsoString(row.CREATED_AT)
    }));
  });
}

// ============================================================
// System Configuration & Performance Tuning Settings (app_admin)
// ============================================================

const DEFAULT_PERF_TREND_DAYS = 3;
let memoryPerfTrendDays = DEFAULT_PERF_TREND_DAYS;

export async function getPerformanceTrendDaysConfig(): Promise<number> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT config_value FROM app_system_config WHERE config_key = 'PERF_RUN_ALL_TREND_DAYS'`
      );
      const val = result.rows?.[0]?.CONFIG_VALUE ?? result.rows?.[0]?.config_value;
      if (!val) return memoryPerfTrendDays;
      const parsed = parseInt(String(val), 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 90) {
        memoryPerfTrendDays = parsed;
        return parsed;
      }
      return memoryPerfTrendDays;
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        return memoryPerfTrendDays;
      }
      throw error;
    }
  });
}

export async function setPerformanceTrendDaysConfig(days: number, updatedBy: string): Promise<number> {
  const normalized = Math.max(1, Math.min(90, Math.round(days)));
  memoryPerfTrendDays = normalized;
  return executeOne(async (connection) => {
    try {
      await connection.execute(
        `MERGE INTO app_system_config dst
         USING (SELECT 'PERF_RUN_ALL_TREND_DAYS' AS config_key FROM dual) src
         ON (dst.config_key = src.config_key)
         WHEN MATCHED THEN
           UPDATE SET dst.config_value = :cfgVal, dst.updated_by = :updatedBy, dst.updated_at = SYSTIMESTAMP
         WHEN NOT MATCHED THEN
           INSERT (config_key, config_value, description, updated_by)
           VALUES ('PERF_RUN_ALL_TREND_DAYS', :cfgVal2, 'Number of days of performance trend data sent to n8n on RUN ALL', :updatedBy2)`,
        {
          cfgVal: String(normalized),
          updatedBy: updatedBy,
          cfgVal2: String(normalized),
          updatedBy2: updatedBy
        },
        { autoCommit: true }
      );
      return normalized;
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        try {
          await connection.execute(`
            CREATE TABLE app_system_config (
              config_key    VARCHAR2(100) NOT NULL PRIMARY KEY,
              config_value  VARCHAR2(4000) NOT NULL,
              description   VARCHAR2(500),
              updated_by    VARCHAR2(100),
              updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
            )
          `);
          await connection.execute(
            `INSERT INTO app_system_config (config_key, config_value, description, updated_by)
             VALUES ('PERF_RUN_ALL_TREND_DAYS', :cfgVal, 'Number of days of performance trend data sent to n8n on RUN ALL', :updatedBy)`,
            { cfgVal: String(normalized), updatedBy: updatedBy },
            { autoCommit: true }
          );
        } catch {
          // Table creation or insert fallback handled in memory
        }
        return normalized;
      }
      throw error;
    }
  });
}

// ─── Security Posture Policy Configuration ─────────────────────────────────────

let memorySecurityPosturePolicy: SecurityPosturePolicyConfig = { ...DEFAULT_SECURITY_POSTURE_POLICY };

export async function getSecurityPosturePolicyConfig(): Promise<SecurityPosturePolicyConfig> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT config_key, config_value FROM app_system_config WHERE config_key IN (
          'SECURITY_POSTURE_OUTDATED_AFTER_MINUTES',
          'SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS',
          'SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS',
          'SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES'
        )`
      );
      const rows = result.rows || [];
      const configMap = new Map<string, string>();
      for (const row of rows) {
        const k = String(row.CONFIG_KEY ?? row.config_key ?? "");
        const v = String(row.CONFIG_VALUE ?? row.config_value ?? "");
        if (k) configMap.set(k.toUpperCase(), v);
      }

      const rawAfterMin = parseInt(configMap.get("SECURITY_POSTURE_OUTDATED_AFTER_MINUTES") || "", 10);
      const rawMaxSends = parseInt(configMap.get("SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS") || "", 10);
      const rawIntervalHours = parseInt(configMap.get("SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS") || "", 10);
      const rawCheckMin = parseInt(configMap.get("SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES") || "", 10);

      memorySecurityPosturePolicy = {
        outdatedAfterMinutes: Number.isFinite(rawAfterMin) && rawAfterMin > 0 ? rawAfterMin : memorySecurityPosturePolicy.outdatedAfterMinutes,
        outdatedWebhookMaxSends: Number.isFinite(rawMaxSends) && rawMaxSends > 0 ? rawMaxSends : memorySecurityPosturePolicy.outdatedWebhookMaxSends,
        outdatedWebhookIntervalHours: Number.isFinite(rawIntervalHours) && rawIntervalHours > 0 ? rawIntervalHours : memorySecurityPosturePolicy.outdatedWebhookIntervalHours,
        outdatedWebhookCheckIntervalMinutes: Number.isFinite(rawCheckMin) && rawCheckMin > 0 ? rawCheckMin : memorySecurityPosturePolicy.outdatedWebhookCheckIntervalMinutes
      };

      return { ...memorySecurityPosturePolicy };
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        return { ...memorySecurityPosturePolicy };
      }
      throw error;
    }
  });
}

export async function setSecurityPosturePolicyConfig(
  input: Partial<SecurityPosturePolicyConfig>,
  updatedBy: string
): Promise<SecurityPosturePolicyConfig> {
  const current = await getSecurityPosturePolicyConfig().catch(() => ({ ...memorySecurityPosturePolicy }));

  const nextOutdatedAfterMinutes = input.outdatedAfterMinutes !== undefined
    ? Math.max(1, Math.min(525600, Math.round(input.outdatedAfterMinutes)))
    : current.outdatedAfterMinutes;

  const nextMaxSends = input.outdatedWebhookMaxSends !== undefined
    ? Math.max(1, Math.min(100, Math.round(input.outdatedWebhookMaxSends)))
    : current.outdatedWebhookMaxSends;

  const nextIntervalHours = input.outdatedWebhookIntervalHours !== undefined
    ? Math.max(1, Math.min(720, Math.round(input.outdatedWebhookIntervalHours)))
    : current.outdatedWebhookIntervalHours;

  const nextCheckIntervalMinutes = input.outdatedWebhookCheckIntervalMinutes !== undefined
    ? Math.max(1, Math.min(1440, Math.round(input.outdatedWebhookCheckIntervalMinutes)))
    : current.outdatedWebhookCheckIntervalMinutes;

  const updatedConfig: SecurityPosturePolicyConfig = {
    outdatedAfterMinutes: nextOutdatedAfterMinutes,
    outdatedWebhookMaxSends: nextMaxSends,
    outdatedWebhookIntervalHours: nextIntervalHours,
    outdatedWebhookCheckIntervalMinutes: nextCheckIntervalMinutes
  };

  memorySecurityPosturePolicy = { ...updatedConfig };

  return executeOne(async (connection) => {
    const items = [
      {
        key: "SECURITY_POSTURE_OUTDATED_AFTER_MINUTES",
        val: String(updatedConfig.outdatedAfterMinutes),
        desc: "Age in minutes at which an active security posture report is considered outdated"
      },
      {
        key: "SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS",
        val: String(updatedConfig.outdatedWebhookMaxSends),
        desc: "Maximum number of overdue security posture webhook notifications sent per document"
      },
      {
        key: "SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS",
        val: String(updatedConfig.outdatedWebhookIntervalHours),
        desc: "Interval in hours between consecutive overdue security posture webhook notifications"
      },
      {
        key: "SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES",
        val: String(updatedConfig.outdatedWebhookCheckIntervalMinutes),
        desc: "Scheduler check interval in minutes for overdue security posture webhook notifications"
      }
    ];

    try {
      for (const item of items) {
        await connection.execute(
          `MERGE INTO app_system_config dst
           USING (SELECT :cfgKey AS config_key FROM dual) src
           ON (dst.config_key = src.config_key)
           WHEN MATCHED THEN
             UPDATE SET dst.config_value = :cfgVal, dst.updated_by = :updatedBy, dst.updated_at = SYSTIMESTAMP
           WHEN NOT MATCHED THEN
             INSERT (config_key, config_value, description, updated_by)
             VALUES (:cfgKey2, :cfgVal2, :cfgDesc, :updatedBy2)`,
          {
            cfgKey: item.key,
            cfgVal: item.val,
            updatedBy,
            cfgKey2: item.key,
            cfgVal2: item.val,
            cfgDesc: item.desc,
            updatedBy2: updatedBy
          },
          { autoCommit: false }
        );
      }
      await connection.commit();
      return { ...updatedConfig };
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        try {
          await connection.execute(`
            CREATE TABLE app_system_config (
              config_key    VARCHAR2(100) NOT NULL PRIMARY KEY,
              config_value  VARCHAR2(4000) NOT NULL,
              description   VARCHAR2(500),
              updated_by    VARCHAR2(100),
              updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
            )
          `);
          for (const item of items) {
            await connection.execute(
              `INSERT INTO app_system_config (config_key, config_value, description, updated_by)
               VALUES (:cfgKey, :cfgVal, :cfgDesc, :updatedBy)`,
              { cfgKey: item.key, cfgVal: item.val, cfgDesc: item.desc, updatedBy },
              { autoCommit: false }
            );
          }
          await connection.commit();
        } catch {
          // Table creation or insert fallback handled in memory
        }
        return { ...updatedConfig };
      }
      throw error;
    }
  });
}

// ─── Audit Log Retention Policy Configuration ────────────────────────────────

const DEFAULT_AUDIT_RETENTION_DAYS = 1095;
const DEFAULT_AUDIT_AUTO_PURGE = true;

let memoryAuditRetentionPolicy: AuditLogRetentionPolicyConfig = {
  retentionDays: DEFAULT_AUDIT_RETENTION_DAYS,
  autoPurgeEnabled: DEFAULT_AUDIT_AUTO_PURGE,
  lastPurgeAt: null,
  lastPurgedCount: 0
};

export async function getAuditRetentionPolicyConfig(): Promise<AuditLogRetentionPolicyConfig> {
  return executeOne(async (connection) => {
    try {
      const result = await connection.execute<DbRow>(
        `SELECT config_key, config_value FROM app_system_config WHERE config_key IN (
          'AUDIT_LOG_RETENTION_DAYS',
          'AUDIT_LOG_AUTO_PURGE_ENABLED',
          'AUDIT_LOG_LAST_PURGE_AT',
          'AUDIT_LOG_LAST_PURGED_COUNT'
        )`
      );
      const rows = result.rows || [];
      const configMap = new Map<string, string>();
      for (const row of rows) {
        const k = String(row.CONFIG_KEY ?? row.config_key ?? "");
        const v = String(row.CONFIG_VALUE ?? row.config_value ?? "");
        if (k) configMap.set(k.toUpperCase(), v);
      }

      const rawDays = parseInt(configMap.get("AUDIT_LOG_RETENTION_DAYS") || "", 10);
      const rawAutoPurge = configMap.get("AUDIT_LOG_AUTO_PURGE_ENABLED");
      const rawLastPurgeAt = configMap.get("AUDIT_LOG_LAST_PURGE_AT") || null;
      const rawLastPurgedCount = parseInt(configMap.get("AUDIT_LOG_LAST_PURGED_COUNT") || "0", 10);

      memoryAuditRetentionPolicy = {
        retentionDays: Number.isFinite(rawDays) && rawDays > 0 ? rawDays : memoryAuditRetentionPolicy.retentionDays,
        autoPurgeEnabled: rawAutoPurge !== undefined ? (rawAutoPurge.toUpperCase() === "TRUE" || rawAutoPurge.toUpperCase() === "Y" || rawAutoPurge === "1") : memoryAuditRetentionPolicy.autoPurgeEnabled,
        lastPurgeAt: rawLastPurgeAt || memoryAuditRetentionPolicy.lastPurgeAt,
        lastPurgedCount: Number.isFinite(rawLastPurgedCount) ? rawLastPurgedCount : memoryAuditRetentionPolicy.lastPurgedCount
      };

      return { ...memoryAuditRetentionPolicy };
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        return { ...memoryAuditRetentionPolicy };
      }
      throw error;
    }
  });
}

export async function setAuditRetentionPolicyConfig(
  input: Partial<AuditLogRetentionPolicyConfig>,
  updatedBy: string
): Promise<AuditLogRetentionPolicyConfig> {
  const current = await getAuditRetentionPolicyConfig().catch(() => ({ ...memoryAuditRetentionPolicy }));

  const nextRetentionDays = input.retentionDays !== undefined
    ? Math.max(365, Math.min(2555, Math.round(input.retentionDays)))
    : current.retentionDays;

  const nextAutoPurge = input.autoPurgeEnabled !== undefined
    ? Boolean(input.autoPurgeEnabled)
    : current.autoPurgeEnabled;

  const updatedConfig: AuditLogRetentionPolicyConfig = {
    ...current,
    retentionDays: nextRetentionDays,
    autoPurgeEnabled: nextAutoPurge
  };

  memoryAuditRetentionPolicy = { ...updatedConfig };

  return executeOne(async (connection) => {
    const items = [
      {
        key: "AUDIT_LOG_RETENTION_DAYS",
        val: String(updatedConfig.retentionDays),
        desc: "Retention period in days for application audit logs in APP_AUDIT_LOGS table"
      },
      {
        key: "AUDIT_LOG_AUTO_PURGE_ENABLED",
        val: updatedConfig.autoPurgeEnabled ? "TRUE" : "FALSE",
        desc: "Whether the background scheduler automatically purges audit logs older than retention period"
      }
    ];

    try {
      for (const item of items) {
        await connection.execute(
          `MERGE INTO app_system_config dst
           USING (SELECT :cfgKey AS config_key FROM dual) src
           ON (dst.config_key = src.config_key)
           WHEN MATCHED THEN
             UPDATE SET dst.config_value = :cfgVal, dst.updated_by = :updatedBy, dst.updated_at = SYSTIMESTAMP
           WHEN NOT MATCHED THEN
             INSERT (config_key, config_value, description, updated_by)
             VALUES (:cfgKey2, :cfgVal2, :cfgDesc, :updatedBy2)`,
          {
            cfgKey: item.key,
            cfgVal: item.val,
            updatedBy,
            cfgKey2: item.key,
            cfgVal2: item.val,
            cfgDesc: item.desc,
            updatedBy2: updatedBy
          },
          { autoCommit: false }
        );
      }
      await connection.commit();
      return { ...updatedConfig };
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        try {
          await connection.execute(`
            CREATE TABLE app_system_config (
              config_key    VARCHAR2(100) NOT NULL PRIMARY KEY,
              config_value  VARCHAR2(4000) NOT NULL,
              description   VARCHAR2(500),
              updated_by    VARCHAR2(100),
              updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
            )
          `);
          for (const item of items) {
            await connection.execute(
              `INSERT INTO app_system_config (config_key, config_value, description, updated_by)
               VALUES (:cfgKey, :cfgVal, :cfgDesc, :updatedBy)`,
              { cfgKey: item.key, cfgVal: item.val, cfgDesc: item.desc, updatedBy },
              { autoCommit: false }
            );
          }
          await connection.commit();
        } catch {
          // Fallback handled in memory
        }
        return { ...updatedConfig };
      }
      throw error;
    }
  });
}

export async function getAuditLogStats(): Promise<AuditLogStats> {
  const policy = await getAuditRetentionPolicyConfig();
  return executeOne(async (connection) => {
    try {
      const summaryResult = await connection.execute<DbRow>(
        `SELECT
           COUNT(*) AS total_count,
           MIN(created_at) AS oldest_log,
           MAX(created_at) AS newest_log
         FROM app_audit_logs`
      );
      const summaryRow = summaryResult.rows?.[0];
      const totalLogs = Number(summaryRow?.TOTAL_COUNT ?? summaryRow?.total_count ?? 0);
      const oldestDate = summaryRow?.OLDEST_LOG ?? summaryRow?.oldest_log;
      const newestDate = summaryRow?.NEWEST_LOG ?? summaryRow?.newest_log;

      let expiredLogsCount = 0;
      if (policy.retentionDays > 0) {
        const expiredResult = await connection.execute<DbRow>(
          `SELECT COUNT(*) AS expired_count
           FROM app_audit_logs
           WHERE created_at < SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')`,
          { days: policy.retentionDays }
        );
        expiredLogsCount = Number(expiredResult.rows?.[0]?.EXPIRED_COUNT ?? expiredResult.rows?.[0]?.expired_count ?? 0);
      }

      return {
        totalLogs,
        retentionDays: policy.retentionDays,
        autoPurgeEnabled: policy.autoPurgeEnabled,
        oldestLogTimestamp: oldestDate ? toIstIsoString(oldestDate) : null,
        newestLogTimestamp: newestDate ? toIstIsoString(newestDate) : null,
        expiredLogsCount,
        lastPurgeAt: policy.lastPurgeAt ?? null,
        lastPurgedCount: policy.lastPurgedCount ?? 0
      };
    } catch (error) {
      if (isOracleMissingTableError(error) || isOracleMissingColumnError(error)) {
        return {
          totalLogs: 0,
          retentionDays: policy.retentionDays,
          autoPurgeEnabled: policy.autoPurgeEnabled,
          oldestLogTimestamp: null,
          newestLogTimestamp: null,
          expiredLogsCount: 0,
          lastPurgeAt: policy.lastPurgeAt ?? null,
          lastPurgedCount: policy.lastPurgedCount ?? 0
        };
      }
      throw error;
    }
  });
}

export async function purgeExpiredAuditLogs(
  customRetentionDays?: number,
  actor: string = "system"
): Promise<{ deletedCount: number; retentionDays: number; lastPurgeAt: string }> {
  const policy = await getAuditRetentionPolicyConfig();
  const effectiveDays = customRetentionDays !== undefined && customRetentionDays > 0
    ? Math.max(365, Math.min(2555, Math.round(customRetentionDays)))
    : policy.retentionDays;

  return executeOne(async (connection) => {
    try {
      const deleteResult = await connection.execute<{ rowsAffected?: number }>(
        `DELETE FROM app_audit_logs
         WHERE created_at < SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')`,
        { days: effectiveDays },
        { autoCommit: false }
      );
      const deletedCount = deleteResult.rowsAffected || 0;
      const purgeTimestamp = new Date().toISOString();

      // Update APP_SYSTEM_CONFIG with last purge run stats
      const items = [
        {
          key: "AUDIT_LOG_LAST_PURGE_AT",
          val: purgeTimestamp,
          desc: "Timestamp of last audit log purge execution"
        },
        {
          key: "AUDIT_LOG_LAST_PURGED_COUNT",
          val: String(deletedCount),
          desc: "Number of audit log records removed during last purge execution"
        }
      ];

      for (const item of items) {
        await connection.execute(
          `MERGE INTO app_system_config dst
           USING (SELECT :cfgKey AS config_key FROM dual) src
           ON (dst.config_key = src.config_key)
           WHEN MATCHED THEN
             UPDATE SET dst.config_value = :cfgVal, dst.updated_by = :updatedBy, dst.updated_at = SYSTIMESTAMP
           WHEN NOT MATCHED THEN
             INSERT (config_key, config_value, description, updated_by)
             VALUES (:cfgKey2, :cfgVal2, :cfgDesc, :updatedBy2)`,
          {
            cfgKey: item.key,
            cfgVal: item.val,
            updatedBy: actor,
            cfgKey2: item.key,
            cfgVal2: item.val,
            cfgDesc: item.desc,
            updatedBy2: actor
          },
          { autoCommit: false }
        );
      }

      await connection.commit();

      memoryAuditRetentionPolicy.lastPurgeAt = purgeTimestamp;
      memoryAuditRetentionPolicy.lastPurgedCount = deletedCount;

      // Insert audit log entry for the purge action
      await insertAuditLog({
        actor,
        action: "purge_audit_logs",
        db: "GLOBAL",
        status: "success",
        detail: `Audit log retention cleanup executed (${actor}): purged ${deletedCount} logs older than ${effectiveDays} days.`,
        metadata: {
          purged_count: deletedCount,
          retention_days: effectiveDays,
          executed_by: actor,
          timestamp: purgeTimestamp
        }
      }).catch(() => {});

      return {
        deletedCount,
        retentionDays: effectiveDays,
        lastPurgeAt: purgeTimestamp
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      if (isOracleMissingTableError(error)) {
        return {
          deletedCount: 0,
          retentionDays: effectiveDays,
          lastPurgeAt: new Date().toISOString()
        };
      }
      throw error;
    }
  });
}


