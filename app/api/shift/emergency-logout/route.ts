import { NextResponse } from "next/server";

import {
  closeShiftSession,
  getActiveShiftSessionForUser,
  getHandoverForSession,
  getShiftSessionById,
  insertAuditLog
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { getShiftLabel } from "@/lib/server/shift-utils";
import { formatAppDateTime, formatIstIsoString } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function requireDbaRole() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  }
  if (session.user.role !== "app_admin" && session.user.role !== "dba_admin") {
    return { session: null, response: NextResponse.json({ message: "DBA admin role required." }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireDbaRole();
    if (auth.response) return auth.response;
    const session = auth.session!;

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: number;
      comment?: string;
    };

    const comment = (body.comment || "").trim();
    if (!comment) {
      return NextResponse.json(
        { message: "A reason / comment is mandatory for emergency shift logout." },
        { status: 400 }
      );
    }

    let targetSessionId: number;
    if (body.sessionId) {
      targetSessionId = Number(body.sessionId);
    } else {
      try {
        const active = await getActiveShiftSessionForUser(session.userId);
        targetSessionId = active.session_id;
      } catch {
        return NextResponse.json({ message: "No active shift session found to logout." }, { status: 404 });
      }
    }

    const targetSession = await getShiftSessionById(targetSessionId);
    if (!targetSession) {
      return NextResponse.json({ message: "Shift session not found." }, { status: 404 });
    }

    // Permission check: Only the DBA on shift or app_admin can perform emergency logout
    if (targetSession.user_id !== session.userId && session.user.role !== "app_admin") {
      return NextResponse.json(
        { message: "Forbidden: You can only perform emergency logout on your own active shift session." },
        { status: 403 }
      );
    }

    if (targetSession.status !== "ACTIVE" || !targetSession.is_active) {
      return NextResponse.json(
        { message: "Shift session is not active or has already been closed." },
        { status: 400 }
      );
    }

    // Close session directly, bypassing handover acknowledgment and checklist requirements
    const closed = await closeShiftSession({
      sessionId: targetSessionId,
      actor: session.user.username,
      emergencyComment: comment
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "shift_emergency_logout",
      status: "warning",
      detail: `Emergency logout from ${getShiftLabel(closed.shift_number)} by ${session.user.username}. Reason: ${comment}`
    });

    const handover = await getHandoverForSession(targetSessionId);
    void dispatchShiftWebhook("dba_logout", {
      action: "dba_logout",
      username: closed.username,
      email: closed.email,
      logout_time: formatIstIsoString(closed.logout_at),
      handover_text: handover?.handover_text ? `${handover.handover_text} [Emergency Logout: ${comment}]` : `[Emergency Logout: ${comment}]`,
      shift: getShiftLabel(closed.shift_number)
    });

    emitGlobalNotification({
      id: `DBA-LOGOUT-${targetSessionId}`,
      type: "dba_shift",
      severity: "warning",
      db: getShiftLabel(closed.shift_number),
      title: `DBA Emergency Logout: ${closed.username}`,
      message: `${closed.username} performed an emergency logout from ${getShiftLabel(closed.shift_number)} at ${formatAppDateTime(closed.logout_at)} IST. Reason: ${comment}`,
      timestamp: closed.logout_at || new Date().toISOString(),
      targetPath: "/dba-console/shift-management"
    });

    return NextResponse.json({
      message: "Emergency shift logout completed successfully.",
      session: closed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute emergency logout.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
