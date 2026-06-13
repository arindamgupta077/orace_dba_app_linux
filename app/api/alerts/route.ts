import { NextResponse } from "next/server";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { alertTypeToTargetPath, emitGlobalNotification, resolveNotificationType } from "@/lib/server/notification-events";
import { getAlertNotification, insertAlertNotification, insertAuditLog, listAlertNotifications, updateAlertNotification } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { registerAlertSqlApproval } from "@/lib/server/sql-approval";
import type { AlertNotificationSeverity, AlertNotificationStatus, AlertNotificationType } from "@/types/dba";

export const dynamic = "force-dynamic";

type BodyRecord = Record<string, unknown>;

const PUBLIC_ALERT_ACTOR = "n8n";

function readString(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
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

function buildAlertTitle(alertType: string, target: string, severity: string) {
  const sev = severity.toUpperCase();
  if (alertType === "tablespace") return `Tablespace ${sev}: ${target}`;
  if (alertType === "filesystem_drive") return `Filesystem ${sev}: ${target}`;
  return `Alert ${sev}: ${target}`;
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

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert list error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BodyRecord;
    const existingAlertId = readString(body, ["id", "alert_id", "alertId"]);
    const sqlCommand = readString(body, ["sql_command", "sqlCommand", "generated_sql", "generatedSql", "sql"]);
    const postedStatus = normalizeStatus(readString(body, ["status", "state"]));

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
        action: "alert_log",
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
      const alert = await registerAlertSqlApproval({
        alertId: existingAlertId,
        sqlCommand,
        actor,
        approvalUrl: readString(body, ["approval_url", "approvalUrl", "approve_url", "approveUrl"]),
        rejectUrl: readString(body, ["reject_url", "rejectUrl"]),
        callbackUrl: readString(body, ["callback_url", "callbackUrl", "resume_url", "resumeUrl"]),
        callbackMethod: readString(body, ["callback_method", "callbackMethod", "method"]),
        message: readString(body, ["message", "description", "detail"]),
        metadata: readObject(body, ["metadata", "raw", "payload"])
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

    const alert = await insertAlertNotification({
      id: existingAlertId || createAlertId(),
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
      metadata: readObject(body, ["metadata", "raw", "payload"])
    });

    await insertAuditLog({
      actor: readString(body, ["created_by", "createdBy", "requested_by", "requestedBy"]) || PUBLIC_ALERT_ACTOR,
      action: "alert_log",
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

    if (status === "approved" || status === "rejected") {
      const resumeUrl = getResumeUrlForStatus(existingAlert, status);
      if (resumeUrl) {
        await resumeN8nWaitNode(resumeUrl, status, id, actor, userId);
      }
    }

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
      action: "alert_log",
      db: alert.db,
      status: alert.status,
      detail: `${alert.alert_type} alert ${alert.id} marked ${alert.status}.`,
      metadata: { alert_id: alert.id, alert_type: alert.alert_type, public_endpoint: true }
    });

    emitAlertNotificationEvent("updated", alert);

    return NextResponse.json({ alert });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert update error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
