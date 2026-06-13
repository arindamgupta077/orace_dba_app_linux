import "server-only";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { getAlertNotification, insertAuditLog, listAlertNotifications, patchAlertNotification } from "@/lib/server/repository";
import type { AlertNotification, AlertSqlApproval, AlertSqlApprovalDecision } from "@/types/dba";

type CallbackMethod = NonNullable<AlertSqlApproval["callback_method"]>;

interface RegisterSqlApprovalInput {
  alertId: string;
  sqlCommand: string;
  actor: string;
  approvalUrl?: string;
  rejectUrl?: string;
  callbackUrl?: string;
  callbackMethod?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface DecideSqlApprovalInput {
  alertId: string;
  decision: AlertSqlApprovalDecision;
  sqlCommand?: string;
  actor: string;
  userId?: number;
  message?: string;
}

interface SqlApprovalCallbackPayload {
  decision: AlertSqlApprovalDecision;
  alert_id: string;
  db: string;
  tablespace?: string;
  object_name?: string;
  approved_by: string;
  user_id?: number;
  sql_command: string;
  original_sql_command?: string;
  workflow_run_id?: string;
  message?: string;
}

function normalizeCallbackMethod(raw?: string): CallbackMethod | undefined {
  const method = raw?.trim().toUpperCase();
  if (method === "GET" || method === "POST") return method;
  return undefined;
}

function readSqlApproval(alert: AlertNotification): AlertSqlApproval | undefined {
  const raw = alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const record = raw as Record<string, unknown>;
  const status = String(record.status || "");
  const sqlCommand = typeof record.sql_command === "string" ? record.sql_command : "";
  if (!sqlCommand || (status !== "pending" && status !== "approved" && status !== "rejected")) return undefined;

  return record as unknown as AlertSqlApproval;
}

function normalizeAutomationUrl(rawUrl: string) {
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

  return parsed;
}

async function notifySqlApprovalCallback(sqlApproval: AlertSqlApproval, payload: SqlApprovalCallbackPayload) {
  const decisionUrl = payload.decision === "approved" ? sqlApproval.approval_url : sqlApproval.reject_url;
  const callbackUrl = decisionUrl || sqlApproval.callback_url;
  if (!callbackUrl) return;

  const method = sqlApproval.callback_method || (decisionUrl ? "GET" : "POST");
  const parsedUrl = normalizeAutomationUrl(callbackUrl);

  if (method === "GET") {
    Object.entries(payload).forEach(([key, value]) => {
      if (value != null) parsedUrl.searchParams.set(key, String(value));
    });

    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`n8n SQL approval callback failed (${response.status} ${response.statusText}).`);
    }
    return;
  }

  const response = await fetch(parsedUrl.toString(), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`n8n SQL approval callback failed (${response.status} ${response.statusText}).`);
  }
}

export async function registerAlertSqlApproval(input: RegisterSqlApprovalInput) {
  const existingAlert = await getAlertNotification(input.alertId);
  if (!existingAlert) {
    throw new Error(`Alert notification not found: ${input.alertId}`);
  }

  const now = new Date().toISOString();
  const previousSqlApproval = readSqlApproval(existingAlert);
  const isPendingRetry = previousSqlApproval?.status === "pending";
  const metadata = {
    ...(existingAlert.metadata || {}),
    sql_approval: {
      status: "pending",
      sql_command: input.sqlCommand,
      original_sql_command: isPendingRetry ? previousSqlApproval?.original_sql_command || input.sqlCommand : input.sqlCommand,
      approval_url: input.approvalUrl || previousSqlApproval?.approval_url,
      reject_url: input.rejectUrl || previousSqlApproval?.reject_url,
      callback_url: input.callbackUrl || previousSqlApproval?.callback_url,
      callback_method: normalizeCallbackMethod(input.callbackMethod) || previousSqlApproval?.callback_method,
      created_at: isPendingRetry ? previousSqlApproval?.created_at || now : now,
      updated_at: now,
      requested_by: input.actor,
      request: input.metadata
    }
  };

  const alert = await patchAlertNotification({
    id: input.alertId,
    status: "approved",
    actor: input.actor,
    message: input.message,
    metadata
  });

  await insertAuditLog({
    actor: input.actor,
    action: "alert_log",
    db: alert.db,
    status: "sql_pending_approval",
    detail: `${alert.alert_type} alert ${alert.id} is waiting for SQL approval.`,
    metadata: { alert_id: alert.id, alert_type: alert.alert_type, sql_approval: true }
  });

  emitAlertNotificationEvent("updated", alert);

  return alert;
}

export async function decideAlertSqlApproval(input: DecideSqlApprovalInput) {
  const existingAlert = await getAlertNotification(input.alertId);
  if (!existingAlert) {
    throw new Error(`Alert notification not found: ${input.alertId}`);
  }

  const previousSqlApproval = readSqlApproval(existingAlert);
  if (!previousSqlApproval) {
    throw new Error(`SQL approval request not found for alert: ${input.alertId}`);
  }

  const finalSqlCommand = (input.sqlCommand || previousSqlApproval.sql_command).trim();
  if (!finalSqlCommand) {
    throw new Error("sql_command is required.");
  }

  const now = new Date().toISOString();
  const metadata = {
    ...(existingAlert.metadata || {}),
    sql_approval: {
      ...previousSqlApproval,
      status: input.decision,
      sql_command: finalSqlCommand,
      updated_at: now,
      message: input.message || undefined,
      ...(input.decision === "approved"
        ? { approved_by: input.actor, approved_at: now, rejected_by: undefined, rejected_at: undefined }
        : { rejected_by: input.actor, rejected_at: now, approved_by: undefined, approved_at: undefined })
    }
  };

  await notifySqlApprovalCallback(previousSqlApproval, {
    decision: input.decision,
    alert_id: existingAlert.id,
    db: existingAlert.db,
    tablespace: existingAlert.tablespace,
    object_name: existingAlert.object_name,
    approved_by: input.actor,
    user_id: input.userId,
    sql_command: finalSqlCommand,
    original_sql_command: previousSqlApproval.original_sql_command,
    workflow_run_id: existingAlert.workflow_run_id,
    message: input.message
  });

  const alert = await patchAlertNotification({
    id: input.alertId,
    status: input.decision === "rejected" ? "rejected" : "approved",
    actor: input.actor,
    metadata
  });

  await insertAuditLog({
    actor: input.actor,
    action: "alert_log",
    db: alert.db,
    status: `sql_${input.decision}`,
    detail: `${alert.alert_type} alert ${alert.id} SQL ${input.decision}.`,
    metadata: { alert_id: alert.id, alert_type: alert.alert_type, sql_approval: true }
  });

  emitAlertNotificationEvent("updated", alert);

  return alert;
}

export async function listPendingAlertSqlApprovals(input: { db?: string; limit?: number } = {}) {
  const result = await listAlertNotifications({
    db: input.db,
    alertType: "tablespace",
    limit: input.limit || 200,
    offset: 0
  });

  return result.items.filter((alert) => {
    if (alert.status === "completed" || alert.status === "failed" || alert.status === "rejected") return false;
    return readSqlApproval(alert)?.status === "pending";
  });
}
