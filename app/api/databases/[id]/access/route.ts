import { NextResponse } from "next/server";

import { insertAuditLog, setDatabaseAccess } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    if (session.user.role !== "app_admin") {
      return NextResponse.json({ message: "App admin role required." }, { status: 403 });
    }

    const { id: idParam } = await context.params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ message: "Invalid database id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { enable_access?: unknown };
    if (typeof body.enable_access !== "boolean") {
      return NextResponse.json({ message: "enable_access must be a boolean." }, { status: 400 });
    }

    const database = await setDatabaseAccess(id, body.enable_access, session.user.username);
    await insertAuditLog({
      actor: session.user.username,
      action: "db_inventory_access_update",
      db: database.name,
      status: "success",
      detail: `${body.enable_access ? "Enabled" : "Disabled"} non-admin selector access for ${database.name}.`,
      metadata: { database_id: database.id, enable_access: body.enable_access }
    });

    return NextResponse.json({ database });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update database access.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
