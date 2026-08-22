import { type NextRequest, NextResponse } from "next/server";
import { getAuditLogStats, purgeExpiredAuditLogs } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  // Only app_admin can trigger manual purge operations
  if (session.user.role !== "app_admin") {
    return NextResponse.json(
      { message: "Forbidden: Only app_admin can perform manual audit log purge." },
      { status: 403 }
    );
  }

  try {
    let customRetentionDays: number | undefined;
    try {
      const body = (await request.json().catch(() => ({}))) as { retentionDays?: number };
      if (body?.retentionDays && Number.isFinite(Number(body.retentionDays))) {
        customRetentionDays = Number(body.retentionDays);
      }
    } catch {
      // Body is optional
    }

    const result = await purgeExpiredAuditLogs(customRetentionDays, session.user.username);
    const stats = await getAuditLogStats().catch(() => null);

    return NextResponse.json({
      ok: true,
      deletedCount: result.deletedCount,
      retentionDays: result.retentionDays,
      lastPurgeAt: result.lastPurgeAt,
      stats,
      message: `Successfully purged ${result.deletedCount} audit log${result.deletedCount === 1 ? "" : "s"} older than ${result.retentionDays} days.`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to purge expired audit logs.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
