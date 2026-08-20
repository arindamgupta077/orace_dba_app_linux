import { NextResponse } from "next/server";

import {
  getDownIncidentCooldownInfo,
  resetDownIncidentRefreshCooldown,
  triggerDashboardRefresh,
  triggerDashboardRefreshOnDownIncident
} from "@/lib/server/dashboard-refresh";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import {
  bumpMonitoringIncidentReportCount,
  findActiveMonitoringIncident,
  insertAlertNotification,
  insertAuditLog,
  insertMonitoringIncident,
  updateMonitoringIncidentStatus
} from "@/lib/server/repository";

export const dynamic = "force-dynamic";

const MONITORING_ACTOR = "Monitoring Agent";

/**
 * POST /api/monitoring/webhook
 *
 * Receives database DOWN / RESOLVED notifications from n8n. No authentication required
 * (same pattern as /api/alerts for n8n webhooks).
 *
 * Expected payload:
 * {
 *   "db_name": "ORCL",       // or "database_name" / "db"
 *   "status": "DOWN" | "RESOLVED" | "UP"
 * }
 */
export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;

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
    ).trim();

    if (!dbName) {
      return NextResponse.json(
        { message: "Missing required field: db_name (or database_name / db)." },
        { status: 400 }
      );
    }

    const status = String(body.status || "DOWN").trim().toUpperCase();

    // ── Branch A: Handle RESOLVED / UP Status ───────────────────────────
    if (status === "RESOLVED" || status === "UP") {
      const existing = await findActiveMonitoringIncident(dbName);
      const trackingIncidentId = existing?.incident_id;

      if (existing) {
        await updateMonitoringIncidentStatus(existing.incident_id, "RESOLVED", MONITORING_ACTOR);
      }
      resetDownIncidentRefreshCooldown(dbName);

      await insertAuditLog({
        actor: MONITORING_ACTOR,
        action: "db_monitoring",
        db: dbName,
        status: "resolved",
        detail: `Database UP/RESOLVED notification received for ${dbName}.`
      });

      const alertNotifId = `MON-UP-${dbName}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      try {
        await insertAlertNotification({
          id: alertNotifId,
          source: MONITORING_ACTOR,
          alertType: "db_monitoring",
          db: dbName,
          severity: "info",
          status: "completed",
          message: `Monitoring Agent reports database ${dbName} is back online (RESOLVED).`,
          createdBy: "n8n"
        });
      } catch {
        // Ignore fallback insert error if duplicate ID occurs
      }

      emitGlobalNotification({
        id: alertNotifId,
        type: "db_monitoring",
        severity: "info",
        db: dbName,
        title: `Database Online: ${dbName}`,
        message: `Monitoring Agent reports database ${dbName} is back online (RESOLVED).`,
        timestamp: new Date().toISOString(),
        targetPath: "/general-admin"
      });

      // Automation: Automatically trigger refresh_dashboard on incident resolution
      void triggerDashboardRefresh({
        dbName,
        requestedBy: "automation:monitoring",
        reason: `Automated dashboard refresh triggered by incident resolution for ${dbName}.`,
        metadata: {
          incident_id: trackingIncidentId,
          incident_status: "RESOLVED",
          trigger: "monitoring_webhook_resolved"
        }
      }).catch((refreshErr) => {
        console.error(
          `[Monitoring Webhook] Automated refresh_dashboard error on resolution for ${dbName}:`,
          refreshErr instanceof Error ? refreshErr.message : refreshErr
        );
      });

      return NextResponse.json({
        status: "resolved",
        incident_id: trackingIncidentId,
        message: `Monitoring incident resolved for ${dbName}. Dashboard refresh triggered automatically.`,
        dashboard_refresh_triggered: true
      });
    }

    // ── Branch B: Handle DOWN Status ────────────────────────────────────
    if (status !== "DOWN") {
      return NextResponse.json(
        { message: `Unsupported status: ${status}. Expected "DOWN", "RESOLVED", or "UP".` },
        { status: 400 }
      );
    }

    // ── 1. Always audit the incoming notification ────────────────────────
    await insertAuditLog({
      actor: MONITORING_ACTOR,
      action: "db_monitoring",
      db: dbName,
      status: "DOWN",
      detail: `Database DOWN notification received for ${dbName}.`
    });

    // ── 2. Generate entry for Notification Center & Bell Dropdown ────────
    const alertNotifId = `MON-${dbName}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    try {
      await insertAlertNotification({
        id: alertNotifId,
        source: MONITORING_ACTOR,
        alertType: "db_monitoring",
        db: dbName,
        severity: "critical",
        status: "DOWN",
        message: `Monitoring Agent reports database ${dbName} is unreachable.`,
        createdBy: "n8n"
      });
    } catch {
      // Ignore fallback insert error if duplicate ID occurs
    }

    // Emit live global notification for bell dropdown & stream listeners
    emitGlobalNotification({
      id: alertNotifId,
      type: "db_monitoring",
      severity: "critical",
      db: dbName,
      title: `Database DOWN: ${dbName}`,
      message: `Monitoring Agent reports database ${dbName} is unreachable.`,
      timestamp: new Date().toISOString(),
      targetPath: "/general-admin"
    });

    // ── 3. Keep ONLY 1 card in Monitoring Notifications on General Admin ──
    const existing = await findActiveMonitoringIncident(dbName);
    let trackingIncidentId: string;

    if (existing) {
      // Single card per database on General Admin — bump report count
      await bumpMonitoringIncidentReportCount(existing.incident_id);
      trackingIncidentId = existing.incident_id;
    } else {
      // Create single active incident card in app_db_monitoring_incidents if none exists
      const incidentId = `INC-${dbName}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const incident = await insertMonitoringIncident({
        id: incidentId,
        dbName
      });
      trackingIncidentId = incident.incident_id;
    }

    // ── 4. Automation: Automatically trigger refresh_dashboard (with 1-hour cooldown) ──
    const cooldownInfo = await getDownIncidentCooldownInfo(dbName);

    void triggerDashboardRefreshOnDownIncident({
      dbName,
      incidentId: trackingIncidentId
    }).catch((refreshErr) => {
      console.error(
        `[Monitoring Webhook] Automated refresh_dashboard error for ${dbName}:`,
        refreshErr instanceof Error ? refreshErr.message : refreshErr
      );
    });

    if (existing) {
      if (cooldownInfo.inCooldown) {
        return NextResponse.json({
          status: "updated",
          incident_id: existing.incident_id,
          report_count: existing.report_count + 1,
          message: `Active incident updated for ${dbName} (report count bumped). Dashboard refresh skipped (1-hour cooldown active, ${cooldownInfo.remainingCooldownMin}m remaining).`,
          dashboard_refresh_triggered: false,
          cooldown_active: true,
          remaining_cooldown_min: cooldownInfo.remainingCooldownMin
        });
      }

      return NextResponse.json({
        status: "updated",
        incident_id: existing.incident_id,
        report_count: existing.report_count + 1,
        message: `Active incident updated for ${dbName} (single card maintained on General Admin). Dashboard refresh triggered automatically.`,
        dashboard_refresh_triggered: true,
        cooldown_active: false
      });
    }

    return NextResponse.json({
      status: "created",
      incident_id: trackingIncidentId,
      message: `New monitoring incident card created for ${dbName}. Dashboard refresh triggered automatically.`,
      dashboard_refresh_triggered: !cooldownInfo.inCooldown,
      cooldown_active: cooldownInfo.inCooldown,
      remaining_cooldown_min: cooldownInfo.inCooldown ? cooldownInfo.remainingCooldownMin : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected monitoring webhook error.";
    console.error("[Monitoring Webhook Error]", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}
