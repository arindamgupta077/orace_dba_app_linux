import "server-only";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { alertTypeToAuditAction, deriveAlertSubject } from "@/lib/server/notification-events";
import { dispatchDbaWorkflowCommand, validateTablespaceExtensionSql } from "@/lib/server/dba-workflow";
import { getAlertNotification, insertAuditLog, listAlertNotifications, patchAlertNotification } from "@/lib/server/repository";
import type { AlertNotification, AlertSqlApproval, AlertSqlApprovalDecision, AlertSqlExecutionResult } from "@/types/dba";

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

interface SqlApprovalWaitPayload {
  action: "execute_sql" | "sql_rejected";
  decision: AlertSqlApprovalDecision;
  alert_id: string;
  db: string;
  tablespace?: string;
  object_name?: string;
  approved_by?: string;
  rejected_by?: string;
  requested_by: string;
  user_id?: number;
  sql: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapWorkflowResponse(raw: unknown): Record<string, unknown> {
  let current = raw;

  for (let index = 0; index < 6; index += 1) {
    if (Array.isArray(current)) {
      current = current[0];
      continue;
    }

    if (!isRecord(current)) return {};

    const wrapped = current.json ?? current.body ?? current.data ?? current.payload;
    if (wrapped && wrapped !== current) {
      current = wrapped;
      continue;
    }

    return current;
  }

  return isRecord(current) ? current : {};
}

function readString(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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

async function parseResponseBody(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function resumeDatafileSqlApprovalWaitNode(
  sqlApproval: AlertSqlApproval,
  payload: SqlApprovalWaitPayload
) {
  const decisionUrl = payload.decision === "approved" ? sqlApproval.approval_url : sqlApproval.reject_url;
  const callbackUrl = decisionUrl || sqlApproval.callback_url;
  if (!callbackUrl) return undefined;
  const resumeUrl = callbackUrl;

  async function sendResumeRequest(method: CallbackMethod) {
    const parsedUrl = normalizeAutomationUrl(resumeUrl);

    if (method === "POST") {
      return fetch(parsedUrl.toString(), {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        parsedUrl.searchParams.set(key, String(value));
      }
    });

    return fetch(parsedUrl.toString(), {
      method: "GET",
      cache: "no-store"
    });
  }

  const preferredMethod = sqlApproval.callback_method || "POST";
  let response = await sendResumeRequest(preferredMethod);
  let body = response.ok ? "" : await response.text().catch(() => response.statusText);

  if (
    !response.ok &&
    response.status === 404 &&
    /matching path\/method|waiting webhook/i.test(body)
  ) {
    const fallbackMethod: CallbackMethod = preferredMethod === "POST" ? "GET" : "POST";
    response = await sendResumeRequest(fallbackMethod);
    body = response.ok ? "" : await response.text().catch(() => response.statusText);
  }

  if (!response.ok) {
    throw new Error(`n8n SQL approval wait resume failed (${response.status}): ${body || response.statusText}`);
  }

  return parseResponseBody(response);
}

function readNumber(body: Record<string, unknown>, keys: string[]) {
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

function readValue(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const value = body[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function normalizeExecutionStatus(body: Record<string, unknown>) {
  const rawStatus = readString(body, ["status", "state", "execution_status", "executionStatus"]);
  const status = rawStatus.toLowerCase();
  if (status === "completed" || status === "success" || status === "executed" || status === "execution_completed") return "completed";
  if (status === "failed" || status === "error" || status === "failure" || status === "execution_failed") return "failed";

  const code = readString(body, ["error_code", "errorCode", "code", "reason"]).toLowerCase();
  const message = readString(body, ["message", "detail", "error", "sql_output", "sqlOutput", "output"]);
  if (
    code.includes("no_disk") ||
    code.includes("disk_space") ||
    /no\s+disk\s+space|not\s+enough\s+(os\s+)?disk\s+space|insufficient\s+(os\s+)?disk\s+space|free\s+space/i.test(message)
  ) {
    return "failed";
  }

  if (/sql\s+executed\s+successfully|execution\s+completed/i.test(message)) return "completed";
  if (/sql\s+execution\s+failed|execution\s+failed|ora-\d+/i.test(message)) return "failed";

  return "";
}

function normalizeImmediateExecutionResult(raw: unknown, sqlCommand: string, actor: string): AlertSqlExecutionResult | null {
  const body = unwrapWorkflowResponse(raw);
  if (!Object.keys(body).length) return null;

  const status = normalizeExecutionStatus(body);
  if (status !== "completed" && status !== "failed") return null;

  const message =
    readString(body, ["message", "detail", "error", "completion_message", "completionMessage"]) ||
    (status === "completed" ? "SQL executed successfully." : "SQL execution failed.");

  return {
    status,
    message,
    sql_command: readString(body, ["sql_command", "sqlCommand", "sql", "command"]) || sqlCommand,
    sql_output: readString(body, ["sql_output", "sqlOutput", "raw_output", "rawOutput", "output", "stdout"]) || undefined,
    database_result: readValue(body, ["database_result", "databaseResult", "db_result", "dbResult", "result", "data"]) ?? raw,
    rows_affected: readNumber(body, ["rows_affected", "rowsAffected", "row_count", "rowCount"]),
    executed_by: readString(body, ["executed_by", "executedBy", "actor", "requested_by", "requestedBy"]) || actor,
    executed_at: new Date().toISOString()
  };
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
      explanation: typeof input.metadata?.explanation === "string" ? input.metadata.explanation : previousSqlApproval?.explanation,
      warnings: Array.isArray(input.metadata?.warnings) ? input.metadata.warnings : previousSqlApproval?.warnings,
      database_info:
        input.metadata?.database_info && typeof input.metadata.database_info === "object"
          ? (input.metadata.database_info as Record<string, unknown>)
          : previousSqlApproval?.database_info,
      tablespace_metadata: Array.isArray(input.metadata?.tablespace_metadata)
        ? (input.metadata.tablespace_metadata as Array<Record<string, unknown>>)
        : previousSqlApproval?.tablespace_metadata,
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
    action: alertTypeToAuditAction(alert.alert_type),
    db: alert.db,
    status: "pending_approval",
    detail: `${alert.alert_type} alert for ${deriveAlertSubject(alert)} is waiting for SQL approval.`,
    sqlCommand: input.sqlCommand || undefined,
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
  const safeSqlCommand = input.decision === "approved" ? validateTablespaceExtensionSql(finalSqlCommand) : finalSqlCommand;

  const now = new Date().toISOString();
  const metadata = {
    ...(existingAlert.metadata || {}),
    sql_approval: {
      ...previousSqlApproval,
      status: input.decision,
      sql_command: safeSqlCommand,
      updated_at: now,
      message: input.message || undefined,
      ...(input.decision === "approved"
        ? { approved_by: input.actor, approved_at: now, rejected_by: undefined, rejected_at: undefined }
        : { rejected_by: input.actor, rejected_at: now, approved_by: undefined, approved_at: undefined })
    }
  };

  const shouldResumeDatafileWaitNode =
    existingAlert.alert_type === "datafile_extend" &&
    Boolean(previousSqlApproval.callback_url || previousSqlApproval.approval_url || previousSqlApproval.reject_url);

  if (shouldResumeDatafileWaitNode) {
    const waitResponse = await resumeDatafileSqlApprovalWaitNode(previousSqlApproval, {
      action: input.decision === "approved" ? "execute_sql" : "sql_rejected",
      decision: input.decision,
      alert_id: existingAlert.id,
      db: existingAlert.db,
      tablespace: existingAlert.tablespace,
      object_name: existingAlert.object_name,
      approved_by: input.decision === "approved" ? input.actor : undefined,
      rejected_by: input.decision === "rejected" ? input.actor : undefined,
      requested_by: input.actor,
      user_id: input.userId,
      sql: safeSqlCommand,
      sql_command: safeSqlCommand,
      original_sql_command: previousSqlApproval.original_sql_command,
      workflow_run_id: existingAlert.workflow_run_id,
      message: input.message
    });

    const alert = await patchAlertNotification({
      id: input.alertId,
      status: input.decision === "rejected" ? "rejected" : "approved",
      actor: input.actor,
      metadata: {
        ...metadata,
        sql_approval_wait_node: {
          resumed: true,
          method: previousSqlApproval.callback_method || "POST",
          response: waitResponse,
          resumed_at: now
        }
      }
    });

    await insertAuditLog({
      actor: input.actor,
      action: alertTypeToAuditAction(alert.alert_type),
      db: alert.db,
      status: input.decision,
      detail: `${alert.alert_type} alert for ${deriveAlertSubject(alert)} SQL ${input.decision}; resumed n8n wait node.`,
      sqlCommand: safeSqlCommand || undefined,
      metadata: { alert_id: alert.id, alert_type: alert.alert_type, sql_approval: true, wait_node_resumed: true }
    });

    emitAlertNotificationEvent("updated", alert);

    return alert;
  }

  if (input.decision === "approved") {
    const dispatchResult = await dispatchDbaWorkflowCommand({
      action: "execute_sql",
      alert: existingAlert,
      actor: input.actor,
      userId: input.userId,
      sql: safeSqlCommand,
      params: {
        sql: safeSqlCommand,
        original_sql_command: previousSqlApproval.original_sql_command,
        workflow_run_id: existingAlert.workflow_run_id
      },
      message: input.message || "SQL approved for execution."
    });

    const immediateExecutionResult = normalizeImmediateExecutionResult(dispatchResult.response, safeSqlCommand, input.actor);
    if (immediateExecutionResult) {
      const alert = await patchAlertNotification({
        id: input.alertId,
        status: immediateExecutionResult.status,
        actor: input.actor,
        message: immediateExecutionResult.message,
        metadata: {
          ...metadata,
          sql_execution: immediateExecutionResult
        }
      });

      // For "completed": skip the audit log — the inference logic on GET
      // writes the "inferred SQL execution completed" entry.  For "failed":
      // write the audit log here since the inference skips "failed".
      if (immediateExecutionResult.status === "failed") {
        await insertAuditLog({
          actor: input.actor,
          action: alertTypeToAuditAction(alert.alert_type),
          db: alert.db,
          status: immediateExecutionResult.status,
          detail: `${alert.alert_type} alert for ${deriveAlertSubject(alert)} on database ${alert.db} SQL execution ${immediateExecutionResult.status}. ${immediateExecutionResult.message || ""}`.trim(),
          sqlCommand: safeSqlCommand || undefined,
          metadata: { alert_id: alert.id, alert_type: alert.alert_type, sql_execution: true, immediate_response: true }
        });
      }

      emitAlertNotificationEvent("updated", alert);

      return alert;
    }
  } else {
    await dispatchDbaWorkflowCommand({
      action: "sql_rejected",
      alert: existingAlert,
      actor: input.actor,
      userId: input.userId,
      sql: safeSqlCommand,
      message: input.message || "Generated SQL rejected."
    }).catch(() => ({ skipped: true }));
  }

  const alert = await patchAlertNotification({
    id: input.alertId,
    status: input.decision === "rejected" ? "rejected" : "approved",
    actor: input.actor,
    metadata
  });

  await insertAuditLog({
    actor: input.actor,
    action: alertTypeToAuditAction(alert.alert_type),
    db: alert.db,
    status: input.decision,
    detail: `${alert.alert_type} alert for ${deriveAlertSubject(alert)} SQL ${input.decision}.`,
    sqlCommand: safeSqlCommand || undefined,
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
