import { NextResponse } from "next/server";

import { getActionDefinition } from "@/lib/action-catalog";
import { findDatabaseTarget } from "@/lib/constants";
import { getServerEnv } from "@/lib/server/env";
import { insertAuditLog, insertRequestHistory, persistRunData } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { createMockResponse } from "@/services/mock-data";
import type { DbaAction, DbaRequestPayload, DbaResponse } from "@/types/dba";

interface RequestBody {
  action?: string;
  db?: string;
  params?: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapN8nItem(value: unknown) {
  if (isRecord(value) && "json" in value) {
    return value.json;
  }
  return value;
}

function toRecordArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const rows = value.map(unwrapN8nItem).filter(isRecord);
  return rows.length ? rows : undefined;
}

function firstRowsArray(record: JsonRecord) {
  const rawData = isRecord(record.raw_data) ? record.raw_data : undefined;
  const nestedRecords = [record.result, record.body, record.response].filter(isRecord);

  for (const value of [
    record.rows,
    record.data,
    record.items,
    rawData?.rows,
    rawData?.data,
    ...nestedRecords.flatMap((nested) => [nested.rows, nested.data, nested.items])
  ]) {
    const rows = toRecordArray(value);
    if (rows) return rows;
  }

  return undefined;
}

function hasTextOutput(record: JsonRecord) {
  return ["raw_output", "rawOutput", "output", "stdout", "stderr", "text", "log", "logs"].some(
    (key) => typeof record[key] === "string" && String(record[key]).trim()
  );
}

function collectRows(input: unknown) {
  if (Array.isArray(input)) {
    const rows: JsonRecord[] = [];
    for (const item of input.map(unwrapN8nItem)) {
      if (Array.isArray(item)) {
        const nestedRows = toRecordArray(item);
        if (nestedRows) rows.push(...nestedRows);
        continue;
      }
      if (!isRecord(item)) continue;
      const nestedRows = firstRowsArray(item);
      if (nestedRows) {
        rows.push(...nestedRows);
      } else if (!hasTextOutput(item)) {
        rows.push(item);
      }
    }
    return rows;
  }

  if (isRecord(input)) {
    return firstRowsArray(input) || [];
  }

  return [];
}

