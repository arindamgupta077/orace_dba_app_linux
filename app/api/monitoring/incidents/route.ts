import { NextResponse } from "next/server";

import { listActiveMonitoringIncidents } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring/incidents
 *
 * Returns all active monitoring incidents (status DOWN or ACKNOWLEDGED).
 * Requires authentication.
 */
export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const incidents = await listActiveMonitoringIncidents();
    return NextResponse.json({ incidents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error listing monitoring incidents.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
