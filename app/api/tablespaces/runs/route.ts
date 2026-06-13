import { type NextRequest, NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { getLatestTablespaceRuns } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { getMockTablespacesForDb } from "@/services/mock-data";

export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const env = getServerEnv();
    const db = request.nextUrl.searchParams.get("db") || undefined;

    if (env.mockMode) {
      const rows = getMockTablespacesForDb(db);
      return NextResponse.json({
        rows,
        last_run_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        last_run_by: "ARINDAM",
        has_data: rows.length > 0
      });
    }

    const result = await getLatestTablespaceRuns(db);
    return NextResponse.json({
      rows: result.rows,
      last_run_at: result.lastRunAt,
      last_run_by: result.lastRunBy,
      has_data: result.rows.length > 0
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch tablespace runs.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
