import { NextResponse } from "next/server";

import { reloadSchedules } from "@/lib/server/scheduler";
import {
  listDashboardSchedules,
  upsertDashboardSchedule,
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

// GET /api/dashboard/schedules – list all schedules
export async function GET() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const schedules = await listDashboardSchedules();
    return NextResponse.json({ schedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load schedules.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// POST /api/dashboard/schedules – create or update a schedule for a DB
export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { db_name?: string; interval_min?: number };
    const db_name = typeof body.db_name === "string" ? body.db_name.trim() : "";
    const interval_min = Number(body.interval_min);

    if (!db_name) {
      return NextResponse.json({ message: "db_name is required." }, { status: 400 });
    }
    if (!Number.isInteger(interval_min) || interval_min < 1 || interval_min > 1440) {
      return NextResponse.json(
        { message: "interval_min must be an integer between 1 and 1440." },
        { status: 400 }
      );
    }

    const schedule = await upsertDashboardSchedule({
      db_name,
      interval_min,
      created_by: session.user.username,
    });

    // Tell the running scheduler to pick up the new schedule immediately
    reloadSchedules().catch(() => {});

    return NextResponse.json({ schedule });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save schedule.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
