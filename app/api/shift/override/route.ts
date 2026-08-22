import { NextResponse } from "next/server";

import { overrideHandover, insertAuditLog, closeShiftSession, getShiftSessionById } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { getShiftLabel } from "@/lib/server/shift-utils";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { formatAppDateTime, formatIstIsoString } from "@/lib/utils";

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
      return NextResponse.json({ message: "A reason is required for admin force close." }, { status: 400 });
    }

    const sessionId = body.sessionId ? Number(body.sessionId) : undefined;
    const handoverId = body.handoverId ? Number(body.handoverId) : undefined;

    if (!sessionId && !handoverId) {
      return NextResponse.json({ message: "Either sessionId or handoverId is required." }, { status: 400 });
    }

    let targetSession = sessionId ? await getShiftSessionById(sessionId) : null;
    const targetHandoverId = handoverId || targetSession?.handover_id;

    // An admin cannot force close their own shift session — another admin must perform the action
    const targetUserId = targetSession?.user_id;
    const targetUsername = targetSession?.username;
    if (
      (targetUserId && targetUserId === session.userId) ||
      (targetUsername && targetUsername.toLowerCase() === session.user.username.toLowerCase())
    ) {
      return NextResponse.json(
        { message: "You cannot force close your own shift session. Another administrator must perform this action if required." },
        { status: 403 }
      );
    }

    let handover = null;
    if (targetHandoverId) {
      try {
        handover = await overrideHandover({
          handoverId: targetHandoverId,
          adminUserId: session.userId,
          adminUsername: session.user.username,
          reason,
          actor: session.user.username
        });
      } catch (err) {
        // If handover was not found or already acknowledged, continue to close the session
        console.warn("[Override] Handover override warning:", err);
      }
    }

    const targetSessionId = sessionId || handover?.session_id;
    let closedSession = null;
    if (targetSessionId) {
      closedSession = await closeShiftSession({
        sessionId: targetSessionId,
        actor: session.user.username,
        forceCloseComment: reason,
        forceClosedBy: session.user.username
      });
      if (!targetSession) {
        targetSession = closedSession;
      }
    }

    const targetUser = targetSession?.username || handover?.author_username || "DBA";
    const targetShiftNumber = targetSession?.shift_number || handover?.shift_number || 1;
    const targetShiftLabel = getShiftLabel(targetShiftNumber);

    await insertAuditLog({
      actor: session.user.username,
      action: "shift_force_close",
      status: "success",
      detail: `Admin force close: terminated shift session for ${targetUser} (${targetShiftLabel}). Reason: ${reason}`
    });

    void dispatchShiftWebhook("handover_override", {
      action: "handover_override",
      username: session.user.username,
      email: session.user.username,
      shift: targetShiftLabel,
      author: targetUser,
      reason,
      timestamp: formatIstIsoString(new Date())
    });

    emitGlobalNotification({
      id: `FORCE-CLOSE-${targetSessionId || Date.now()}`,
      type: "dba_shift",
      severity: "warning",
      db: targetShiftLabel,
      title: `Admin Force Close: ${targetUser}`,
      message: `${session.user.username} force closed the shift session for ${targetUser} (${targetShiftLabel}) at ${formatAppDateTime(new Date())} IST. Reason: ${reason}`,
      timestamp: new Date().toISOString(),
      targetPath: "/dba-console/shift-management"
    });

    return NextResponse.json({ handover, session: closedSession });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to force close shift session.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
