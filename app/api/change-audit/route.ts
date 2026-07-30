import { NextResponse } from "next/server";

import { listChangeAuditLogs } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { ChangeAuditEntityType } from "@/lib/server/repository";

export const dynamic = "force-dynamic";

const VALID_ENTITY_TYPES = new Set<string>(["DATABASE_INVENTORY", "APP_USER"]);

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }
    if (session.user.role !== "app_admin") {
      return NextResponse.json({ message: "App admin role required." }, { status: 403 });
    }

    const url = new URL(request.url);
    const entityType = (url.searchParams.get("entityType") || "").toUpperCase();
    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return NextResponse.json(
        { message: "Invalid entityType. Must be DATABASE_INVENTORY or APP_USER." },
        { status: 400 }
      );
    }

    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 10000) : 500;

    const items = await listChangeAuditLogs(entityType as ChangeAuditEntityType, limit);
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected change audit error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
