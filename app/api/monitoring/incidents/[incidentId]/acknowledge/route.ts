import { NextResponse } from "next/server";

import {
  getMonitoringIncident,
  insertAuditLog,
  updateMonitoringIncidentStatus
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const MONITORING_ACTOR = "Monitoring Agent";

/**
 * POST /api/monitoring/incidents/[incidentId]/acknowledge
 *
 * Acknowledges a monitoring incident. Requires authentication.
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
      return NextResponse.json({ message: "Incident is already resolved." }, { status: 400 });
    }

    if (incident.status === "ACKNOWLEDGED") {
      return NextResponse.json({
        message: "Incident is already acknowledged.",
        incident
      });
    }

    const updated = await updateMonitoringIncidentStatus(
      incidentId,
      "ACKNOWLEDGED",
      session.user.username
    );

    await insertAuditLog({
      actor: MONITORING_ACTOR,
      action: "db_monitoring",
      db: incident.db_name,
      status: "acknowledged",
      detail: `Monitoring incident ${incidentId} for database ${incident.db_name} acknowledged by ${session.user.username}.`
    });

    return NextResponse.json({ incident: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error acknowledging incident.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
