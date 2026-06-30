import { NextResponse } from "next/server";

import { listHandoverHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// All authenticated roles can view handover history (it's operational context).
// dba_admin and app_admin see all; other roles also see all since handovers are
// operational info visible to the whole team per the spec.
export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 20;

    const handovers = await listHandoverHistory(limit);
    return NextResponse.json({ handovers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load handover history.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
