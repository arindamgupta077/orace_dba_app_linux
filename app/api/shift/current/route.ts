import { NextResponse } from "next/server";

import { getCurrentShiftState, getLogoutChecklistReadiness } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const state = await getCurrentShiftState();
    const activeSession = state.sessions.find((item) => item.user_id === session.userId);
    const logoutChecklist = activeSession
      ? await getLogoutChecklistReadiness(activeSession)
      : undefined;

    return NextResponse.json({ ...state, logout_checklist: logoutChecklist });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load current shift state.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
