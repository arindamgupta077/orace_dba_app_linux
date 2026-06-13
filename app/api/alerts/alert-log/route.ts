import { NextResponse } from "next/server";

import { emitGlobalNotification } from "@/lib/server/notification-events";
import { insertDbaAlertLog, listDbaAlertLog, updateDbaAlertLog } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DbaAlertLogSeverity, DbaAlertLogStatus } from "@/types/dba";

export const dynamic = "force-dynamic";

type BodyRecord = Record<string, unknown>;

function readString(body: BodyRecord, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
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

function normalizeSeverity(raw: string): DbaAlertLogSeverity {
  const v = raw.toUpperCase();
  if (v === "P1" || v === "P2" || v === "INFO") return v;
  return "INFO";
}

function normalizeStatus(raw: string): DbaAlertLogStatus {
  const v = raw.toUpperCase();
  if (v === "OPEN" || v === "ACKNOWLEDGED" || v === "RESOLVED") return v;
  return "OPEN";
}

// ---------------------------------------------------------------------------
// GET /api/alerts/alert-log
// List dba_alert_log rows — requires authenticated session.
// Query params: database_name, status, severity, limit, offset
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }
    const url = new URL(request.url);
    const database_name = url.searchParams.get("database_name")?.trim() || undefined;
    const statusParam = url.searchParams.get("status")?.trim();
    const severityParam = url.searchParams.get("severity")?.trim();
    const limit = Number(url.searchParams.get("limit") || "50");
    const offset = Number(url.searchParams.get("offset") || "0");

    const result = await listDbaAlertLog({
      database_name,
      status: statusParam ? normalizeStatus(statusParam) : undefined,
      severity: severityParam ? normalizeSeverity(severityParam) : undefined,
      limit,
      offset
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message.toLowerCase().includes("session") ? 401 : 500;
    return NextResponse.json({ message }, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/alerts/alert-log
// Public endpoint — called by n8n with no user session.
// Accepts a single alert object OR an array of alert objects.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support both single object and array
    const items: BodyRecord[] = Array.isArray(body) ? body : [body as BodyRecord];

    if (items.length === 0) {
      return NextResponse.json({ message: "No alerts provided." }, { status: 400 });
    }

    const results: { inserted: boolean; alert_id?: number; database_name: string }[] = [];

    for (const item of items) {
      const rec = item as BodyRecord;
      const database_name = readString(rec, ["database_name", "db", "database"]);
      const originating_timestamp = readString(rec, ["originating_timestamp", "timestamp"]);
      const error_code = readString(rec, ["error_code", "errorCode"]) || undefined;
      const message_text = readString(rec, ["message_text", "message"]) || undefined;

      if (!database_name) {
        results.push({ inserted: false, database_name: "(missing)" });
        continue;
      }
      if (!originating_timestamp) {
        results.push({ inserted: false, database_name });
        continue;
      }

      const outcome = await insertDbaAlertLog({
        database_name,
        originating_timestamp,
        error_code,
        message_text
      });
      results.push({ ...outcome, database_name });

      if (outcome.inserted) {
        const errCode = error_code || "ORA-ERROR";
        const msgSnippet = message_text ? message_text.slice(0, 120) : "Alert log error detected.";
        emitGlobalNotification({
          id: outcome.alert_id ? `ALOG-${outcome.alert_id}` : `ALOG-${Date.now()}`,
          type: "alert_log",
          severity: "error",
          db: database_name,
          title: `Alert Log Error: ${errCode} on ${database_name}`,
          message: msgSnippet,
          timestamp: originating_timestamp,
          targetPath: "/alerts"
        });
      }
    }

    const insertedCount = results.filter((r) => r.inserted).length;
    const skippedCount = results.length - insertedCount;

    return NextResponse.json(
      { inserted: insertedCount, skipped: skippedCount, results },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert insert error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/alerts/alert-log
// Authenticated — acknowledge or resolve a dba_alert_log entry.
// Body: { alert_id: number, status: "ACKNOWLEDGED" | "RESOLVED" }
// ---------------------------------------------------------------------------
export async function PATCH(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }
    const body = (await request.json()) as BodyRecord;

    const alert_id = readNumber(body, ["alert_id", "alertId"]);
    const statusRaw = readString(body, ["status"]);

    if (!alert_id) {
      return NextResponse.json({ message: "alert_id is required." }, { status: 400 });
    }
    if (!statusRaw) {
      return NextResponse.json({ message: "status is required." }, { status: 400 });
    }

    const status = normalizeStatus(statusRaw);
    if (status === "OPEN") {
      return NextResponse.json(
        { message: "Use ACKNOWLEDGED or RESOLVED status only." },
        { status: 400 }
      );
    }

    const actor = session.user.username;
    const alert = await updateDbaAlertLog({ alert_id, status, actor });

    return NextResponse.json({ alert });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected alert update error.";
    const statusCode = message.toLowerCase().includes("session") ? 401 : 500;
    return NextResponse.json({ message }, { status: statusCode });
  }
}
