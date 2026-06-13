import { NextResponse } from "next/server";

import { reloadSchedules } from "@/lib/server/scheduler";
import {
  deleteDashboardSchedule,
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

    await deleteDashboardSchedule(scheduleId);
    reloadSchedules().catch(() => {});

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

    await toggleDashboardSchedule(scheduleId, body.is_active);
    reloadSchedules().catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update schedule.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
