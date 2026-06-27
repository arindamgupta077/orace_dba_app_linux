import { NextResponse } from "next/server";

import { listAuditLogs } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || "200");

    // For "client" role users, restrict results to their own databases only.
    const items = await listAuditLogs(limit, {
      role: session.user.role,
      userId: session.userId,
    });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected audit log error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
