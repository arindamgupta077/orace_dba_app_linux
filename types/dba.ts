export type DbaStatus = "healthy" | "warning" | "critical" | "unknown";

export type RequestStatus = "idle" | "loading" | "success" | "error" | "pending_approval";

export type AlertNotificationSeverity = "info" | "warning" | "critical" | "error";

export type AlertNotificationStatus = "pending_approval" | "approved" | "rejected" | "completed" | "failed" | "acknowledged";

export type AlertNotificationType = string;

export type AlertSqlApprovalDecision = "approved" | "rejected";

export type AlertSqlApprovalStatus = "pending" | AlertSqlApprovalDecision;

export interface AlertSqlApproval {
  status: AlertSqlApprovalStatus;
  sql_command: string;
  original_sql_command?: string;
  explanation?: string;
  warnings?: string[];
  database_info?: Record<string, unknown>;
  tablespace_metadata?: Array<Record<string, unknown>>;
  request?: Record<string, unknown>;
  callback_url?: string;
  approval_url?: string;
  reject_url?: string;
  callback_method?: "GET" | "POST";
  created_at?: string;
  updated_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  message?: string;
}

export interface AlertSqlExecutionResult {
  status: "completed" | "failed";
  message: string;
  sql_command?: string;
  sql_output?: string;
  database_result?: unknown;
  rows_affected?: number;
  executed_by?: string;
  executed_at: string;
}

export type DbaAlertLogSeverity = "P1" | "P2" | "INFO";

export type DbaAlertLogStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export interface DbaAlertLogRow {
  alert_id: number;
  database_name: string;
  originating_timestamp: string;
  error_code?: string;
  message_text?: string;
  severity: DbaAlertLogSeverity;
  status: DbaAlertLogStatus;
  acknowledged_by?: string;
  acknowledged_at?: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export type DbaAction =
  | "refresh_dashboard"
  | "tablespace_check"
  | "create_tablespace"
  | "session_list"
  | "kill_session"
  | "long_queries"
  | "lock_check"
  | "backup_status"
  | "take_rman_backup"
  | "alert_log"
  | "check_alert_by_time"
  | "check_alert_by_lines"
  | "analyze_alert_log"
  | "index_analysis"
  | "stats_refresh"
  | "datafile_extend"
  | "disk_utilization"
  | "health_report"
  | "check_performance"
  | "top_sql"
  | "invalid_objects"
  | "invalid_obejcts"
  | "cpu_usage"
  | "wait_events"
  | "SESSION_LONGOPS"
  | "schema_list"
  | "recompile_invalid"
  | "chat_bot"
  | "expdp"
  | "impdp"
  | "expdp_check_log"
  | "impdp_check_log"
  | "fetch_dump"
  // ── User Management ──────────────────────────────────────
  | "user_status"
  | "create_user"
  | "unlock_user"
  | "reset_password"
  | "change_default_tbs"
  | "change_temp_tbs"
  | "change_quota"
  | "assign_profile"
  | "rename_user"
  | "drop_user"
  | "list_tbs"
  | "list_temp_tbs"
  | "list_profile"
  | "view_profiles"
  | "create_profile"
  | "alter_profile"
  | "drop_profile"
  | "system_privilege"
  | "object_privilege"
  | "create_role"
  | "fetch_roles"
  | "role_to_user"
  | "list_objects"
  // ── General Administration ───────────────────────────────
  | "status_database"
  | "start_database"
  | "stop_database"
  | "mount_database"
  | "check_listener"
  | "start_listener"
  | "stop_listener"
  | "fetch_listener"
  | "fetch_tnsnames"
  | "query";

export type DbaActionCategory =
  | "dashboard"
  | "storage"
  | "sessions"
  | "performance"
  | "locks"
  | "backup"
  | "logs"
  | "objects"
  | "user_management"
  | "general_admin";

export interface DbaParameterField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea" | "checkbox";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: string[];
  help?: string;
}

