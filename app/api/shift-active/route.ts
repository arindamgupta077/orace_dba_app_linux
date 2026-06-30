import { NextResponse } from "next/server";

import { getCurrentShiftState } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// Lightweight endpoint for header polling — returns active DBA names + shift label only.
export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const state = await getCurrentShiftState();
    return NextResponse.json({
      active_shifts: state.active_shifts,
      shift_label: state.shift_label,
      overlap: state.overlap,
      active_dbas: state.active_dbas.map((d) => ({
        session_id: d.session_id,
        username: d.username,
        shift_number: d.shift_number
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load active DBAs.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
