import { NextResponse } from "next/server";

import { emitGlobalNotification } from "@/lib/server/notification-events";
import {
  bumpMonitoringIncidentReportCount,
  findActiveMonitoringIncident,
  insertAuditLog,
  insertMonitoringIncident
} from "@/lib/server/repository";

export const dynamic = "force-dynamic";

const MONITORING_ACTOR = "Monitoring Agent";

/**
 * POST /api/monitoring/webhook
 *
 * Receives database DOWN notifications from n8n. No authentication required
 * (same pattern as /api/alerts for n8n webhooks).
 *
 * Expected payload:
 * {
 *   "db_name": "ORCL",       // or "database_name" / "db"
 *   "status": "DOWN"
 * }
 */
export async function POST(request: Request) {
  try {
    const raw = await request.json() as Record<string, unknown>;

    // Unwrap n8n wrapping: n8n may send { json: { ... } } or [ { json: { ... } } ]
    let body = raw;
    if (Array.isArray(raw)) {
      const first = raw[0];
      body = (first?.json ?? first) as Record<string, unknown>;
    } else if (raw.json && typeof raw.json === "object" && !Array.isArray(raw.json)) {
      body = raw.json as Record<string, unknown>;
    }

    const dbName = String(
      body.db_name || body.database_name || body.db || ""
    ).trim().toUpperCase();

    if (!dbName) {
      return NextResponse.json(
        { message: "Missing required field: db_name (or database_name / db)." },
        { status: 400 }
      );
    }

    const status = String(body.status || "DOWN").trim().toUpperCase();
    if (status !== "DOWN") {
      return NextResponse.json(
        { message: `Only DOWN notifications are supported. Received: ${status}` },
        { status: 400 }
      );
    }

    // ── 1. Always audit the incoming notification ────────────────────────
    await insertAuditLog({
      actor: MONITORING_ACTOR,
      action: "db_monitoring",
      db: dbName,
      status: "down",
      detail: `Database DOWN notification received for ${dbName}.`
    });

    // ── 2. Always emit a global notification ─────────────────────────────
    const notifId = `MON-${dbName}-${Date.now()}`;
    emitGlobalNotification({
      id: notifId,
      type: "db_monitoring",
      severity: "critical",
      db: dbName,
      title: `Database DOWN: ${dbName}`,
      message: `Monitoring Agent reports database ${dbName} is unreachable.`,
      timestamp: new Date().toISOString(),
      targetPath: "/general-admin"
    });

    // ── 3. Dedup: check for existing active incident ─────────────────────
    const existing = await findActiveMonitoringIncident(dbName);

    if (existing) {
      // Duplicate — bump report count, but don't create a new incident row
      await bumpMonitoringIncidentReportCount(existing.incident_id);

      return NextResponse.json({
        status: "duplicate",
        incident_id: existing.incident_id,
        report_count: existing.report_count + 1,
        message: `Existing active incident updated for ${dbName}.`
      });
    }

    // ── 4. Create new incident ───────────────────────────────────────────
    const incidentId = `INC-${dbName}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const incident = await insertMonitoringIncident({
      id: incidentId,
      dbName
    });

    return NextResponse.json({
      status: "created",
      incident_id: incident.incident_id,
      message: `New monitoring incident created for ${dbName}.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected monitoring webhook error.";
    console.error("[Monitoring Webhook Error]", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}
