import { NextResponse } from "next/server";

import { overrideHandover, insertAuditLog, closeShiftSession } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { getShiftLabel } from "@/lib/server/shift-utils";
import { emitGlobalNotification } from "@/lib/server/notification-events";

export const dynamic = "force-dynamic";

async function requireAppAdmin() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  }
  if (session.user.role !== "app_admin") {
    return { session: null, response: NextResponse.json({ message: "App admin role required." }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;
    const session = auth.session!;

    const body = (await request.json()) as {
      handoverId?: number;
      reason?: string;
      closeSession?: boolean;
      sessionId?: number;
    };

    const reason = (body.reason || "").trim();
    if (!reason) {
      return NextResponse.json({ message: "A reason is required for an override." }, { status: 400 });
    }

    const handoverId = body.handoverId ? Number(body.handoverId) : undefined;
    if (!handoverId) {
      return NextResponse.json({ message: "handoverId is required." }, { status: 400 });
    }

    const handover = await overrideHandover({
      handoverId,
      adminUserId: session.userId,
      adminUsername: session.user.username,
      reason,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "handover_override",
      status: "success",
      detail: `Admin override: acknowledged handover from ${handover.author_username}. Reason: ${reason}`
    });

    void dispatchShiftWebhook("handover_override", {
      action: "handover_override",
      username: session.user.username,
      email: session.user.username,
      shift: getShiftLabel(handover.shift_number),
      author: handover.author_username,
      reason
    });

    emitGlobalNotification({
      id: `DBA-HOACK-${handover.handover_id}-${Date.now()}`,
      type: "dba_shift",
      severity: "info",
      db: getShiftLabel(handover.shift_number),
      title: `Handover Override: ${session.user.username}`,
      message: `${session.user.username} force-acknowledged the handover from ${handover.author_username} for ${getShiftLabel(handover.shift_number)}.`,
      timestamp: handover.ack_at || new Date().toISOString(),
      targetPath: "/dba-console/shift-management"
    });

    // Optionally force-close the session too.
    let closedSession = null;
    if (body.closeSession && body.sessionId) {
      closedSession = await closeShiftSession({
        sessionId: Number(body.sessionId),
        actor: session.user.username
      });
    }

    return NextResponse.json({ handover, session: closedSession });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to override handover.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
