import type {
  AlertNotification,
  AlertNotificationStatus,
  AlertSqlApprovalDecision,
  AppUser,
  AppUserRole,
  AuditLogItem,
  DatabaseInventoryInput,
  DatabaseInventoryItem,
  DashboardMetrics,
  DbaAction,
  DbaAlertLogRow,
  DbaAlertLogStatus,
  DbaResponse,
  DiagAlertExtRow,
  TablespaceRow,
  UserSession
} from "@/types/dba";

const MOCK_MODE = process.env.NEXT_PUBLIC_DBA_MOCK !== "false";

interface ApiErrorBody {
  message?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const isAuthProbe =
      url.includes("/api/auth/login") ||
      url.includes("/api/auth/logout") ||
      url.includes("/api/auth/session") ||
      url.includes("/api/auth/forgot-password") ||
      url.includes("/api/auth/reset-password");

    if (response.status === 401 && !isAuthProbe) {
      const { clearAuthAndRedirect } = await import("@/lib/auth-client");
      await clearAuthAndRedirect();
    }

    const message =
      (payload as ApiErrorBody | undefined)?.message ||
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function loginWithPassword(email: string, password: string, remember: boolean) {
  return requestJson<
    | { user: UserSession; expiresAt: string; requiresPasswordReset?: false }
    | { requiresPasswordReset: true; email: string; message: string }
  >("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      remember
    })
  });
}

export async function requestPasswordReset(email: string) {
  return requestJson<{ success: boolean; message: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function resetPassword(token: string, newPassword: string) {
  return requestJson<{ success: boolean; message: string }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword })
  });
}

export async function executeDBAAction(
  action: DbaAction,
  db: string,
  params: Record<string, unknown> = {}
): Promise<DbaResponse> {
  return requestJson<DbaResponse>("/api/dba/actions", {
    method: "POST",
    body: JSON.stringify({ action, db, params })
  });
}

export async function fetchCurrentSession() {
  return requestJson<{ user: UserSession; expiresAt: string }>("/api/auth/session");
}

