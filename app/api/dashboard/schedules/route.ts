import { NextResponse } from "next/server";

import { reloadSchedules } from "@/lib/server/scheduler";
import {
  insertAuditLog,
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

    // Check existing schedule for change detail
    const existingSchedules = await listDashboardSchedules().catch(() => []);
    const prevSchedule = existingSchedules.find(
      (s) => s.db_name.toLowerCase() === db_name.toLowerCase()
    );

    const schedule = await upsertDashboardSchedule({
      db_name,
      interval_min,
      created_by: session.user.username,
    });

    // Tell the running scheduler to pick up the new schedule immediately
    reloadSchedules().catch(() => {});

    // Capture in audit log (visible on Audit page)
    const isUpdate = !!prevSchedule;
    const intervalLabel = interval_min < 60 ? `${interval_min}m` : `${interval_min / 60}h`;
    const prevIntervalLabel = prevSchedule
      ? prevSchedule.interval_min < 60
        ? `${prevSchedule.interval_min}m`
        : `${prevSchedule.interval_min / 60}h`
      : "";

    const detail = isUpdate
      ? `Updated auto-refresh schedule for ${db_name} from ${prevIntervalLabel} to ${intervalLabel}.`
      : `Configured auto-refresh schedule for ${db_name} (every ${intervalLabel}).`;

    await insertAuditLog({
      actor: session.user.username,
      action: "dashboard_schedule",
      db: db_name,
      status: "success",
      detail,
      metadata: {
        operation: isUpdate ? "UPDATE" : "CREATE",
        schedule_id: schedule.id,
        db_name,
        interval_min,
        previous_interval_min: prevSchedule?.interval_min,
        is_active: schedule.is_active,
        table_name: "APP_DASHBOARD_SCHEDULES",
      },
    }).catch((e) => console.warn("[schedules/POST] Failed to insert audit log:", e));

    return NextResponse.json({ schedule });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save schedule.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
