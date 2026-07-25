import { NextResponse } from "next/server";

import { listAllMonitoringIncidents } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring/incidents/history
 *
 * Returns all monitoring incidents (active and historical, including RESOLVED).
 * Requires authentication.
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 500) : 200;

    const incidents = await listAllMonitoringIncidents(limit);
    return NextResponse.json({ incidents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error listing monitoring incident history.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
