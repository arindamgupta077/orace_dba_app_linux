import { NextResponse } from "next/server";

import { createShiftLogin, getTakenShifts, insertAuditLog, listActiveShiftSessions } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { dispatchShiftWebhook } from "@/lib/server/shift-webhook";
import { getSelectableShifts, getShiftLabel, isGeneralShift } from "@/lib/server/shift-utils";

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

    const body = (await request.json()) as { shiftNumber?: number };
    const selectable = getSelectableShifts();

    // General Shift (4) can be logged in at any time.
    // Time-based shifts (1/2/3) can be logged in if they are currently active
    // OR starting within the 6-hour buffer window (enabled in the dropdown).
    const requestedShift = body.shiftNumber ? Number(body.shiftNumber) : selectable.preferredShift;

    if (!requestedShift) {
      return NextResponse.json({ message: "No shift is selectable at this time." }, { status: 400 });
    }

    if (!isGeneralShift(requestedShift) && !selectable.enabledShifts.includes(requestedShift)) {
      return NextResponse.json(
        { message: `Shift ${requestedShift} is not available right now. Available shifts: ${selectable.enabledShifts.join(", ")}.` },
        { status: 400 }
      );
    }

    // Enforce one DBA per time-based shift (1,2,3). General Shift allows multiple.
    if (!isGeneralShift(requestedShift)) {
      const takenShifts = await getTakenShifts();
      if (takenShifts.includes(requestedShift)) {
        const takenBy = (await listActiveShiftSessions()).find(
          (s) => s.shift_number === requestedShift && s.is_active
        );
        return NextResponse.json(
          {
            message: `Shift ${requestedShift} is already taken by ${takenBy?.username || "another DBA"}. Please log in to a different shift or General Shift.`
          },
          { status: 409 }
        );
      }
    }

    const shiftNumber = requestedShift;

    const created = await createShiftLogin({
      userId: session.userId,
      username: session.user.username,
      shiftNumber,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "shift_login",
      status: "success",
      detail: `Logged in to ${getShiftLabel(shiftNumber)}.`
    });

    // Fire-and-forget webhook AFTER the transaction is committed.
    void dispatchShiftWebhook("dba_login", {
      action: "dba_login",
      username: created.username,
      email: created.email,
      login_time: created.login_at,
      shift: getShiftLabel(shiftNumber)
    });

    return NextResponse.json({ session: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to login to shift.";
    if (/ORA-00001|unique/i.test(message)) {
      return NextResponse.json({ message: "You are already logged in to a shift." }, { status: 409 });
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}
