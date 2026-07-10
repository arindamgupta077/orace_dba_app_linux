import { NextResponse } from "next/server";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { dispatchDbaWorkflowCommand } from "@/lib/server/dba-workflow";
import { alertTypeToTargetPath, emitGlobalNotification, resolveNotificationType } from "@/lib/server/notification-events";
import {
  findPendingAlertNotificationOccurrence,
  getAlertNotification,
  insertAlertNotification,
  insertAuditLog,
  insertDbaAlertLogAudit,
  listAlertNotifications,
  replacePendingAlertNotification,
  updateAlertNotification
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { sha256Hex } from "@/lib/server/security";
import { registerAlertSqlApproval } from "@/lib/server/sql-approval";
import type { AlertNotificationSeverity, AlertNotificationStatus, AlertNotificationType, DbaAlertLogSeverity } from "@/types/dba";

export const dynamic = "force-dynamic";

type BodyRecord = Record<string, unknown>;

const PUBLIC_ALERT_ACTOR = "n8n";
const DEFAULT_SQL_EXECUTION_TIMEOUT_MINUTES = 3;

function readString(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function isRecord(value: unknown): value is BodyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapN8nPayload(raw: unknown): BodyRecord {
  let current = raw;

  for (let index = 0; index < 6; index += 1) {
    if (Array.isArray(current)) {
      current = current[0];
      continue;
    }

    if (!isRecord(current)) return {};
    if (isRecord(current.alert)) return current;

    const wrapped = current.json ?? current.body ?? current.data ?? current.payload;
    if (wrapped && wrapped !== current) {
      current = wrapped;
      continue;
    }

    return current;
  }

  return isRecord(current) ? current : {};
}

function normalizeAlertWebhookBody(raw: unknown): BodyRecord {
  const firstItem = unwrapN8nPayload(raw);

  const alert = firstItem.alert;
  if (!isRecord(alert)) return firstItem;

  const metadata = isRecord(alert.metadata) ? alert.metadata : {};
  const sqlExecution = isRecord(metadata.sql_execution) ? metadata.sql_execution : {};
  const sqlApproval = isRecord(metadata.sql_approval) ? metadata.sql_approval : {};
  const executionStatus = normalizeStatus(String(sqlExecution.status || ""));

  return {
    ...firstItem,
    ...alert,
    alert_id: alert.id,
    status: isExecutionResultStatus(executionStatus) ? executionStatus : alert.status,
    message: alert.message,
    actor: sqlExecution.executed_by || alert.approved_by || alert.created_by || firstItem.actor,
    sql_command: sqlExecution.sql_command || sqlApproval.sql_command || firstItem.sql_command,
    sql_output: sqlExecution.sql_output || firstItem.sql_output,
    database_result: sqlExecution.database_result || firstItem.database_result,
    rows_affected: sqlExecution.rows_affected || firstItem.rows_affected,
    metadata
  };
}

function readNumber(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readObject(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function readValue(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const value = body[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function readStringArray(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item || "").trim()).filter(Boolean);
        }
      } catch {
        return value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }
  }
  return undefined;
}

function normalizeObjectRows(value: unknown): BodyRecord[] {
  let current = value;
  if (typeof current === "string" && current.trim()) {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return [];
    }
  }

  if (Array.isArray(current)) {
    return current.flatMap((item) => normalizeObjectRows(item));
  }

  if (!isRecord(current)) return [];

  const wrapped = current.json ?? current.body ?? current.data ?? current.payload;
  if (wrapped && wrapped !== current) {
    const wrappedRows = normalizeObjectRows(wrapped);
    if (wrappedRows.length) return wrappedRows;
  }

  return [current];
}

function readObjectArray(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const rows = normalizeObjectRows(body[key]);
    if (rows.length) return rows;
  }
  return undefined;
}

function normalizeSeverity(raw: string): AlertNotificationSeverity {
  const value = raw.toLowerCase();
  if (value === "info" || value === "warning" || value === "critical" || value === "error") return value;
  return "critical";
}

function normalizeStatus(raw: string): AlertNotificationStatus {
  const value = raw.toLowerCase();
  if (value === "success" || value === "executed" || value === "execution_completed") return "completed";
  if (value === "error" || value === "failure" || value === "execution_failed") return "failed";
  if (
    value === "pending_approval" ||
    value === "approved" ||
    value === "rejected" ||
    value === "completed" ||
    value === "failed" ||
    value === "acknowledged"
  ) {
    return value;
  }
  return "pending_approval";
}