export async function logoutSession() {
  return requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function fetchAppUsers() {
  return requestJson<{ users: AppUser[] }>("/api/admin/users");
}

export async function createAppUser(input: {
  username: string;
  email: string;
  role: AppUserRole;
  initialPassword: string;
  isActive: boolean;
}) {
  return requestJson<{ user: AppUser }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateAppUser(
  userId: number,
  input: {
    username: string;
    email: string;
    role: AppUserRole;
    isActive: boolean;
  }
) {
  return requestJson<{ user: AppUser }>(`/api/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function removeAppUser(userId: number) {
  return requestJson<{ ok: boolean }>(`/api/admin/users/${userId}`, {
    method: "DELETE"
  });
}

export async function toggleAppUserStatus(userId: number) {
  return requestJson<{ user: AppUser }>(`/api/admin/users/${userId}`, {
    method: "PUT"
  });
}

export async function fetchDatabases() {
  return requestJson<{ databases: DatabaseInventoryItem[] }>("/api/databases");
}

export async function createDatabase(input: DatabaseInventoryInput) {
  return requestJson<{ database: DatabaseInventoryItem }>("/api/databases", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateDatabase(id: number, input: DatabaseInventoryInput) {
  return requestJson<{ database: DatabaseInventoryItem }>(`/api/databases/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function removeDatabase(id: number) {
  return requestJson<{ ok: boolean }>(`/api/databases/${id}`, {
    method: "DELETE"
  });
}

export async function changeDatabaseOwner(id: number, ownerId: number) {
  return requestJson<{ database: DatabaseInventoryItem }>(`/api/databases/${id}/owner`, {
    method: "PUT",
    body: JSON.stringify({ owner_id: ownerId })
  });
}

export async function fetchUsersByRole(role: AppUserRole) {
  const query = new URLSearchParams({ role }).toString();
  return requestJson<{ users: AppUser[] }>(`/api/users?${query}`);
}

export async function fetchAuditLogs(limit = 200) {
  const query = new URLSearchParams({ limit: String(limit) }).toString();
  return requestJson<{ items: AuditLogItem[] }>(`/api/audit?${query}`);
}

export async function fetchPerformanceAuditLogs(db: string) {
  const query = new URLSearchParams({ db }).toString();
  return requestJson<{ items: Record<string, AuditLogItem> }>(`/api/performance/audit?${query}`);
}


export async function fetchAlertNotifications(
  params: { db?: string; type?: string; status?: AlertNotificationStatus; limit?: number; page?: number; offset?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.db) query.set("db", params.db);
  if (params.type) query.set("alert_type", params.type);
  if (params.status) query.set("status", params.status);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.page) query.set("page", String(params.page));
  if (typeof params.offset === "number") query.set("offset", String(params.offset));

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<{ items: AlertNotification[]; total: number; limit: number; offset: number }>(`/api/alerts${suffix}`);
}

export async function updateAlertNotificationStatus(id: string, status: AlertNotificationStatus, message?: string, approvedBy?: string) {
  return requestJson<{ alert: AlertNotification }>("/api/alerts", {
    method: "PATCH",
    body: JSON.stringify({ id, status, message, approved_by: approvedBy })
  });
}

export async function fetchPendingSqlApprovals(params: { db?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.db) query.set("db", params.db);
  if (params.limit) query.set("limit", String(params.limit));

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<{ items: AlertNotification[]; total: number }>(`/api/alerts/sql-approval${suffix}`);
}

export async function decideAlertSqlApproval(
  id: string,
  decision: AlertSqlApprovalDecision,
  sqlCommand: string,
  approvedBy?: string,
  message?: string
) {
  return requestJson<{ alert: AlertNotification }>("/api/alerts/sql-approval", {
    method: "PATCH",
    body: JSON.stringify({ id, decision, sql_command: sqlCommand, approved_by: approvedBy, message })
  });
}

export function isMockMode() {
  return MOCK_MODE;
}

export interface TablespaceRunsResponse {
  rows: TablespaceRow[];
  last_run_at: string | null;
  last_run_by: string | null;
  has_data: boolean;
}

export async function fetchTablespaceRuns(db?: string): Promise<TablespaceRunsResponse> {
  const qs = db ? `?db=${encodeURIComponent(db)}` : "";
  return requestJson<TablespaceRunsResponse>(`/api/tablespaces/runs${qs}`);
}

export async function triggerTablespaceAutoCheck(
  db: string,
  params?: Record<string, unknown>
): Promise<{ ok: boolean; triggered_by: string }> {
  return requestJson<{ ok: boolean; triggered_by: string }>("/api/tablespaces/trigger", {
    method: "POST",
    body: JSON.stringify({ db, params })
  });
}

export async function triggerDatafileExtend(
  db: string
): Promise<{ ok: boolean; triggered_by: string; db: string }> {
  return requestJson<{ ok: boolean; triggered_by: string; db: string }>(
    "/api/datafile-extend/trigger",
    {
      method: "POST",
      body: JSON.stringify({ db })
    }
  );
}

export async function submitDatafileSelection(
  alertId: string,
  tablespace: string,
  sizeGb: number
): Promise<{ alert: AlertNotification }> {
  return requestJson<{ alert: AlertNotification }>("/api/datafile-extend/select", {
    method: "POST",
    body: JSON.stringify({ alert_id: alertId, tablespace, size_gb: sizeGb })
  });
}

// ============================================================
// Dashboard History
// ============================================================

export interface DashboardHistoryResponse {
  db_name: string;
  refreshed_by: string | null;
  refresh_timestamp: string | null;
  metrics: DashboardMetrics | null;
  has_data: boolean;
}

export async function fetchDashboardHistory(db: string): Promise<DashboardHistoryResponse> {
  const qs = db ? `?db=${encodeURIComponent(db)}` : "";
  return requestJson<DashboardHistoryResponse>(`/api/dashboard/history${qs}`);
}

// ============================================================
// DBA Alert Log (dba_alert_log) — Section 1
// ============================================================

/** Fetch dba_alert_log entries from the app's Oracle table. */
export async function fetchDbaAlertLog(
  params: {
    database_name?: string;
    status?: DbaAlertLogStatus;
    severity?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ items: DbaAlertLogRow[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.database_name) query.set("database_name", params.database_name);
  if (params.status) query.set("status", params.status);
  if (params.severity) query.set("severity", params.severity);
  if (params.limit) query.set("limit", String(params.limit));
  if (typeof params.offset === "number") query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson(`/api/alerts/alert-log${suffix}`);
}

/** Acknowledge a dba_alert_log entry (OPEN → ACKNOWLEDGED). */
export async function acknowledgeDbaAlert(
  alert_id: number
): Promise<{ alert: DbaAlertLogRow }> {
  return requestJson("/api/alerts/alert-log", {
    method: "PATCH",
    body: JSON.stringify({ alert_id, status: "ACKNOWLEDGED" })
  });
}

/** Resolve a dba_alert_log entry (ACKNOWLEDGED → RESOLVED). */
export async function resolveDbaAlert(
  alert_id: number
): Promise<{ alert: DbaAlertLogRow }> {
  return requestJson("/api/alerts/alert-log", {
    method: "PATCH",
    body: JSON.stringify({ alert_id, status: "RESOLVED" })
  });
}

// ============================================================
// Webhook triggers — Sections 2 & 3
// ============================================================

/**
 * Section 2 — Check alert log by time range.
 * Routes through the standard /api/dba/actions webhook (n8n routes by action field).
 */
export async function triggerAlertByTime(
  db: string,
  startTime: string,
  endTime: string
): Promise<DbaResponse & { rows?: DiagAlertExtRow[] }> {
  return requestJson<DbaResponse & { rows?: DiagAlertExtRow[] }>("/api/dba/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "check_alert_by_time" as DbaAction,
      db,
      params: { start_time: startTime, end_time: endTime }
    })
  });
}

/**
 * Section 3 — Check last N lines of the Oracle alert log.
 * Routes through the standard /api/dba/actions webhook.
 */
export async function triggerAlertByLines(
  db: string,
  lineCount: number
): Promise<DbaResponse & { output?: string }> {
  return requestJson<DbaResponse & { output?: string }>("/api/dba/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "check_alert_by_lines" as DbaAction,
      db,
      params: { line_count: lineCount }
    })
  });
}

