import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_SECURITY_POSTURE_POLICY, type SecurityPosturePolicyConfig } from "@/lib/security-posture-policy";
import { getSecurityPosturePolicyConfig, insertAuditLog, setSecurityPosturePolicyConfig } from "@/lib/server/repository";
import { reloadSecurityPosturePolicy } from "@/lib/server/scheduler";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const policy = await getSecurityPosturePolicyConfig();
    return NextResponse.json({ policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load security posture policy.";
    return NextResponse.json({ message, policy: DEFAULT_SECURITY_POSTURE_POLICY }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  // Only app_admin is authorized to change global security posture policy
  if (session.user.role !== "app_admin") {
    return NextResponse.json(
      { message: "Forbidden: Only app_admin can modify security posture policy." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as Partial<SecurityPosturePolicyConfig>;

    const outdatedAfterMinutes = body.outdatedAfterMinutes !== undefined ? Number(body.outdatedAfterMinutes) : undefined;
    const outdatedWebhookMaxSends = body.outdatedWebhookMaxSends !== undefined ? Number(body.outdatedWebhookMaxSends) : undefined;
    const outdatedWebhookIntervalHours = body.outdatedWebhookIntervalHours !== undefined ? Number(body.outdatedWebhookIntervalHours) : undefined;
    const outdatedWebhookCheckIntervalMinutes = body.outdatedWebhookCheckIntervalMinutes !== undefined ? Number(body.outdatedWebhookCheckIntervalMinutes) : undefined;

    if (outdatedAfterMinutes !== undefined && (!Number.isFinite(outdatedAfterMinutes) || outdatedAfterMinutes < 1 || outdatedAfterMinutes > 525600)) {
      return NextResponse.json(
        { message: "Invalid outdatedAfterMinutes. Must be between 1 and 525600 minutes (up to 365 days)." },
        { status: 400 }
      );
    }

    if (outdatedWebhookMaxSends !== undefined && (!Number.isFinite(outdatedWebhookMaxSends) || outdatedWebhookMaxSends < 1 || outdatedWebhookMaxSends > 100)) {
      return NextResponse.json(
        { message: "Invalid outdatedWebhookMaxSends. Must be between 1 and 100." },
        { status: 400 }
      );
    }

    if (outdatedWebhookIntervalHours !== undefined && (!Number.isFinite(outdatedWebhookIntervalHours) || outdatedWebhookIntervalHours < 1 || outdatedWebhookIntervalHours > 720)) {
      return NextResponse.json(
        { message: "Invalid outdatedWebhookIntervalHours. Must be between 1 and 720 hours (up to 30 days)." },
        { status: 400 }
      );
    }

    if (outdatedWebhookCheckIntervalMinutes !== undefined && (!Number.isFinite(outdatedWebhookCheckIntervalMinutes) || outdatedWebhookCheckIntervalMinutes < 1 || outdatedWebhookCheckIntervalMinutes > 1440)) {
      return NextResponse.json(
        { message: "Invalid outdatedWebhookCheckIntervalMinutes. Must be between 1 and 1440 minutes (up to 24 hours)." },
        { status: 400 }
      );
    }

    const saved = await setSecurityPosturePolicyConfig(
      {
        outdatedAfterMinutes,
        outdatedWebhookMaxSends,
        outdatedWebhookIntervalHours,
        outdatedWebhookCheckIntervalMinutes
      },
      session.user.username
    );

    // Reschedule scheduler background task if interval changed
    await reloadSecurityPosturePolicy().catch(() => {});

    // Record in audit log
    await insertAuditLog({
      actor: session.user.username,
      action: "configure_security_posture_policy",
      db: "GLOBAL",
      status: "success",
      detail: `App Admin ${session.user.username} updated Security Posture policy: outdated after ${saved.outdatedAfterMinutes}m, max sends ${saved.outdatedWebhookMaxSends}, webhook interval ${saved.outdatedWebhookIntervalHours}h, check interval ${saved.outdatedWebhookCheckIntervalMinutes}m.`,
      metadata: {
        policy: saved,
        updated_by: session.user.username
      }
    }).catch(() => {});

    return NextResponse.json({ ok: true, policy: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save security posture policy.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
