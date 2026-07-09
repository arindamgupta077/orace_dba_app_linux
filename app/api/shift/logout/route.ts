import { NextResponse } from "next/server";

import {
  closeShiftSession,
  getActiveShiftSessionForUser,
  getHandoverForSession,
  insertAuditLog
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { getShiftLabel, isGeneralShift } from "@/lib/server/shift-utils";

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

    const body = (await request.json().catch(() => ({}))) as { sessionId?: number; force?: boolean };

    let targetSessionId: number;
    if (body.sessionId) {
      targetSessionId = Number(body.sessionId);
    } else {
      const active = await getActiveShiftSessionForUser(session.userId);
      targetSessionId = active.session_id;
    }

    const isAdminOverride = session.user.role === "app_admin" && body.force === true;

    // Fetch the session to check its shift type.
    const activeSession = await getActiveShiftSessionForUser(session.userId);
    const isGeneral = isGeneralShift(activeSession.shift_number);

    // Logout rule: blocked until handover is acknowledged (unless app_admin
    // override or General Shift — general shift does not require handover).
    if (!isAdminOverride && !isGeneral) {
      const handover = await getHandoverForSession(targetSessionId);
      if (!handover || handover.status !== "ACKNOWLEDGED") {
        return NextResponse.json(
          { message: "Logout blocked: your handover has not been acknowledged by another DBA yet." },
          { status: 409 }
        );
      }
    }

    const closed = await closeShiftSession({ sessionId: targetSessionId, actor: session.user.username });

    await insertAuditLog({
      actor: session.user.username,
      action: "shift_logout",
      status: "success",
      detail: `Logged out from ${getShiftLabel(closed.shift_number)}.`
    });

    const handover = await getHandoverForSession(targetSessionId);
    void dispatchShiftWebhook("dba_logout", {
      action: "dba_logout",
      username: closed.username,
      email: closed.email,
      logout_time: closed.logout_at,
      handover_text: handover?.handover_text || "",
      shift: getShiftLabel(closed.shift_number)
    });

    emitGlobalNotification({
      id: `DBA-LOGOUT-${targetSessionId}-${Date.now()}`,
      type: "dba_shift",
      severity: "info",
      db: getShiftLabel(closed.shift_number),
      title: `DBA Logout: ${closed.username}`,
      message: `${closed.username} logged out from ${getShiftLabel(closed.shift_number)} at ${closed.logout_at}.`,
      timestamp: closed.logout_at || new Date().toISOString(),
      targetPath: "/dba-console/shift-management"
    });

    return NextResponse.json({ session: closed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to logout from shift.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
