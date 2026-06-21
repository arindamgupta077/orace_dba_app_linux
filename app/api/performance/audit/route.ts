import { NextResponse } from "next/server";

import { listPerformanceAuditLogs } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// All performance-tuning actions whose latest audit log row should be surfaced on the cards.
const PERFORMANCE_ACTIONS = [
  "session_list",
  "kill_session",
  "long_queries",
  "lock_check",
  "cpu_usage",
  "top_sql",
  "invalid_obejcts",
  "recompile_invalid",
  "wait_events",
  "SESSION_LONGOPS"
];

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const db = url.searchParams.get("db") || "";

    if (!db) {
      return NextResponse.json({ message: "db query parameter is required." }, { status: 400 });
    }

    const items = await listPerformanceAuditLogs(db, PERFORMANCE_ACTIONS);
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected performance audit error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