function readTextOutput(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";

  const unwrapped = unwrapN8nItem(value);

  if (typeof unwrapped === "string") return unwrapped;
  if (typeof unwrapped === "number" || typeof unwrapped === "boolean") return String(unwrapped);

  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map((item) => readTextOutput(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }

  if (!isRecord(unwrapped)) return "";

  const rawData = isRecord(unwrapped.raw_data) ? unwrapped.raw_data : undefined;
  const nestedRecords = [unwrapped.result, unwrapped.body, unwrapped.response].filter(isRecord);

  for (const source of [unwrapped, rawData, ...nestedRecords]) {
    if (!source) continue;
    for (const key of ["raw_output", "rawOutput", "output", "stdout", "stderr", "text", "log", "logs"]) {
      const output = readTextOutput(source[key], depth + 1);
      if (output) return output;
    }
  }

  return "";
}

function normalizeDbaResponse(input: unknown, action: DbaAction): DbaResponse {
  // When n8n sends $input.all().map(i => i.json), input is an array of row objects.
  // When n8n sends a structured DbaResponse envelope, input is a plain object.
  const isArrayInput = Array.isArray(input);
  const payload = !isArrayInput && input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const status = payload.status === "pending_approval" || payload.status === "error" ? payload.status : "success";

  // Start rawData from any existing raw_data envelope in the payload
  const rawData: DbaResponse["raw_data"] =
    payload.raw_data && typeof payload.raw_data === "object"
      ? { ...(payload.raw_data as DbaResponse["raw_data"]) }
      : {};

  // Collect tabular rows from whatever shape n8n sent
  const rows = collectRows(input);
  const textOutput = readTextOutput(input);

  // If n8n sent a flat array but collectRows came back empty (e.g. all rows had
  // a key that tripped hasTextOutput), fall back to treating the raw array items
  // directly as rows.
  const effectiveRows: JsonRecord[] =
    rows.length > 0
      ? rows
      : isArrayInput
        ? (input as unknown[]).map(unwrapN8nItem).filter(isRecord)
        : [];

  if (effectiveRows.length > 0) {
    rawData.rows = effectiveRows;
  }

  // Serialize rows into raw_output so the frontend fallback JSON-parse path
  // also works when smart extraction misses them.
  const rawOutput =
    textOutput ||
    (effectiveRows.length > 0 ? JSON.stringify(effectiveRows, null, 2) : "");

  return {
    status,
    request_id:
      typeof payload.request_id === "string" && payload.request_id
        ? payload.request_id
        : `DBA-${Date.now()}`,
    action,
    db_status:
      payload.db_status === "healthy" ||
      payload.db_status === "warning" ||
      payload.db_status === "critical" ||
      payload.db_status === "unknown"
        ? payload.db_status
        : "unknown",
    ai_summary:
      typeof payload.ai_summary === "string" ? payload.ai_summary : "Execution completed.",
    findings: Array.isArray(payload.findings)
      ? (payload.findings as DbaResponse["findings"])
      : [],
    recommendations: Array.isArray(payload.recommendations)
      ? (payload.recommendations as DbaResponse["recommendations"])
      : [],
    raw_data: rawData,
    raw_output: rawOutput,
    approval:
      payload.approval && typeof payload.approval === "object"
        ? (payload.approval as DbaResponse["approval"])
        : undefined
  };
}

export async function POST(request: Request) {
  const requestId = `REQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const startedAt = Date.now();

  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let payload: DbaRequestPayload | null = null;

  try {
    const body = (await request.json()) as RequestBody;
    const action = (body.action || "").trim() as DbaAction;
    const db = (body.db || "").trim();
    const params = body.params && typeof body.params === "object" ? body.params : {};

    if (!action || !db) {
      return NextResponse.json({ message: "Both action and db are required." }, { status: 400 });
    }

    const definition = getActionDefinition(action);
    if (!definition) {
      return NextResponse.json({ message: `Unsupported action: ${action}` }, { status: 400 });
    }

    const dbTarget = findDatabaseTarget(db);
    payload = {
      action,
      db,
      params,
      requested_by: session.user.username,
      user_id: session.userId,
      environment: dbTarget?.env_label,
      os: dbTarget?.os,
      db_type: dbTarget?.db_type
    };

    const env = getServerEnv();
    let result: DbaResponse;

    if (env.mockMode) {
      await sleep(850 + Math.random() * 650);
      result = normalizeDbaResponse(createMockResponse(action, db, Boolean(definition.destructive), params), action);
    } else {
      if (!env.webhookUrl) {
        throw new Error("NEXT_PUBLIC_DBA_WEBHOOK_URL is required when mock mode is disabled.");
      }

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

      result = normalizeDbaResponse(await response.json(), action);
    }

    const durationMs = Date.now() - startedAt;
    await insertRequestHistory({
      id: requestId,
      action,
      db,
      requestedBy: session.user.username,
      status: result.status,
      durationMs,
      payload,
      response: result
    });
    await persistRunData({
      historyRequestId: requestId,
      externalRequestId: result.request_id,
      requestedBy: session.user.username,
      action,
      db,
      status: result.status,
      aiSummary: result.ai_summary,
      rawOutput: result.raw_output,
      rawData: result.raw_data,
      findings: result.findings,
      recommendations: result.recommendations
    });
    await insertAuditLog({
      actor: session.user.username,
      action,
      db,
      status: result.status,
      detail: `${action} submitted to n8n webhook for ${db}.`,
      metadata: { request_id: result.request_id, duration_ms: durationMs }
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected DBA action failure.";
    const durationMs = Date.now() - startedAt;

    if (payload) {
      await insertRequestHistory({
        id: requestId,
        action: payload.action,
        db: payload.db,
        requestedBy: session.user.username,
        status: "error",
        durationMs,
        payload,
        error: message
      });
      await insertAuditLog({
        actor: session.user.username,
        action: payload.action,
        db: payload.db,
        status: "error",
        detail: message,
        metadata: { duration_ms: durationMs }
      });
    }

    return NextResponse.json({ message }, { status: 500 });
  }
}
