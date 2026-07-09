import { NextResponse } from "next/server";

import {
  createHandover,
  getActiveShiftSessionForUser,
  getHandoverForSession,
  insertAuditLog
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { getShiftLabel } from "@/lib/server/shift-utils";

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

    const body = (await request.json()) as { handoverText?: string; sessionId?: number };
    const handoverText = (body.handoverText || "").trim();
    if (!handoverText) {
      return NextResponse.json({ message: "Handover text is required." }, { status: 400 });
    }

    let sessionId: number;
    if (body.sessionId) {
      sessionId = Number(body.sessionId);
    } else {
      const active = await getActiveShiftSessionForUser(session.userId);
      sessionId = active.session_id;
    }

    // Prevent duplicate pending handover for the same session.
    const existing = await getHandoverForSession(sessionId);
    if (existing && existing.status === "PENDING") {
      return NextResponse.json(
        { message: "A pending handover already exists for this session. Please wait for acknowledgement." },
        { status: 409 }
      );
    }

    const active = await getActiveShiftSessionForUser(session.userId);
    const handover = await createHandover({
      sessionId,
      authorUserId: session.userId,
      authorUsername: session.user.username,
      shiftNumber: active.shift_number,
      handoverText,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "handover_submit",
      status: "success",
      detail: `Submitted handover for ${getShiftLabel(active.shift_number)}.`
    });

    void dispatchShiftWebhook("handover_submitted", {
      action: "handover_submitted",
      username: handover.author_username,
      email: session.user.username,
      shift: getShiftLabel(active.shift_number),
      handover_text: handoverText
    });

    emitGlobalNotification({
      id: `DBA-HO-${handover.handover_id}`,
      type: "dba_shift",
      severity: "warning",
      db: getShiftLabel(active.shift_number),
      title: `Handover Submitted: ${handover.author_username}`,
      message: `${handover.author_username} submitted a handover for ${getShiftLabel(active.shift_number)}. Pending acknowledgement.`,
      timestamp: handover.created_at || new Date().toISOString(),
      targetPath: "/dba-console/shift-management"
    });

    return NextResponse.json({ handover }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit handover.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
