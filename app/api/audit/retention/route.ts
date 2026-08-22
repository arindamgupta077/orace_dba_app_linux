import { type NextRequest, NextResponse } from "next/server";
import type { AuditLogRetentionPolicyConfig } from "@/types/dba";
import {
  getAuditLogStats,
  getAuditRetentionPolicyConfig,
  insertAuditLog,
  setAuditRetentionPolicyConfig
} from "@/lib/server/repository";
import { reloadAuditRetentionPolicy } from "@/lib/server/scheduler";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const [policy, stats] = await Promise.all([
      getAuditRetentionPolicyConfig(),
      getAuditLogStats()
    ]);
    return NextResponse.json({ policy, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load audit retention policy.";
    return NextResponse.json(
      {
        message,
        policy: { retentionDays: 1095, autoPurgeEnabled: true, lastPurgeAt: null, lastPurgedCount: 0 },
        stats: {
          totalLogs: 0,
          retentionDays: 1095,
          autoPurgeEnabled: true,
          oldestLogTimestamp: null,
          newestLogTimestamp: null,
          expiredLogsCount: 0,
          lastPurgeAt: null,
          lastPurgedCount: 0
        }
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  // Only app_admin is authorized to modify global system configuration
  if (session.user.role !== "app_admin") {
    return NextResponse.json(
      { message: "Forbidden: Only app_admin can modify audit retention policy." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as Partial<AuditLogRetentionPolicyConfig>;

    const rawRetentionDays = body.retentionDays !== undefined ? Number(body.retentionDays) : undefined;
    const autoPurgeEnabled = body.autoPurgeEnabled !== undefined ? Boolean(body.autoPurgeEnabled) : undefined;

    if (rawRetentionDays !== undefined && (!Number.isFinite(rawRetentionDays) || rawRetentionDays < 365 || rawRetentionDays > 2555)) {
      return NextResponse.json(
        { message: "Invalid retentionDays. Must be between 365 and 2555 days (1 to 7 years)." },
        { status: 400 }
      );
    }

    const savedPolicy = await setAuditRetentionPolicyConfig(
      {
        retentionDays: rawRetentionDays,
        autoPurgeEnabled
      },
      session.user.username
    );

    // Trigger scheduler refresh / potential cleanup if enabled
    if (savedPolicy.autoPurgeEnabled) {
      await reloadAuditRetentionPolicy().catch(() => {});
    }

    // Record in audit log
    await insertAuditLog({
      actor: session.user.username,
      action: "configure_audit_retention",
      db: "GLOBAL",
      status: "success",
      detail: `App Admin ${session.user.username} updated Audit Log Retention Policy: retention window = ${savedPolicy.retentionDays} days, auto-purge = ${savedPolicy.autoPurgeEnabled ? "ENABLED" : "DISABLED"}.`,
      metadata: {
        retention_days: savedPolicy.retentionDays,
        auto_purge_enabled: savedPolicy.autoPurgeEnabled,
        updated_by: session.user.username
      }
    }).catch(() => {});

    const stats = await getAuditLogStats().catch(() => null);

    return NextResponse.json({ ok: true, policy: savedPolicy, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save audit retention policy.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
