import { type NextRequest, NextResponse } from "next/server";
import { getPerformanceTrendDaysConfig, insertAuditLog, setPerformanceTrendDaysConfig } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export async function GET() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const trendDays = await getPerformanceTrendDaysConfig();
    return NextResponse.json({ trendDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load performance configuration.";
    return NextResponse.json({ message, trendDays: 3 }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  // Only app_admin is authorized to change global performance trend configuration
  if (session.user.role !== "app_admin") {
    return NextResponse.json(
      { message: "Forbidden: Only app_admin can modify performance trend configuration." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as { trendDays?: number };
    const rawDays = Number(body?.trendDays);
    if (!Number.isFinite(rawDays) || rawDays < 1 || rawDays > 90) {
      return NextResponse.json(
        { message: "Invalid trendDays. Must be an integer between 1 and 90." },
        { status: 400 }
      );
    }

    const savedDays = await setPerformanceTrendDaysConfig(rawDays, session.user.username);

    // Record in audit log
    await insertAuditLog({
      actor: session.user.username,
      action: "configure_performance_trends",
      db: "GLOBAL",
      status: "success",
      detail: `App Admin ${session.user.username} updated RUN ALL trend history window to ${savedDays} days.`,
      metadata: {
        trend_days: savedDays,
        updated_by: session.user.username
      }
    }).catch(() => {});

    return NextResponse.json({ ok: true, trendDays: savedDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save performance configuration.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
