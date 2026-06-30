import { NextResponse } from "next/server";

import { acknowledgeHandover, insertAuditLog } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
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

    const body = (await request.json()) as { handoverId?: number };
    const handoverId = Number(body.handoverId);
    if (!handoverId) {
      return NextResponse.json({ message: "handoverId is required." }, { status: 400 });
    }

    const handover = await acknowledgeHandover({
      handoverId,
      ackUserId: session.userId,
      ackUsername: session.user.username,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "handover_ack",
      status: "success",
      detail: `Acknowledged handover from ${handover.author_username} for ${getShiftLabel(handover.shift_number)}.`
    });

    void dispatchShiftWebhook("handover_acknowledged", {
      action: "handover_acknowledged",
      username: session.user.username,
      email: session.user.username,
      shift: getShiftLabel(handover.shift_number),
      author: handover.author_username
    });

    return NextResponse.json({ handover });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to acknowledge handover.";
    if (/own handover/i.test(message)) {
      return NextResponse.json({ message }, { status: 403 });
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}
