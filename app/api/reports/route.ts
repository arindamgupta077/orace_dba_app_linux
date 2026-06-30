import { NextResponse } from "next/server";

import { getShiftReport } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { ShiftReportFilters } from "@/types/dba";

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

export async function GET(request: Request) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const filters: ShiftReportFilters = {
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
      dbaUserId: searchParams.get("dbaUserId") ? Number(searchParams.get("dbaUserId")) : undefined,
      shiftNumber: searchParams.get("shiftNumber") ? Number(searchParams.get("shiftNumber")) : undefined
    };

    const report = await getShiftReport(filters);
    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate shift report.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
