import { type NextRequest, NextResponse } from "next/server";

import { getLatestPerformanceRunAll, getPerformanceRunAllHistoryList } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/performance/history?db=<db_name>&list=true&limit=50
 *
 * Returns either:
 * 1) A list of past RUN ALL executions (when list=true)
 * 2) The single most-recent row from performance_run_all_hist (default)
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

    const isList = request.nextUrl.searchParams.get("list") === "true";
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

    if (isList) {
      const rows = await getPerformanceRunAllHistoryList(db, Number.isNaN(limit) ? 50 : limit);
      return NextResponse.json({
        has_data: rows.length > 0,
        db_name: db,
        items: rows.map((row) => ({
          run_id: row.run_id,
          db_name: row.db_name,
          environment: row.environment,
          os: row.os,
          refreshed_by: row.refreshed_by,
          metrics_payload: row.metrics_payload,
          ai_summary: row.ai_summary,
          created_at: row.created_at
        }))
      });
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
