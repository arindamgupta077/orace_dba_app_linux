import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import {
  getMonitoringIncident,
  insertAlertNotification,
  insertAuditLog,
  updateMonitoringIncidentStatus
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const MONITORING_ACTOR = "Monitoring Agent";

/**
 * POST /api/monitoring/incidents/[incidentId]/check-status
 *
 * Invokes the n8n test_connection webhook to check current database availability.
 * If UP → resolves the incident.  If DOWN → leaves it as-is.
 * Requires authentication.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ incidentId: string }> }
) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { incidentId } = await params;

    const incident = await getMonitoringIncident(incidentId);
    if (!incident) {
      return NextResponse.json({ message: "Incident not found." }, { status: 404 });
    }

    if (incident.status === "RESOLVED") {
      return NextResponse.json({
        status: "UP",
        resolved: true,
        message: "Incident is already resolved."
      });
    }

    // ── Call n8n test_connection ──────────────────────────────────────────
    const env = getServerEnv();
    let connectionResult: "UP" | "DOWN" = "DOWN";

    if (env.mockMode) {
      // In mock mode, simulate UP after a short delay
      await new Promise((r) => setTimeout(r, 600));
      connectionResult = "UP";
    } else {
      if (!env.webhookUrl) {
        throw new Error("DBA_WEBHOOK_URL is required when mock mode is disabled.");
      }

      const payload = {
        action: "test_connection",
        db: incident.db_name,
        params: {
          database_name: incident.db_name,
          requested_by: session.user.username
        },
        requested_by: session.user.username,
        user_id: session.userId
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
        let errMsg: string;
        try {
          const errBody = (await response.json()) as { message?: string };
          errMsg = errBody.message || response.statusText;
        } catch {
          errMsg = response.statusText;
        }
        throw new Error(`n8n webhook failed (${response.status}): ${errMsg}`);
      }

      const result = await response.json() as Record<string, unknown>;

      // Extract remote_connection from potentially wrapped n8n response
      let connectionValue: string | undefined;
      if (typeof result.remote_connection === "string") {
        connectionValue = result.remote_connection;
      } else if (Array.isArray(result)) {
        for (const item of result) {
          const obj = (item as Record<string, unknown>)?.json ?? item;
          if (obj && typeof (obj as Record<string, unknown>).remote_connection === "string") {
            connectionValue = (obj as Record<string, unknown>).remote_connection as string;
            break;
          }
        }
      }

      connectionResult = connectionValue?.toUpperCase() === "UP" ? "UP" : "DOWN";
    }

    // ── Audit the status check ───────────────────────────────────────────
    await insertAuditLog({
      actor: session.user.username,
      action: "test_connection",
      db: incident.db_name,
      status: connectionResult,
      detail: `Status check for ${incident.db_name} by ${session.user.username}: result=${connectionResult}.`
    });

    if (connectionResult === "UP") {
      // ── Resolve the incident ─────────────────────────────────────────
      const resolved = await updateMonitoringIncidentStatus(incidentId, "RESOLVED");

      await insertAuditLog({
        actor: session.user.username,
        action: "db_monitoring",
        db: incident.db_name,
        status: "resolved",
        detail: `Database ${incident.db_name} confirmed UP — incident ${incidentId} resolved by ${session.user.username}.`
      });

      const upNotifId = `MON-UP-${incident.db_name}-${incidentId}`;
      try {
        await insertAlertNotification({
          id: upNotifId,
          source: MONITORING_ACTOR,
          alertType: "db_monitoring",
          db: incident.db_name,
          severity: "info",
          status: "completed",
          message: `Database ${incident.db_name} is confirmed UP. Incident resolved by ${session.user.username}.`,
          createdBy: session.user.username
        });
      } catch {
        // Ignore duplicate insert error
      }

      // ── Emit global notification for UP / resolved ───────────────────
      emitGlobalNotification({
        id: upNotifId,
        type: "db_monitoring",
        severity: "info",
        db: incident.db_name,
        title: `Database Online: ${incident.db_name}`,
        message: `Database ${incident.db_name} is confirmed UP. Incident resolved by ${session.user.username}.`,
        timestamp: new Date().toISOString(),
        targetPath: "/general-admin"
      });

      return NextResponse.json({
        status: "UP",
        resolved: true,
        incident: resolved,
        message: `Database ${incident.db_name} is back online. Incident resolved.`
      });
    }

    // ── Still DOWN — leave incident as-is ───────────────────────────────
    return NextResponse.json({
      status: "DOWN",
      resolved: false,
      incident,
      message: `Database ${incident.db_name} is still unreachable.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error checking database status.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
