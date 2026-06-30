import { NextResponse } from "next/server";

import { listDbStatusChecks, upsertDbStatusCheck, insertAuditLog } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { getActiveShifts, getShiftStartDate, toOracleDateString } from "@/lib/server/shift-utils";
import type { DbStatusValue } from "@/types/dba";

export const dynamic = "force-dynamic";

const VALID_STATUSES: DbStatusValue[] = ["UP", "DOWN", "PARTIAL", "MAINTENANCE"];

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

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const shiftNumber = Number(searchParams.get("shiftNumber") || 0);
    const shiftDate = searchParams.get("shiftDate");

    if (!shiftNumber || !shiftDate) {
      return NextResponse.json({ message: "shiftNumber and shiftDate query params are required." }, { status: 400 });
    }

    const checks = await listDbStatusChecks(shiftNumber, shiftDate);
    return NextResponse.json({ checks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load database status checks.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireDbaRole();
    if (auth.response) return auth.response;
    const session = auth.session!;

    const body = (await request.json()) as {
      databaseId?: number;
      shiftNumber?: number;
      shiftDate?: string;
      status?: DbStatusValue;
      commentText?: string;
    };

    const databaseId = Number(body.databaseId);
    const status = (body.status || "").toUpperCase() as DbStatusValue;
    const commentText = body.commentText?.trim();

    if (!databaseId) {
      return NextResponse.json({ message: "databaseId is required." }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ message: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }

    let shiftNumber = body.shiftNumber ? Number(body.shiftNumber) : 0;
    let shiftDate = body.shiftDate;
    if (!shiftNumber || !shiftDate) {
      const activeShifts = getActiveShifts();
      if (activeShifts.length === 0) {
        return NextResponse.json({ message: "No shift is active right now." }, { status: 400 });
      }
      shiftNumber = activeShifts[0];
      shiftDate = toOracleDateString(getShiftStartDate(new Date(), shiftNumber));
    }

    const check = await upsertDbStatusCheck({
      databaseId,
      shiftNumber,
      shiftDate,
      status,
      checkedBy: session.userId,
      checkedUsername: session.user.username,
      commentText,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "db_status_check",
      status: "success",
      detail: `Database ${check.database_name} status: ${status} (Shift ${shiftNumber}, ${shiftDate}).`
    });

    return NextResponse.json({ check }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save database status check.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