export interface DbaActionDefinition {
  action: DbaAction;
  title: string;
  description: string;
  category: DbaActionCategory;
  destructive?: boolean;
  icon: string;
  params: DbaParameterField[];
}

export type DbEnvironment = "PROD" | "DEV" | "UAT" | "DR";
export type DbOs = "Linux" | "Windows";
export type DbType = "Standalone" | "RAC" | "Dataguard" | "Active Dataguard";

export interface DbaRequestPayload {
  action: DbaAction;
  db: string;
  params: Record<string, unknown>;
  requested_by: string;
  user_id?: number;
  environment?: DbEnvironment;
  os?: DbOs;
  db_type?: DbType;
}

export interface DbaFinding {
  id?: string;
  title: string;
  detail: string;
  severity: DbaStatus;
  object_name?: string;
  metric?: string;
  value?: string | number;
}

export interface DbaRecommendation {
  id?: string;
  title: string;
  detail: string;
  severity?: DbaStatus;
  action?: DbaAction;
}

export interface TablespaceRow {
  name: string;
  used_gb: number;
  free_gb: number;
  pct_used: number;
  status: DbaStatus;
}

export interface FilesystemUsageRow {
  name: string;
  mount_point?: string;
  filesystem?: string;
  drive?: string;
  type?: "filesystem" | "drive";
  size_gb?: number;
  used_gb: number;
  free_gb: number;
  pct_used: number;
  pct_free?: number;
  status: DbaStatus;
}

export interface SessionRow {
  sid: number;
  serial: number;
  username: string;
  machine: string;
  program: string;
  status: "ACTIVE" | "INACTIVE" | "KILLED";
  wait_event: string;
  seconds_in_wait: number;
  sql_id: string;
}

export interface SqlMetricRow {
  sql_id: string;
  module: string;
  executions: number;
  elapsed_ms: number;
  cpu_ms: number;
  buffer_gets: number;
  sql_text: string;
}

export interface BackupRow {
  id: string;
  type: string;
  started_at: string;
  duration_min: number;
  status: "SUCCESS" | "FAILED" | "RUNNING";
  compression_ratio: number;
  size_gb: number;
}

export interface AlertLogRow {
  timestamp: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  message: string;
}

/** Row returned by the v$diag_alert_ext time-range query (Section 2). */
export interface DiagAlertExtRow {
  originating_timestamp: string;
  message_type?: string;
  message_level?: string | number;
  problem_key?: string;
  message_text: string;
}

/** Response from the check_alert_by_lines n8n webhook (Section 3). */
export interface AlertLinesResponse {
  output: string;
  line_count: number;
  database_name: string;
}

export type NotificationItemType = "tablespace" | "filesystem_drive" | "alert_log" | "dba_shift" | "generic";

/** Shared shape of the SSE notification payload broadcast to clients */
export interface NotificationPayload {
  id: string;
  type: NotificationItemType;
  severity: AlertNotificationSeverity;
  db: string;
  title: string;
  message: string;
  timestamp: string;
  targetPath: string;
}

/** A notification item stored in the client-side store (adds the `read` flag) */
export interface NotificationItem extends NotificationPayload {
  read: boolean;
}

export interface AlertNotification {
  id: string;
  source: string;
  alert_type: AlertNotificationType;
  db: string;
  tablespace?: string;
  object_name?: string;
  severity: AlertNotificationSeverity;
  status: AlertNotificationStatus;
  message: string;
  utilization_pct?: number;
  threshold_pct?: number;
  critical_pct?: number;
  used_gb?: number;
  free_gb?: number;
  extend_size_gb?: number;
  datafile?: string;
  workflow_run_id?: string;
  approval_url?: string;
  reject_url?: string;
  callback_url?: string;
  created_by: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
  approved_at?: string;
  completed_at?: string;
  metadata?: Record<string, unknown>;
}

export interface InvalidObjectRow {
  owner: string;
  object_name: string;
  object_type: string;
  status: string;
  last_ddl_time?: string;
  last_modified?: string;
}

