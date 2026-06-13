import { NextResponse } from "next/server";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { getAlertNotification, insertAuditLog, updateAlertNotification } from "@/lib/server/repository";
import { decideAlertSqlApproval, listPendingAlertSqlApprovals, registerAlertSqlApproval } from "@/lib/server/sql-approval";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { AlertNotification, AlertSqlApprovalDecision } from "@/types/dba";

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

function readObject(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
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

function readValue(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const value = body[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function normalizeDecision(raw: string): AlertSqlApprovalDecision {
  const decision = raw.toLowerCase();
  if (decision === "approved" || decision === "rejected") return decision;
  return "approved";
}

function normalizeExecutionStatus(raw: string) {
  const status = raw.toLowerCase();
  if (status === "completed" || status === "success" || status === "executed" || status === "execution_completed") return "completed";
  if (status === "failed" || status === "error" || status === "failure" || status === "execution_failed") return "failed";
  return "";
}

function buildSqlExecutionMetadata(input: {
  existingAlert: AlertNotification;
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

async function readOptionalSession() {
  try {
    const session = await requireAuthenticatedSession();
    return session ? { username: session.user.username, userId: session.userId } : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const db = url.searchParams.get("db")?.trim() || undefined;
    const limit = Number(url.searchParams.get("limit") || "200");
    const items = await listPendingAlertSqlApprovals({ db, limit });

    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected SQL approval list error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BodyRecord;
    const alertId = readString(body, ["id", "alert_id", "alertId"]);
    const sqlCommand = readString(body, ["sql_command", "sqlCommand", "generated_sql", "generatedSql", "sql", "command"]);
    const executionStatus = normalizeExecutionStatus(readString(body, ["status", "state"]));
    const actor = readString(body, ["created_by", "createdBy", "requested_by", "requestedBy", "actor"]) || PUBLIC_ALERT_ACTOR;

    if (!alertId) {
      return NextResponse.json({ message: "alert_id is required." }, { status: 400 });
    }

    if (executionStatus) {
      const existingAlert = await getAlertNotification(alertId);
      if (!existingAlert) {
        return NextResponse.json({ message: `Alert notification not found: ${alertId}` }, { status: 404 });
      }

      const message = readString(body, ["message", "detail", "completion_message", "completionMessage"]);
      const incomingMetadata = readObject(body, ["metadata", "raw", "payload"]);
      const alert = await updateAlertNotification({
        id: alertId,
        status: executionStatus,
        actor,
        message: message || undefined,
        metadata: {
          ...(incomingMetadata || {}),
          ...buildSqlExecutionMetadata({
            existingAlert,
            status: executionStatus,
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

    if (!sqlCommand) {
      return NextResponse.json({ message: "sql_command is required." }, { status: 400 });
    }

    const alert = await registerAlertSqlApproval({
      alertId,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected SQL approval create error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as BodyRecord;
    const alertId = readString(body, ["id", "alert_id", "alertId"]);
    const decision = normalizeDecision(readString(body, ["decision", "status", "state"]));
    const sessionInfo = await readOptionalSession();
    const actor =
      sessionInfo?.username ||
      readString(body, ["actor", "approved_by", "approvedBy", "rejected_by", "rejectedBy"]) ||
      PUBLIC_ALERT_ACTOR;
    const userId = sessionInfo?.userId;

    if (!alertId) {
      return NextResponse.json({ message: "alert_id is required." }, { status: 400 });
    }

    const alert = await decideAlertSqlApproval({
      alertId,
      decision,
      sqlCommand: readString(body, ["sql_command", "sqlCommand", "sql", "command"]),
      actor,
      userId,
      message: readString(body, ["message", "detail"])
    });

    return NextResponse.json({ alert });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected SQL approval update error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
