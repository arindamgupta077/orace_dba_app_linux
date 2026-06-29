import { NextResponse } from "next/server";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { dispatchDbaWorkflowCommand } from "@/lib/server/dba-workflow";
import { getAlertNotification, insertAuditLog, updateAlertNotification } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { AlertNotification } from "@/types/dba";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeN8nUrl(rawUrl: string) {
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

function readString(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) return "";

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function findStringDeep(value: unknown, keys: string[], depth = 0): string {
  if (depth > 5) return "";

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringDeep(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }

  if (!isRecord(value)) return "";

  const direct = readString(value, keys);
  if (direct) return direct;

  for (const nested of Object.values(value)) {
    if (isRecord(nested) || Array.isArray(nested)) {
      const found = findStringDeep(nested, keys, depth + 1);
      if (found) return found;
    }
  }

  return "";
}

function readDatafileSelectionResumeUrl(alert: AlertNotification) {
  const meta = (alert.metadata || {}) as Record<string, unknown>;
  const resumeKeys = [
    "selection_resume_url",
    "selectionResumeUrl",
    "resume_url",
    "resumeUrl",
    "callback_url",
    "callbackUrl"
  ];

  return alert.callback_url || findStringDeep(meta, resumeKeys);
}

function readDatafileSelectionResumeMethod(alert: AlertNotification) {
  const meta = (alert.metadata || {}) as Record<string, unknown>;
  const rawMethod = findStringDeep(meta, [
    "selection_resume_method",
    "selectionResumeMethod",
    "resume_method",
    "resumeMethod",
    "callback_method",
    "callbackMethod",
    "method"
  ]);
  const method = rawMethod.toUpperCase();

  if (method === "POST") return "POST";
  return "GET";
}

async function parseN8nResponse(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function resumeDatafileSelectionWaitNode(input: {
  alert: AlertNotification;
  rawUrl: string;
  method: "GET" | "POST";
  actor: string;
  userId?: number;
  tablespace: string;
  sizeGb: number;
}) {
  const selectedAt = new Date().toISOString();
  const payload = {
    action: "extension_approved",
    alert_id: input.alert.id,
    correlation_id:
      typeof input.alert.metadata?.correlation_id === "string"
        ? input.alert.metadata.correlation_id
        : input.alert.id,
    db: input.alert.db,
    tablespace: input.tablespace,
    selected_tablespace: input.tablespace,
    selected_size_gb: input.sizeGb,
    size_gb: input.sizeGb,
    requested_by: input.actor,
    selected_by: input.actor,
    user_id: input.userId,
    selected_at: selectedAt,
    message: `Tablespace ${input.tablespace} selected for extension (${input.sizeGb} GB).`
  };

  let response: Response;

  if (input.method === "POST") {
    response = await fetch(normalizeN8nUrl(input.rawUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
  } else {
    const resumeUrl = normalizeN8nUrl(input.rawUrl);
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        resumeUrl.searchParams.set(key, String(value));
      }
    });

    response = await fetch(resumeUrl.toString(), {
      method: "GET",
      cache: "no-store"
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`n8n wait resume failed (${response.status}): ${body || response.statusText}`);
  }

  return parseN8nResponse(response);
}

export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const alertId = String(body.alert_id || "").trim();
  const tablespace = String(body.tablespace || "").trim().toUpperCase();
  const sizeGb = Number(body.size_gb);

  if (!alertId) {
    return NextResponse.json({ message: "alert_id is required." }, { status: 400 });
  }
  if (!tablespace) {
    return NextResponse.json({ message: "tablespace is required." }, { status: 400 });
  }
  if (!Number.isFinite(sizeGb) || sizeGb <= 0) {
    return NextResponse.json({ message: "size_gb must be a positive number." }, { status: 400 });
  }

  const alert = await getAlertNotification(alertId);
  if (!alert) {
    return NextResponse.json({ message: `Alert not found: ${alertId}` }, { status: 404 });
  }

  const meta = (alert.metadata || {}) as Record<string, unknown>;
  const resumeUrl = readDatafileSelectionResumeUrl(alert);
  const resumeMethod = readDatafileSelectionResumeMethod(alert);

  let n8nResponse: unknown;
  let resumedViaWaitNode = false;

  try {
    if (resumeUrl) {
      n8nResponse = await resumeDatafileSelectionWaitNode({
        alert,
        rawUrl: resumeUrl,
        method: resumeMethod,
        actor: session.user.username,
        userId: session.userId,
        tablespace,
        sizeGb
      });
      resumedViaWaitNode = true;
    } else {
      n8nResponse = await dispatchDbaWorkflowCommand({
        action: "extension_approved",
        alert,
        actor: session.user.username,
        userId: session.userId,
        params: {
          tablespace,
          selected_tablespace: tablespace,
          selected_size_gb: sizeGb,
          size_gb: sizeGb
        },
        message: `Tablespace ${tablespace} selected for extension (${sizeGb} GB).`
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to submit selection to n8n.";
    return NextResponse.json({ message }, { status: 502 });
  }

  const updatedAlert = await updateAlertNotification({
    id: alertId,
    status: "approved",
    actor: session.user.username,
    message: `Tablespace ${tablespace} selected for extension (${sizeGb} GB) by ${session.user.username}.`,
    metadata: {
      ...meta,
      selected_tablespace: tablespace,
      selected_size_gb: sizeGb,
      selection_submitted_by: session.user.username,
      selection_submitted_at: new Date().toISOString(),
      selection_resume_method: resumeMethod,
      selection_resumed_via_wait_node: resumedViaWaitNode,
      n8n_selection_response: n8nResponse,
      step: "sql_generation"
    }
  });

  try {
    await insertAuditLog({
      actor: session.user.username,
      action: "datafile_extend",
      db: alert.db,
      status: "approved",
      detail: `Tablespace ${tablespace} selected for +${sizeGb} GB extension on alert ${alertId}.`,
      metadata: { alert_id: alertId, tablespace, size_gb: sizeGb }
    });
  } catch {
    // audit failure is non-fatal
  }

  emitAlertNotificationEvent("updated", updatedAlert);

  return NextResponse.json({ alert: updatedAlert });
}