export interface DbaResponse {
  status: "success" | "error" | "pending_approval";
  request_id: string;
  action: DbaAction;
  db_status: DbaStatus;
  ai_summary: string;
  findings: DbaFinding[];
  recommendations: DbaRecommendation[];
  raw_data: {
    metrics?: Record<string, number | string>;
    trend?: Array<Record<string, number | string>>;
    tablespaces?: TablespaceRow[];
    filesystems?: FilesystemUsageRow[];
    drives?: FilesystemUsageRow[];
    disk_utilization?: FilesystemUsageRow[];
    sessions?: SessionRow[];
    sql?: SqlMetricRow[];
    locks?: Array<Record<string, string | number>>;
    backups?: BackupRow[];
    alerts?: AlertLogRow[];
    invalid_objects?: InvalidObjectRow[];
    rows?: Array<Record<string, unknown>>;
    schemas?: string[];
    privileges?: Array<Record<string, string | number>>;
    [key: string]: unknown;
  };
  raw_output: string;
  approval?: {
    channel: string;
    approver: string;
    status: "waiting" | "approved" | "rejected";
    steps: ApprovalStep[];
  };
}

export interface ApprovalStep {
  label: string;
  status: "done" | "current" | "pending" | "failed";
  timestamp?: string;
}

export interface RequestHistoryItem {
  id: string;
  action: DbaAction;
  db: string;
  status: DbaResponse["status"] | "error";
  requested_by: string;
  created_at: string;
  duration_ms?: number;
  payload: DbaRequestPayload;
  response?: DbaResponse;
  error?: string;
}

export interface AuditLogItem {
  id: string;
  actor: string;
  action: DbaAction | "login" | "logout" | "retry" | string;
  db?: string;
  status: string;
  timestamp: string;
  detail: string;
  sql_command?: string;
  user_id?: number;
  metadata?: Record<string, unknown>;
}

export interface DatabaseTarget {
  name: string;
  environment: string;
  region: string;
  role: "primary" | "standby" | "reporting";
  status: string;
  env_label: DbEnvironment;
  os: DbOs;
  db_type: DbType;
  server_name?: string;
  server_ip?: string;
  zone?: string;
}

export type SecurityPostureProcessingStatus = "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED";

/** The active Nessus document displayed for the currently selected database. */
export interface SecurityPostureReport {
  id: number;
  database_id: number;
  database_name: string;
  original_filename: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
  processing_status: SecurityPostureProcessingStatus;
  ai_summary?: string;
  ai_model?: string;
  summary_generated_at?: string;
  error_message?: string;
}

export interface DatabaseOwnerSummary {
  userId: number;
  username: string;
  email: string;
}

export type DbServerType = "Physical" | "Virtual";

export type DbDivision = "PCPB" | "ITD" | "FBD" | "HOTEL" | "ILTD" | "CORP" | "ITSS";

export const DB_DIVISION_OPTIONS: DbDivision[] = ["PCPB", "ITD", "FBD", "HOTEL", "ILTD", "CORP", "ITSS"];

export const DB_EDITION_OPTIONS = [
  "Enterprise Edition",
  "Standard Edition",
  "Standard Edition One",
  "Personal Edition",
  "Express Edition"
] as const;

export type DbEdition = (typeof DB_EDITION_OPTIONS)[number];

