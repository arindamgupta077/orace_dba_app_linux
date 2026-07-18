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
    const limitParam = url.searchParams.get("limit");
    const limit = (limitParam === "unlimited" || !limitParam) ? undefined : Number(limitParam);
    const offsetParam = url.searchParams.get("offset");
    const offset = offsetParam ? Number(offsetParam) : undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;

    // For "client" role users, restrict results to their own databases only.
    const items = await listAuditLogs(limit, {
      role: session.user.role,
      userId: session.userId,
      offset,
      startDate,
      endDate
    });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected audit log error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