function readExecutionStatus(body: BodyRecord) {
  const directStatus = normalizeStatus(readString(body, ["status", "state", "execution_status", "executionStatus"]));
  if (isExecutionResultStatus(directStatus)) return directStatus;

  const metadata = readObject(body, ["metadata"]);
  const sqlExecution = metadata ? readObject(metadata, ["sql_execution", "sqlExecution"]) : undefined;
  const metadataStatus = sqlExecution ? normalizeStatus(readString(sqlExecution, ["status", "state"])) : "pending_approval";
  if (isExecutionResultStatus(metadataStatus)) return metadataStatus;

  const errorCode = readString(body, ["error_code", "errorCode", "code", "reason"]);
  const message = readString(body, ["message", "detail", "completion_message", "completionMessage", "sql_output", "sqlOutput", "output"]);
  if (/no[_\s-]?disk[_\s-]?space|disk[_\s-]?space/i.test(errorCode)) return "failed";
  if (/sql\s+executed\s+successfully|execution\s+completed/i.test(message)) return "completed";
  if (/sql\s+execution\s+failed|execution\s+failed|ora-\d+|no\s+disk\s+space|not\s+enough\s+(os\s+)?disk\s+space|insufficient\s+(os\s+)?disk\s+space/i.test(message)) return "failed";

  return "pending_approval";
}

function normalizeAlertType(raw: string): AlertNotificationType {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
  return normalized || "generic";
}

