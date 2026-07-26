import { NextResponse } from "next/server";

import { listShiftSessionHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// All authenticated roles can view shift login/logout log history.
export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 50;

    const sessions = await listShiftSessionHistory(limit);
    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load shift session logs.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
