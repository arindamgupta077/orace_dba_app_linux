import { NextResponse } from "next/server";

import { reloadSchedules } from "@/lib/server/scheduler";
import {
  deleteDashboardSchedule,
  insertAuditLog,
  listDashboardSchedules,
  toggleDashboardSchedule,
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE /api/dashboard/schedules/[id] – remove a schedule
export async function DELETE(_req: Request, { params }: RouteParams) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isFinite(scheduleId) || scheduleId <= 0) {
      return NextResponse.json({ message: "Invalid schedule id." }, { status: 400 });
    }

    const existingSchedules = await listDashboardSchedules().catch(() => []);
    const schedule = existingSchedules.find((s) => s.id === scheduleId);
    const dbName = schedule?.db_name || `ID #${scheduleId}`;
    const intervalLabel = schedule
      ? schedule.interval_min < 60
        ? `${schedule.interval_min}m`
        : `${schedule.interval_min / 60}h`
      : "";

    await deleteDashboardSchedule(scheduleId);
    reloadSchedules().catch(() => {});

    // Capture in audit log (visible on Audit page)
    await insertAuditLog({
      actor: session.user.username,
      action: "dashboard_schedule",
      db: schedule?.db_name,
      status: "success",
      detail: `Deleted auto-refresh schedule for ${dbName}${intervalLabel ? ` (${intervalLabel})` : ""}.`,
      metadata: {
        operation: "DELETE",
        schedule_id: scheduleId,
        db_name: schedule?.db_name,
        interval_min: schedule?.interval_min,
        table_name: "APP_DASHBOARD_SCHEDULES",
      },
    }).catch((e) => console.warn("[schedules/DELETE] Failed to insert audit log:", e));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete schedule.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// PATCH /api/dashboard/schedules/[id] – toggle active/paused
export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isFinite(scheduleId) || scheduleId <= 0) {
      return NextResponse.json({ message: "Invalid schedule id." }, { status: 400 });
    }

    const body = (await request.json()) as { is_active?: boolean };
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json({ message: "is_active (boolean) is required." }, { status: 400 });
    }

    const existingSchedules = await listDashboardSchedules().catch(() => []);
    const schedule = existingSchedules.find((s) => s.id === scheduleId);
    const dbName = schedule?.db_name || `ID #${scheduleId}`;
    const intervalLabel = schedule
      ? schedule.interval_min < 60
        ? `${schedule.interval_min}m`
        : `${schedule.interval_min / 60}h`
      : "";

    await toggleDashboardSchedule(scheduleId, body.is_active);
    reloadSchedules().catch(() => {});

    // Capture in audit log (visible on Audit page)
    await insertAuditLog({
      actor: session.user.username,
      action: "dashboard_schedule",
      db: schedule?.db_name,
      status: "success",
      detail: `${body.is_active ? "Resumed" : "Paused"} auto-refresh schedule for ${dbName}${intervalLabel ? ` (${intervalLabel})` : ""}.`,
      metadata: {
        operation: body.is_active ? "RESUME" : "PAUSE",
        schedule_id: scheduleId,
        db_name: schedule?.db_name,
        interval_min: schedule?.interval_min,
        is_active: body.is_active,
        table_name: "APP_DASHBOARD_SCHEDULES",
      },
    }).catch((e) => console.warn("[schedules/PATCH] Failed to insert audit log:", e));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update schedule.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