/**
 * Sections 2 & 3 — Analyze alert log text with GenAI via n8n.
 * Sends the captured alert log text and receives AI-generated RCA insights.
 */
export async function analyzeAlertLog(
  db: string,
  alertLogText: string
): Promise<DbaResponse> {
  return requestJson<DbaResponse>("/api/dba/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "analyze_alert_log" as DbaAction,
      db,
      params: { alert_log_text: alertLogText }
    })
  });
}

// ============================================================
// Performance Run All History — reads from performance_run_all_hist
// ============================================================

export interface PerformanceRunAllHistoryResponse {
  has_data: boolean;
  run_id?: number;
  db_name?: string;
  environment?: string | null;
  os?: string | null;
  refreshed_by?: string;
  /** Parsed JSON containing every query's result array */
  metrics_payload?: Record<string, unknown> | null;
  ai_summary?: string | null;
  created_at?: string;
}

/**
 * Fetch the most-recent check_performance run stored in
 * performance_run_all_hist for the given database.
 */
export async function fetchPerformanceRunAllHistory(
  db: string
): Promise<PerformanceRunAllHistoryResponse> {
  const qs = `?db=${encodeURIComponent(db)}`;
  return requestJson<PerformanceRunAllHistoryResponse>(
    `/api/performance/history${qs}`
  );
}