function createAlertId() {
  return `ALT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function createDeterministicAlertId(value: string) {
  return `ALT-${sha256Hex(value).slice(0, 32).toUpperCase()}`;
}

function createAlertOccurrenceId(baseId: string) {
  const suffix = `-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return `${baseId.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
}

function buildAlertTitle(alertType: string, target: string, severity: string) {
  const sev = severity.toUpperCase();
  if (alertType === "tablespace") return `Tablespace ${sev}: ${target}`;
  if (alertType === "filesystem_drive") return `Filesystem ${sev}: ${target}`;
  return `Alert ${sev}: ${target}`;
}

function fsSeverityToAlertLogSeverity(severity: AlertNotificationSeverity): DbaAlertLogSeverity {
  return severity === "critical" || severity === "error" ? "P2" : "INFO";
}

function alertTypeToAuditAction(alertType: string) {
  if (alertType === "filesystem_drive") return "disk_utilization";
  return "alert_log";
}

async function readOptionalSession() {
  try {
    const session = await requireAuthenticatedSession();
    return session ? { username: session.user.username, userId: session.userId } : null;
  } catch {
    return null;
  }
}

function getResumeUrlForStatus(alert: Awaited<ReturnType<typeof getAlertNotification>>, status: AlertNotificationStatus) {
  if (!alert) return "";
  if (status === "approved") return alert.approval_url || "";
  if (status === "rejected") return alert.reject_url || "";
  return "";
}

function normalizeResumeUrl(
  rawUrl: string,
  decision: "approved" | "rejected",
  alertId: string,
  actor: string,
  userId?: number
) {
  let nextUrl = rawUrl.trim();

  if (nextUrl.startsWith("=")) {
    nextUrl = nextUrl.slice(1);
  }

  nextUrl = nextUrl
    .replace(/^http:\/(?!\/)/i, "http://")
    .replace(/^https:\/(?!\/)/i, "https://");

  const parsed = new URL(nextUrl);
  const signature = parsed.searchParams.get("signature");
  if (signature?.includes("?")) {
    parsed.searchParams.set("signature", signature.split("?")[0]);
  }

  parsed.searchParams.set("decision", decision);
  parsed.searchParams.set("alert_id", alertId);
  parsed.searchParams.set("approved_by", actor);
  if (userId != null) {
    parsed.searchParams.set("user_id", String(userId));
  }

  return parsed.toString();
}

function normalizeCallbackUrl(rawUrl: string) {
  let nextUrl = rawUrl.trim();

  if (nextUrl.startsWith("=")) {
    nextUrl = nextUrl.slice(1);
  }

  nextUrl = nextUrl
    .replace(/^http:\/(?!\/)/i, "http://")
    .replace(/^https:\/(?!\/)/i, "https://");

  return new URL(nextUrl).toString();
}

async function resumeN8nWaitNode(
  rawUrl: string,
  decision: "approved" | "rejected",
  alertId: string,
  actor: string,
  userId?: number
) {
  const resumeUrl = normalizeResumeUrl(rawUrl, decision, alertId, actor, userId);
  const response = await fetch(resumeUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`n8n wait resume failed (${response.status} ${response.statusText}).`);
  }
}

async function notifyN8nAcknowledgement(input: {
  rawUrl: string;
  alert: NonNullable<Awaited<ReturnType<typeof getAlertNotification>>>;
  actor: string;
  userId?: number;
  message?: string;
}) {
  const callbackUrl = normalizeCallbackUrl(input.rawUrl);
  const acknowledgedAt = new Date().toISOString();
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alert_id: input.alert.id,
      status: "acknowledged",
      acknowledged_by: input.actor,
      username: input.actor,
      user_id: input.userId,
      db: input.alert.db,
      alert_type: input.alert.alert_type,
      object_name: input.alert.object_name || input.alert.tablespace,
      message: input.message || "Alert acknowledged.",
      acknowledged_at: acknowledgedAt
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`n8n acknowledgement callback failed (${response.status} ${response.statusText}).`);
  }
}

function isExecutionResultStatus(status: AlertNotificationStatus) {
  return status === "completed" || status === "failed";
}

function buildSqlExecutionMetadata(input: {
  existingAlert: NonNullable<Awaited<ReturnType<typeof getAlertNotification>>>;
  status: "completed" | "failed";
  message: string;
  sqlCommand?: string;
  sqlOutput?: string;
  databaseResult?: unknown;
  rowsAffected?: number;
  actor: string;
}) {
  const executedAt = new Date().toISOString();
  const executionResult = {
    status: input.status,
    message: input.message || (input.status === "completed" ? "SQL executed successfully." : "SQL execution failed."),
    sql_command: input.sqlCommand || undefined,
    sql_output: input.sqlOutput || undefined,
    database_result: input.databaseResult,
    rows_affected: input.rowsAffected,
    executed_by: input.actor,
    executed_at: executedAt
  };
  const metadata: Record<string, unknown> = {
    ...(input.existingAlert.metadata || {}),
    sql_execution: executionResult
  };
  const sqlApproval = metadata.sql_approval ?? metadata.sqlApproval;

  if (sqlApproval && typeof sqlApproval === "object" && !Array.isArray(sqlApproval)) {
    const sqlApprovalRecord = sqlApproval as Record<string, unknown>;
    metadata.sql_approval = {
      ...sqlApprovalRecord,
      status: sqlApprovalRecord.status === "rejected" ? "rejected" : "approved",
      sql_command: input.sqlCommand || sqlApprovalRecord.sql_command,
      updated_at: executedAt,
      approved_at: sqlApprovalRecord.approved_at || executedAt
    };
    delete metadata.sqlApproval;
  }

  return metadata;
}

function getSqlExecutionTimeoutMs() {
  const raw = process.env.ALERT_SQL_EXECUTION_TIMEOUT_MINUTES?.trim();
  const minutes = raw ? Number(raw) : DEFAULT_SQL_EXECUTION_TIMEOUT_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_SQL_EXECUTION_TIMEOUT_MINUTES * 60_000;
  return minutes * 60_000;
}

function readMetadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isSqlExecutionTimedOut(alert: NonNullable<Awaited<ReturnType<typeof getAlertNotification>>>) {
  if (alert.status !== "approved") return false;

  const sqlExecution = readMetadataRecord(alert.metadata?.sql_execution ?? alert.metadata?.sqlExecution);
  if (sqlExecution?.status === "completed" || sqlExecution?.status === "failed") return false;

  const sqlApproval = readMetadataRecord(alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval);
  if (sqlApproval?.status !== "approved") return false;

  const startedAtRaw = sqlApproval.updated_at || sqlApproval.approved_at || alert.approved_at || alert.updated_at;
  const startedAt = Date.parse(String(startedAtRaw || ""));
  if (!Number.isFinite(startedAt)) return false;

  return Date.now() - startedAt > getSqlExecutionTimeoutMs();
}

function isSqlGenerationTimedOut(alert: NonNullable<Awaited<ReturnType<typeof getAlertNotification>>>) {
  if (alert.status !== "approved") return false;

  const sqlExecution = readMetadataRecord(alert.metadata?.sql_execution ?? alert.metadata?.sqlExecution);
  if (sqlExecution?.status === "completed" || sqlExecution?.status === "failed") return false;

  const sqlApproval = readMetadataRecord(alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval);
  if (sqlApproval) return false;

  const startedAt = Date.parse(String(alert.approved_at || alert.updated_at || ""));
  if (!Number.isFinite(startedAt)) return false;

  return Date.now() - startedAt > getSqlExecutionTimeoutMs();
}

function inferCompletedSqlExecution(alert: NonNullable<Awaited<ReturnType<typeof getAlertNotification>>>) {
  if (alert.status !== "approved") return "";

  const sqlExecution = readMetadataRecord(alert.metadata?.sql_execution ?? alert.metadata?.sqlExecution);
  if (sqlExecution?.status === "completed" || sqlExecution?.status === "failed") return "";

  const sqlApproval = readMetadataRecord(alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval);
  if (sqlApproval?.status !== "approved") return "";

  if (/sql\s+executed\s+successfully|execution\s+completed/i.test(alert.message)) return "completed";
  if (
    /sql\s+execution\s+failed|execution\s+failed|ora-\d+|no\s+disk\s+space|not\s+enough\s+(os\s+)?disk\s+space|insufficient\s+(os\s+)?disk\s+space/i.test(
      alert.message
    )
  ) {
    return "failed";
  }

  return "";
}

async function applySqlExecutionTimeouts(alerts: NonNullable<Awaited<ReturnType<typeof getAlertNotification>>>[]) {
  const nextAlerts = await Promise.all(
    alerts.map(async (alert) => {
      const inferredExecutionStatus = inferCompletedSqlExecution(alert);
      if (inferredExecutionStatus === "completed" || inferredExecutionStatus === "failed") {
        const sqlApproval = readMetadataRecord(alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval);
        const message = alert.message || (inferredExecutionStatus === "completed" ? "SQL executed successfully." : "SQL execution failed.");
        const updatedAlert = await updateAlertNotification({
          id: alert.id,
          status: inferredExecutionStatus,
          actor: PUBLIC_ALERT_ACTOR,
          message,
          metadata: buildSqlExecutionMetadata({
            existingAlert: alert,
            status: inferredExecutionStatus,
            message,
            sqlCommand: typeof sqlApproval?.sql_command === "string" ? sqlApproval.sql_command : undefined,
            sqlOutput: message,
            actor: PUBLIC_ALERT_ACTOR
          })
        });

        await insertAuditLog({
          actor: PUBLIC_ALERT_ACTOR,
          action: alertTypeToAuditAction(updatedAlert.alert_type),
          db: updatedAlert.db,
          status: inferredExecutionStatus,
          detail: `${updatedAlert.alert_type} alert ${updatedAlert.id} inferred SQL execution ${inferredExecutionStatus}.`,
          metadata: { alert_id: updatedAlert.id, alert_type: updatedAlert.alert_type, sql_execution_inferred: true }
        });

        emitAlertNotificationEvent("updated", updatedAlert);

        return updatedAlert;
      }

      if (isSqlGenerationTimedOut(alert)) {
        const message = `SQL generation timed out after ${Math.round(getSqlExecutionTimeoutMs() / 60_000)} minutes without an n8n SQL proposal.`;
        const updatedAlert = await updateAlertNotification({
          id: alert.id,
          status: "failed",
          actor: PUBLIC_ALERT_ACTOR,
          message,
          metadata: {
            ...(alert.metadata || {}),
            sql_generation: {
              status: "failed",
              message,
              failed_at: new Date().toISOString(),
              timeout: true
            }
          }
        });

        await insertAuditLog({
          actor: PUBLIC_ALERT_ACTOR,
          action: alertTypeToAuditAction(updatedAlert.alert_type),
          db: updatedAlert.db,
          status: "failed",
          detail: `${updatedAlert.alert_type} alert ${updatedAlert.id} SQL generation timed out.`,
          metadata: { alert_id: updatedAlert.id, alert_type: updatedAlert.alert_type, sql_generation_timeout: true }
        });

        emitAlertNotificationEvent("updated", updatedAlert);

        return updatedAlert;
      }

      if (!isSqlExecutionTimedOut(alert)) return alert;

      const message = `SQL execution timed out after ${Math.round(getSqlExecutionTimeoutMs() / 60_000)} minutes without an n8n completion acknowledgement.`;
      const updatedAlert = await updateAlertNotification({
        id: alert.id,
        status: "failed",
        actor: PUBLIC_ALERT_ACTOR,
        message,
        metadata: buildSqlExecutionMetadata({
          existingAlert: alert,
          status: "failed",
          message,
          sqlCommand: readMetadataRecord(alert.metadata?.sql_approval)?.sql_command as string | undefined,
          sqlOutput: message,
          databaseResult: { timeout: true },
          actor: PUBLIC_ALERT_ACTOR
        })
      });

      await insertAuditLog({
        actor: PUBLIC_ALERT_ACTOR,
        action: alertTypeToAuditAction(updatedAlert.alert_type),
        db: updatedAlert.db,
        status: "failed",
        detail: `${updatedAlert.alert_type} alert ${updatedAlert.id} SQL execution timed out.`,
        metadata: { alert_id: updatedAlert.id, alert_type: updatedAlert.alert_type, sql_execution_timeout: true }
      });

      emitAlertNotificationEvent("updated", updatedAlert);

      return updatedAlert;
    })
  );

  return nextAlerts;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const db = url.searchParams.get("db")?.trim();
    const statusParam = url.searchParams.get("status")?.trim();
    const typeParam = url.searchParams.get("alert_type")?.trim() || url.searchParams.get("type")?.trim();
    const limit = Number(url.searchParams.get("limit") || "50");
    const page = Number(url.searchParams.get("page") || "1");
    const offsetParam = url.searchParams.get("offset");
    const offset = offsetParam == null ? (Math.max(page, 1) - 1) * Math.max(limit, 1) : Number(offsetParam);

    const result = await listAlertNotifications({
      db: db || undefined,
      alertType: typeParam ? normalizeAlertType(typeParam) : undefined,
      status: statusParam ? normalizeStatus(statusParam) : undefined,
      limit,
      offset
    });
    const items = await applySqlExecutionTimeouts(result.items);

    return NextResponse.json({ ...result, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert list error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = normalizeAlertWebhookBody(await request.json());
    const params = readObject(rawBody, ["params"]) || {};
    const body: BodyRecord = { ...params, ...rawBody, params };
    const existingAlertId = readString(body, ["id", "alert_id", "alertId"]);
    const sqlCommand = readString(body, ["sql_command", "sqlCommand", "generated_sql", "generatedSql", "sql"]);
    const postedStatus = readExecutionStatus(body);

    if (existingAlertId && isExecutionResultStatus(postedStatus)) {
      const existingAlert = await getAlertNotification(existingAlertId);
      if (!existingAlert) {
        return NextResponse.json({ message: `Alert notification not found: ${existingAlertId}` }, { status: 404 });
      }

      const actor = readString(body, ["actor", "approved_by", "approvedBy", "executed_by", "executedBy"]) || PUBLIC_ALERT_ACTOR;
      const message = readString(body, ["message", "detail", "completion_message", "completionMessage"]);
      const incomingMetadata = readObject(body, ["metadata", "raw", "payload"]);
      const alert = await updateAlertNotification({
        id: existingAlertId,
        status: postedStatus,
        actor,
        message: message || undefined,
        metadata: {
          ...(incomingMetadata || {}),
          ...buildSqlExecutionMetadata({
            existingAlert,
            status: postedStatus,
            message,
            sqlCommand,
            sqlOutput: readString(body, ["sql_output", "sqlOutput", "raw_output", "rawOutput", "output", "stdout"]),
            databaseResult: readValue(body, ["database_result", "databaseResult", "db_result", "dbResult", "result", "data"]),
            rowsAffected: readNumber(body, ["rows_affected", "rowsAffected", "row_count", "rowCount"]),
            actor
          })
        }
      });

      await insertAuditLog({
        actor,
        action: alertTypeToAuditAction(alert.alert_type),
        db: alert.db,
        status: alert.status,
        detail: `${alert.alert_type} alert ${alert.id} marked ${alert.status}.`,
        metadata: { alert_id: alert.id, alert_type: alert.alert_type, public_endpoint: true, sql_execution: true }
      });

      emitAlertNotificationEvent("updated", alert);

      return NextResponse.json({ alert });
    }

    if (existingAlertId && sqlCommand) {
      const actor = readString(body, ["created_by", "createdBy", "requested_by", "requestedBy", "actor"]) || PUBLIC_ALERT_ACTOR;
      const metadata = readObject(body, ["metadata", "raw", "payload"]) || {};
      const warnings = readStringArray(body, ["warnings", "warning_messages", "warningMessages"]);
      const explanation = readString(body, ["explanation", "ai_explanation", "aiExplanation", "summary"]);
      const databaseInfo = readObject(body, ["database_info", "databaseInfo", "db_info", "dbInfo"]);
      const tablespaceMetadata = readObjectArray(body, [
        "tablespace_metadata",
        "tablespaceMetadata",
        "metadata_rows",
        "metadataRows",
        "datafile_metadata",
        "datafileMetadata"
      ]);
      const databaseInfoMetadata = databaseInfo ? readObjectArray(databaseInfo, ["metadata"]) : undefined;

      const alert = await registerAlertSqlApproval({
        alertId: existingAlertId,
        sqlCommand,
        actor,
        approvalUrl: readString(body, ["approval_url", "approvalUrl", "approve_url", "approveUrl"]),
        rejectUrl: readString(body, ["reject_url", "rejectUrl"]),
        callbackUrl: readString(body, ["callback_url", "callbackUrl", "resume_url", "resumeUrl"]),
        callbackMethod: readString(body, ["callback_method", "callbackMethod", "method"]),
        message: readString(body, ["message", "description", "detail"]),
        metadata: {
          ...metadata,
          ...(explanation ? { explanation } : {}),
          ...(warnings ? { warnings } : {}),
          ...(databaseInfo ? { database_info: databaseInfo } : {}),
          ...(tablespaceMetadata || databaseInfoMetadata ? { tablespace_metadata: tablespaceMetadata || databaseInfoMetadata } : {}),
          request_payload: body
        }
      });

      return NextResponse.json({ alert }, { status: 202 });
    }

    const alertType = normalizeAlertType(readString(body, ["alert_type", "alertType", "type", "action"]) || "generic");
    const db = readString(body, ["db", "database", "db_name", "dbName"]);
    const tablespace = readString(body, ["tablespace", "tablespace_name", "tablespaceName"]);
    const objectName = readString(body, ["object_name", "objectName", "object"]);
    const utilizationPct = readNumber(body, ["utilization_pct", "utilizationPct", "pct_used", "pctUsed", "usage_pct", "usagePct"]);
    const thresholdPct = readNumber(body, ["threshold_pct", "thresholdPct", "threshold"]);
    const criticalPct = readNumber(body, ["critical_pct", "criticalPct", "critical_threshold_pct", "criticalThresholdPct"]);
    const severity = normalizeSeverity(readString(body, ["severity", "level"]) || "critical");
    const message =
      readString(body, ["message", "description", "detail"]) ||
      `${tablespace || objectName || alertType} alert raised on ${db}.`;

    if (!db) {
      return NextResponse.json({ message: "db is required." }, { status: 400 });
    }

    const eventId = readString(body, ["event_id", "eventId"]);
    const correlationId = readString(body, ["correlation_id", "correlationId"]);
    const idempotencyKey = readString(body, ["idempotency_key", "idempotencyKey"]);
    const incomingMetadata = readObject(body, ["metadata", "raw", "payload"]) || {};
    const metadata = {
      ...incomingMetadata,
      ...(eventId ? { event_id: eventId } : {}),
      ...(correlationId ? { correlation_id: correlationId } : {}),
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      request_payload: rawBody,
      last_seen_at: new Date().toISOString()
    };
    const alertInput = {
      source: readString(body, ["source"]) || "n8n",
      alertType,
      db,
      tablespace,
      objectName,
      severity,
      status: normalizeStatus(readString(body, ["status"]) || "pending_approval"),
      message,
      utilizationPct,
      thresholdPct,
      criticalPct,
      usedGb: readNumber(body, ["used_gb", "usedGb"]),
      freeGb: readNumber(body, ["free_gb", "freeGb"]),
      extendSizeGb: readNumber(body, ["extend_size_gb", "extendSizeGb", "add_gb", "addGb", "size_gb", "sizeGb"]),
      datafile: readString(body, ["datafile", "datafile_name", "datafileName"]),
      workflowRunId: readString(body, ["workflow_run_id", "workflowRunId", "execution_id", "executionId"]),
      approvalUrl: readString(body, ["approval_url", "approvalUrl", "approve_url", "approveUrl"]),
      rejectUrl: readString(body, ["reject_url", "rejectUrl"]),
      callbackUrl: readString(body, ["callback_url", "callbackUrl"]),
      createdBy: readString(body, ["created_by", "createdBy", "requested_by", "requestedBy"]) || PUBLIC_ALERT_ACTOR,
      metadata
    };
    const pendingOccurrence = await findPendingAlertNotificationOccurrence({
      db,
      alertType,
      tablespace,
      objectName
    });

    if (pendingOccurrence) {
      const alert = await replacePendingAlertNotification({
        id: pendingOccurrence.id,
        ...alertInput,
        metadata: {
          ...(pendingOccurrence.metadata || {}),
          ...metadata,
          refreshed_from_alert_id: pendingOccurrence.id,
          refreshed_at: new Date().toISOString()
        }
      });

      await insertAuditLog({
        actor: alertInput.createdBy,
        action: alertTypeToAuditAction(alert.alert_type),
        db,
        status: alert.status,
        detail: `${alert.alert_type} alert ${alert.id} refreshed for ${tablespace || objectName || db}.`,
        metadata: { alert_id: alert.id, alert_type: alert.alert_type, public_endpoint: true, refreshed: true }
      });

      emitAlertNotificationEvent("updated", alert);

      return NextResponse.json({ alert, refreshed: true }, { status: 200 });
    }

    const baseAlertId = existingAlertId || (idempotencyKey ? createDeterministicAlertId(idempotencyKey) : eventId || createAlertId());
    const existingAlert = await getAlertNotification(baseAlertId);
    const alertId = existingAlert ? createAlertOccurrenceId(baseAlertId) : baseAlertId;
    const alert = await insertAlertNotification({
      id: alertId,
      ...alertInput,
      metadata: {
        ...metadata,
        ...(existingAlert ? { previous_occurrence_alert_id: existingAlert.id } : {})
      }
    });

    await insertAuditLog({
      actor: readString(body, ["created_by", "createdBy", "requested_by", "requestedBy"]) || PUBLIC_ALERT_ACTOR,
      action: alertTypeToAuditAction(alertType),
      db,
      status: alert.status,
      detail: `${alert.alert_type} alert ${alert.id} created for ${tablespace || objectName || db}.`,
      metadata: { alert_id: alert.id, alert_type: alert.alert_type, public_endpoint: true }
    });

    emitAlertNotificationEvent("created", alert);

    emitGlobalNotification({
      id: alert.id,
      type: resolveNotificationType(alertType),
      severity: alert.severity,
      db: alert.db,
      title: buildAlertTitle(alertType, alert.tablespace || alert.object_name || alert.db, alert.severity),
      message: alert.message,
      timestamp: alert.created_at,
      targetPath: alertTypeToTargetPath(alertType)
    });

    return NextResponse.json({ alert }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert create error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as BodyRecord;
    const id = readString(body, ["id", "alert_id", "alertId"]);
    const status = normalizeStatus(readString(body, ["status", "state"]));
    const message = readString(body, ["message", "detail", "completion_message", "completionMessage"]);
    const sessionInfo = await readOptionalSession();
    const actor = sessionInfo?.username || readString(body, ["actor", "approved_by", "approvedBy"]) || PUBLIC_ALERT_ACTOR;
    const userId = sessionInfo?.userId;

    if (!id) {
      return NextResponse.json({ message: "id is required." }, { status: 400 });
    }

    const existingAlert = await getAlertNotification(id);
    if (!existingAlert) {
      return NextResponse.json({ message: `Alert notification not found: ${id}` }, { status: 404 });
    }

    const isExtensionAlert = existingAlert.alert_type === "tablespace" || existingAlert.alert_type === "datafile_extend";

    if (status === "acknowledged" && existingAlert.callback_url) {
      await notifyN8nAcknowledgement({
        rawUrl: existingAlert.callback_url,
        alert: existingAlert,
        actor,
        userId,
        message: message || undefined
      });
    }

    const incomingMetadata = readObject(body, ["metadata", "raw", "payload"]);
    const databaseResult = readValue(body, ["database_result", "databaseResult", "db_result", "dbResult", "result", "data"]);
    const sqlOutput = readString(body, ["sql_output", "sqlOutput", "raw_output", "rawOutput", "output", "stdout"]);
    const sqlCommand = readString(body, ["sql_command", "sqlCommand", "sql", "command"]);
    const rowsAffected = readNumber(body, ["rows_affected", "rowsAffected", "row_count", "rowCount"]);
    const executionResult =
      status === "completed" || status === "failed"
        ? {
            status,
            message: message || (status === "completed" ? "SQL executed successfully." : "SQL execution failed."),
            sql_command: sqlCommand || undefined,
            sql_output: sqlOutput || undefined,
            database_result: databaseResult,
            rows_affected: rowsAffected,
            executed_by: actor,
            executed_at: new Date().toISOString()
          }
        : undefined;
    const metadata: Record<string, unknown> | undefined =
      incomingMetadata || executionResult
        ? {
            ...(existingAlert.metadata || {}),
            ...(incomingMetadata || {}),
            ...(executionResult ? { sql_execution: executionResult } : {})
          }
        : undefined;

    if (metadata && executionResult) {
      const sqlApproval = metadata.sql_approval ?? metadata.sqlApproval;
      if (sqlApproval && typeof sqlApproval === "object" && !Array.isArray(sqlApproval)) {
        const sqlApprovalRecord = sqlApproval as Record<string, unknown>;
        metadata.sql_approval = {
          ...sqlApprovalRecord,
          status: sqlApprovalRecord.status === "rejected" ? "rejected" : "approved",
          updated_at: executionResult.executed_at,
          approved_at: sqlApprovalRecord.approved_at || executionResult.executed_at
        };
        delete metadata.sqlApproval;
      }
    }

    const alert = await updateAlertNotification({
      id,
      status,
      actor,
      message: message || undefined,
      metadata
    });

    await insertAuditLog({
      actor,
      action: alertTypeToAuditAction(alert.alert_type),
      db: alert.db,
      status: alert.status,
      detail: `${alert.alert_type} alert ${alert.id} marked ${alert.status}.`,
      metadata: { alert_id: alert.id, alert_type: alert.alert_type, public_endpoint: true }
    });

emitAlertNotificationEvent("updated", alert);

    if (status === "acknowledged" && existingAlert.alert_type === "filesystem_drive") {
      const fsTarget = alert.object_name || "";
      const auditMessage =
        `Filesystem/Drive alert acknowledged by ${actor}. ` +
        `Target: ${fsTarget}, DB: ${alert.db}. ` +
        (typeof alert.utilization_pct === "number" ? `Last utilization: ${alert.utilization_pct}%. ` : "") +
        `Alert id: ${alert.id}.`;

      const auditOutcome = await insertDbaAlertLogAudit({
        database_name: alert.db,
        error_code: "FS-DRV-ACK",
        message_text: auditMessage,
        severity: fsSeverityToAlertLogSeverity(alert.severity),
        status: "ACKNOWLEDGED",
        acknowledged_by: actor
      });

      if (auditOutcome.inserted) {
        emitGlobalNotification({
          id: `ALOG-${auditOutcome.alert_id}`,
          type: "filesystem_drive",
          severity: "info",
          db: alert.db,
          title: `Filesystem alert acknowledged: ${fsTarget}`,
          message: auditMessage,
          timestamp: new Date().toISOString(),
          targetPath: "/filesystem-drive"
        });
      }
    }

    if (status === "approved" && isExtensionAlert) {
      void dispatchDbaWorkflowCommand({
        action: "extension_approved",
        alert,
        actor,
        userId,
        params: {
          tablespace: alert.tablespace || alert.object_name,
          selected_size_gb: alert.extend_size_gb
        },
        message: message || "Tablespace extension approved."
      }).catch(async (dispatchError) => {
        const failureMessage =
          dispatchError instanceof Error
            ? `n8n SQL generation request failed: ${dispatchError.message}`
            : "n8n SQL generation request failed.";
        const failedAlert = await updateAlertNotification({
          id: alert.id,
          status: "failed",
          actor: PUBLIC_ALERT_ACTOR,
          message: failureMessage,
          metadata: {
            ...(alert.metadata || {}),
            sql_generation_error: {
              message: failureMessage,
              failed_at: new Date().toISOString()
            }
          }
        });
        await insertAuditLog({
          actor: PUBLIC_ALERT_ACTOR,
          action: alertTypeToAuditAction(failedAlert.alert_type),
          db: failedAlert.db,
          status: "failed",
          detail: failureMessage,
          metadata: { alert_id: failedAlert.id, alert_type: failedAlert.alert_type, n8n_dispatch_failed: true }
        });
        emitAlertNotificationEvent("updated", failedAlert);
      });
    }

    if (status === "rejected" && isExtensionAlert) {
      void dispatchDbaWorkflowCommand({
        action: "extension_rejected",
        alert,
        actor,
        userId,
        message: message || "Tablespace extension rejected."
      }).catch(() => undefined);
    }

    return NextResponse.json({ alert });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert update error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
