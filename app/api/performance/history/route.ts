import { type NextRequest, NextResponse } from "next/server";

import { getLatestPerformanceRunAll } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/performance/history?db=<db_name>
 *
 * Returns the single most-recent row from performance_run_all_hist
 * for the requested database.  The app uses this to re-hydrate the
 * "RUN ALL" result panel on page load or after a page refresh.
 */
export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const db = request.nextUrl.searchParams.get("db") || "";
    if (!db) {
      return NextResponse.json(
        { message: "db query parameter is required." },
        { status: 400 }
      );
    }

    const row = await getLatestPerformanceRunAll(db);
    if (!row) {
      return NextResponse.json({ has_data: false, db_name: db });
    }

    return NextResponse.json({
      has_data: true,
      run_id: row.run_id,
      db_name: row.db_name,
      environment: row.environment,
      os: row.os,
      refreshed_by: row.refreshed_by,
      metrics_payload: row.metrics_payload,
      ai_summary: row.ai_summary,
      created_at: row.created_at
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch performance run history.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
