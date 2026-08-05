import { NextResponse } from "next/server";

import {
  cancelShiftSession,
  getActiveShiftSessionForUser,
  getShiftSessionById,
  insertAuditLog
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { getShiftLabel } from "@/lib/server/shift-utils";
import { formatAppDateTime } from "@/lib/utils";

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

    const body = (await request.json().catch(() => ({}))) as { sessionId?: number };

    let targetSessionId: number;
    if (body.sessionId) {
      targetSessionId = Number(body.sessionId);
    } else {
      try {
        const active = await getActiveShiftSessionForUser(session.userId);
        targetSessionId = active.session_id;
      } catch {
        return NextResponse.json({ message: "No active shift session found to cancel." }, { status: 404 });
      }
    }

    const targetSession = await getShiftSessionById(targetSessionId);
    if (!targetSession) {
      return NextResponse.json({ message: "Shift session not found." }, { status: 404 });
    }

    // Permission check: Only the user who started the shift or app_admin role users can cancel
    if (targetSession.user_id !== session.userId && session.user.role !== "app_admin") {
      return NextResponse.json({ message: "Forbidden: Only the DBA who started the shift or APP_ADMIN can cancel this shift session." }, { status: 403 });
    }

    const canceled = await cancelShiftSession({ sessionId: targetSessionId, actor: session.user.username });

    await insertAuditLog({
      actor: session.user.username,
      action: "shift_cancel",
      status: "success",
      detail: `Canceled and deleted mistaken shift session for ${getShiftLabel(canceled.shiftNumber)} (DBA: ${canceled.username}).`
    });

    void dispatchShiftWebhook("dba_logout", {
      action: "dba_logout",
      username: canceled.username,
      email: targetSession.email || "",
      logout_time: formatAppDateTime(new Date()),
      handover_text: "[Shift Canceled / Mistaken Login Deleted]",
      shift: getShiftLabel(canceled.shiftNumber)
    });

    emitGlobalNotification({
      id: `DBA-CANCEL-${targetSessionId}`,
      type: "dba_shift",
      severity: "warning",
      db: getShiftLabel(canceled.shiftNumber),
      title: `DBA Shift Canceled: ${canceled.username}`,
      message: `${session.user.username} canceled mistaken shift login for ${canceled.username} (${getShiftLabel(canceled.shiftNumber)}). Record deleted from database.`,
      timestamp: new Date().toISOString(),
      targetPath: "/dba-console/shift-management"
    });

    return NextResponse.json({ message: "Shift session canceled and deleted successfully.", sessionId: targetSessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel shift session.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
