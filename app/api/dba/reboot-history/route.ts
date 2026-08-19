import { NextResponse } from "next/server";

import { listRebootHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/dba/reboot-history
 *
 * Returns db_reboot_history rows for PROD database audit compliance snapshots.
 * Query params:
 *   db    (string)  — filter by database name
 *   limit (number)  — max rows to return (default 100, max 500)
 *
 * Requires authentication.
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const url        = new URL(request.url);
    const db         = url.searchParams.get("db") || undefined;
    const limitParam = url.searchParams.get("limit");
    const limit      = limitParam ? Math.min(Math.max(Number(limitParam), 1), 1000) : 300;
    const startDate  = url.searchParams.get("startDate") || undefined;
    const endDate    = url.searchParams.get("endDate") || undefined;

    const items = await listRebootHistory(db, limit, { startDate, endDate });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reboot history.";
    console.error("[reboot-history] GET error:", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}
