import "server-only";

import { getServerEnv } from "@/lib/server/env";
import { getDatabaseTargetByName } from "@/lib/server/repository";
import type { AlertNotification } from "@/types/dba";

type WorkflowAction = "extension_approved" | "extension_rejected" | "execute_sql" | "sql_rejected";

interface DispatchWorkflowCommandInput {
  action: WorkflowAction;
  alert: AlertNotification;
  actor: string;
  userId?: number;
  params?: Record<string, unknown>;
  sql?: string;
  message?: string;
}

interface DbaWorkflowDispatchResult {
  skipped: boolean;
  reason?: string;
  response?: unknown;
}

const BLOCKED_SQL_TOKENS = [
  "DROP",
  "TRUNCATE",
  "DELETE",
  "UPDATE",
  "INSERT",
  "MERGE",
  "CREATE USER",
  "GRANT",
  "REVOKE",
  "ALTER SYSTEM",
  "ALTER USER",
  "EXEC",
  "EXECUTE",
  "BEGIN",
  "DECLARE",
  "DBMS_"
];

function readCorrelationId(alert: AlertNotification) {
  const raw = alert.metadata?.correlation_id ?? alert.metadata?.correlationId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : alert.id;
}

function normalizeSql(sql: string) {
  return sql.trim().replace(/\s+/g, " ");
}

export function validateTablespaceExtensionSql(sql: string) {
  const compactSql = normalizeSql(sql);
  const upperSql = compactSql.toUpperCase();

  if (!compactSql) {
    throw new Error("SQL command is required.");
  }

  if (compactSql.includes(";")) {
    throw new Error("Only one SQL statement is allowed. Remove the semicolon before approval.");
  }

  const blockedToken = BLOCKED_SQL_TOKENS.find((token) => upperSql.includes(token));
  if (blockedToken) {
    throw new Error(`SQL contains a blocked token: ${blockedToken}.`);
  }

  return compactSql;
}

async function parseErrorMessage(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText;

  try {
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message || text;
  } catch {
    return text;
  }
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

export async function dispatchDbaWorkflowCommand(input: DispatchWorkflowCommandInput): Promise<DbaWorkflowDispatchResult> {
  const env = getServerEnv();
  if (env.mockMode) {
    return { skipped: true, reason: "mock_mode" };
  }

  if (!env.webhookUrl) {
    throw new Error("DBA_WEBHOOK_URL is required when mock mode is disabled.");
  }

  const dbTarget = await getDatabaseTargetByName(input.alert.db);
  const params = {
    alert_id: input.alert.id,
    tablespace: input.alert.tablespace || input.alert.object_name,
    utilization_pct: input.alert.utilization_pct,
    threshold_pct: input.alert.threshold_pct,
    extend_size_gb: input.alert.extend_size_gb,
    datafile: input.alert.datafile,
    ...(input.params || {})
  };
  const payload = {
    action: input.action,
    correlation_id: readCorrelationId(input.alert),
    alert_id: input.alert.id,
    db: input.alert.db,
    sql: input.sql,
    requested_by: input.actor,
    user_id: input.userId,
    environment: dbTarget?.env_label,
    os: dbTarget?.os,
    db_type: dbTarget?.db_type,
    message: input.message,
    params
  };

  const response = await fetch(env.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {})
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(`n8n webhook failed (${response.status}): ${message}`);
  }

  return { skipped: false, response: await parseResponseBody(response) };
}