export interface DatabaseInventoryItem extends DatabaseTarget {
  id: number;
  database_name: string;
  location: string;
  owner_id: number;
  owner?: DatabaseOwnerSummary;
  server_type: DbServerType;
  db_version?: string;
  db_edition?: string;
  db_port: number;
  division: DbDivision;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

export interface DatabaseInventoryInput {
  database_name: string;
  environment: string;
  location: string;
  operating_system: string;
  database_role: string;
  database_type: string;
  status: string;
  environment_label: string;
  owner_id: number;
  server_name?: string;
  server_ip?: string;
  zone?: string;
  server_type?: string;
  db_version?: string;
  db_edition?: string;
  db_port?: number;
  division?: string;
}

export interface UserSession {
  username: string;
  userId?: number;
  jwt?: string;
  authMode: "jwt";
  role: "app_admin" | "dba_admin" | "client" | "auditor";
  themePreference?: ThemePreference;
}

export type ThemePreference = "light" | "dark";

export type AppUserRole = UserSession["role"];

export interface AppUser {
  userId: number;
  username: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Dashboard History — 12-Metric Snapshot Types
// ============================================================

export interface DbHealthMetrics {
  db_name: string;
  open_mode: string;
  listener_status: string;
  connection_test: "SUCCESS" | "FAILED" | "UNKNOWN";
  instance_name: string;
  host_name: string;
  startup_time: string | null;
  uptime_hours: number;
}

export interface OsResourceMetrics {
  cpu_usage_pct: number;
  total_memory_gb: number;
  free_memory_gb: number;
  /** Populated when n8n returns memory as a raw percentage (stdout) instead of GB values */
  memory_used_pct?: number;
}

export interface SgaPgaMetrics {
  sga_target: string;
  sga_max_size: string;
  pga_aggregate_target: string;
  pga_aggregate_limit?: string;
}

export interface DashboardTablespaceRow {
  tablespace_name: string;
  total_mb: number;
  used_mb: number;
  free_mb: number;
  pct_used: number;
}

export interface DashboardBackupRow {
  start_time: string;
  end_time: string;
  input_type: string;
  status: string;
  duration_min: number;
}

export interface DashboardArchiveLogMonthRow {
  month: string;
  archive_log_count: number;
  archive_gb: number;
}

export interface DashboardDatapumpExportRow {
  owner_name: string;
  job_name: string;
  operation: string;
  job_mode: string;
  state: string;
}

export interface DashboardPasswordExpiryUserRow {
  username: string;
  account_status: string;
  expiry_date: string;
}

export interface BlockingSessionRow {
  waiter_sid: number;
  waiter_serial: number;
  waiter_user: string;
  waiter_sql_id: string;
  blocker_sid: number;
  blocker_serial: number;
  blocker_user: string;
  blocker_sql_id: string;
  waiting_min: number;
  event: string;
}

export interface FraMetrics {
  name: string;
  fra_size_gb: number;
  used_gb: number;
  reclaimable_gb: number;
  pct_used: number;
}

export interface OraErrorRow {
  originating_timestamp: string;
  message_text: string;
}

export interface DashboardMetrics {
  db_health: DbHealthMetrics;
  os_resources: OsResourceMetrics;
  sga_pga: SgaPgaMetrics;
  tablespaces: DashboardTablespaceRow[];
  rman_backups: DashboardBackupRow[];
  active_sessions: number;
  inactive_sessions: number;
  blocking_sessions: BlockingSessionRow[];
  failed_jobs: number;
  invalid_objects: number;
  users_expiring_in_15_days?: number;
  archive_log_generation?: DashboardArchiveLogMonthRow[];
  tablespaces_over_90?: number;
  datapump_exports?: DashboardDatapumpExportRow[];
  password_expiring_users?: DashboardPasswordExpiryUserRow[];
  failed_login_count?: number;
  fra: FraMetrics;
  ora_errors: OraErrorRow[];
  captured_at?: string;
}

export interface DashboardHistoryRow {
  id: number;
  db_name: string;
  environment: string | null;
  os: string | null;
  refreshed_by: string | null;
  refresh_timestamp: string;
  metrics: DashboardMetrics | null;
}

// ============================================================
// Chat with DB — Types
// ============================================================

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessageStatus = "sending" | "streaming" | "done" | "error" | "waiting_approval";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: Date;
  status: ChatMessageStatus;
  sqlApproval?: ChatApprovalRequest;
}

export interface ChatApprovalRequest {
  sessionId: string;
  sqlQuery: string;
  resumeUrl: string;
  status: "pending" | "approved" | "rejected";
}

export interface ChatBotPayload {
  action: "chat_bot";
  query: string;
  db: string;
  params: Record<string, unknown>;
  requested_by: string;
  user_id?: number;
  environment?: string;
  os?: string;
  db_type?: string;
  session_id: string;
}

export interface ChatApprovalCallbackPayload {
  session_id: string;
  sql_query: string;
  resume_url: string;
  message?: string;
}

// ============================================================
// Data Pump — EXPDP / IMPDP Types
// ============================================================

export type DataPumpJobStatus = "running" | "success" | "error" | "completed";
export type DataPumpOperation = "expdp" | "impdp";

export interface DataPumpJob {
  id: string;
  operation: DataPumpOperation;
  db: string;
  status: DataPumpJobStatus;
  started_at: string;
  completed_at?: string;
  dump_file?: string;
  transfer_status?: string;
  message?: string;
  params: Record<string, unknown>;
}

export interface ExpdpParams {
  DIRECTORY: string;
  DUMPFILE: string;
  LOGFILE: string;
  SCHEMAS?: string[];
  TABLES?: string;
  TABLESPACES?: string;
  FULL?: string;
  EXCLUDE?: string;
  INCLUDE?: string;
  PARALLEL?: number;
  COMPRESSION?: string;
  FLASHBACK_TIME?: string;
  FILESIZE?: string;
  CONTENT?: string;
  ESTIMATE_ONLY?: string;
  METRICS?: string;
  dump_transfer_required?: "yes" | "no";
  transfer_server?: string;
  [key: string]: unknown;
}

export interface ImpdpParams {
  DIRECTORY: string;
  DUMPFILE: string;
  LOGFILE: string;
  SCHEMAS?: string[];
  TABLES?: string;
  TABLESPACES?: string;
  FULL?: string;
  PARALLEL?: number;
  CONTENT?: string;
  EXCLUDE?: string;
  INCLUDE?: string;
  TABLE_EXISTS_ACTION?: string;
  REMAP_SCHEMA?: string;
  REMAP_TABLESPACE?: string;
  TRANSFORM?: string;
  METRICS?: string;
  drop_user?: "yes" | "no";
  [key: string]: unknown;
}

export interface ExpdpTemplate {
  id: string;
  name: string;
  db: string;
  created_at: string;
  params: ExpdpParams;
}

export interface ImpdpTemplate {
  id: string;
  name: string;
  db: string;
  created_at: string;
  params: ImpdpParams;
}

// ============================================================
// RMAN Background Jobs
// ============================================================

export type RmanJobStatus = "running" | "success" | "error";

export interface RmanJob {
  id: string;
  db: string;
  status: RmanJobStatus;
  started_at: string;
  completed_at?: string;
  params: Record<string, unknown>;
  response?: DbaResponse;
  error?: string;
}

// ============================================================
// User Management — Types
// ============================================================

export interface UserStatusRow {
  username: string;
  account_status: string;
  expiry_date: string | null;
  profile: string;
}

export interface ProfileParameterRow {
  profile: string;
  resource_name: string;
  limit: string;
}

export interface UserMgmtResult {
  status: "success" | "error";
  message: string;
  confirmation_rows?: Array<Record<string, unknown>>;
  ddl_executed?: string;
}

// ============================================================
// DBA Console — Shift Management, Daily Checklist, Shift Report
// ============================================================

export interface ShiftSession {
  session_id: number;
  user_id: number;
  username: string;
  email: string;
  role: AppUserRole;
  shift_number: 1 | 2 | 3 | 4;
  shift_date: string;
  login_at: string;
  logout_at?: string;
  status: "ACTIVE" | "CLOSED";
  is_active: boolean;
  handover_status?: "PENDING" | "ACKNOWLEDGED" | "NONE";
  handover_id?: number;
  handover_text?: string;
  ack_username?: string;
  ack_at?: string;
}

export interface ActiveDba {
  session_id: number;
  user_id: number;
  username: string;
  shift_number: 1 | 2 | 3 | 4;
  login_at: string;
}

export interface CurrentShiftState {
  active_shifts: number[];
  shift_label: string;
  overlap: boolean;
  server_time: string;
  active_dbas: ActiveDba[];
  sessions: ShiftSession[];
  taken_shifts: number[];
  selectable_shifts: number[];
  disabled_shifts: number[];
  preferred_shift: number;
}

export interface Handover {
  handover_id: number;
  session_id: number;
  author_user_id: number;
  author_username: string;
  shift_number: 1 | 2 | 3 | 4;
  shift_date: string;
  handover_text: string;
  status: "PENDING" | "ACKNOWLEDGED";
  ack_user_id?: number;
  ack_username?: string;
  ack_at?: string;
  override_reason?: string;
  is_override: boolean;
  created_at: string;
  updated_at: string;
}

export type DbStatusValue = "UP" | "DOWN" | "PARTIAL" | "MAINTENANCE";
export type BackupStatusValue = "SUCCESS" | "FAILED" | "RUNNING" | "NOT_STARTED" | "UNKNOWN";

export interface DbStatusCheck {
  check_id: number;
  database_id: number;
  database_name: string;
  shift_number: 1 | 2 | 3 | 4;
  shift_date: string;
  status: DbStatusValue;
  checked_by: number;
  checked_username: string;
  checked_at: string;
  comment_text?: string;
}

export interface BackupTemplate {
  backup_id: number;
  database_id: number;
  database_name: string;
  backup_name: string;
  scheduled_time?: string;
  backup_type?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

export interface BackupStatusCheck {
  check_id: number;
  backup_id: number;
  database_id: number;
  database_name: string;
  backup_name: string;
  shift_number: 1 | 2 | 3 | 4;
  shift_date: string;
  status: BackupStatusValue;
  checked_by: number;
  checked_username: string;
  checked_at: string;
  comment_text?: string;
}

export interface ChecklistCompletion {
  total: number;
  completed: number;
  completion_pct: number;
}

export interface ShiftReportFilters {
  fromDate?: string;
  toDate?: string;
  dbaUserId?: number;
  shiftNumber?: number;
  timelinePage?: number;
  timelinePageSize?: number;
  timelineEvent?: string;
  timelineSearch?: string;
}

export interface ShiftReportTimelineEntry {
  event: string;
  username: string;
  shift_number: number;
  timestamp: string;
  detail?: string;
}

export interface ShiftReportSessionRow {
  session_id: number;
  username: string;
  user_id: number;
  shift_number: number;
  shift_date: string;
  login_at: string;
  logout_at?: string;
  status: string;
  is_active: boolean;
  duration_min?: number;
}

export interface ShiftReportCoverageRow {
  shift_date: string;
  shift_number: number;
  expected_dbas: number;
  actual_dbas: number;
  coverage_pct: number;
  late_logins: number;
}

export interface ShiftReportData {
  activeDbas: ActiveDba[];
  dailyAttendance: Array<{ attendance_date: string; unique_dbas: number; total_logins: number }>;
  monthlyAttendance: Array<{ month: string; unique_dbas: number; total_logins: number }>;
  avgLoginDurationMin: number;
  lateLogins: Array<{ session_id: number; username: string; shift_number: number; shift_date: string; login_at: string; minutes_late: number }>;
  pendingHandovers: Handover[];
  unacknowledgedHandovers: Handover[];
  dbStatusCompletion: ChecklistCompletion;
  backupCompletion: ChecklistCompletion;
  checklistCompletion: ChecklistCompletion;
  mostActiveDba?: { username: string; total_logins: number };
  activityTimeline: ShiftReportTimelineEntry[];
  timelineTotal: number;
  loginTrend: Array<{ shift_date: string; shift_number: number; logins: number; hours: number }>;
  dbStatusChecks: DbStatusCheck[];
  backupStatusChecks: BackupStatusCheck[];
  handovers: Handover[];
  sessions: ShiftReportSessionRow[];
  coverage: ShiftReportCoverageRow[];
}
