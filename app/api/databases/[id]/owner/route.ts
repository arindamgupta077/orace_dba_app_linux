import { NextResponse } from "next/server";

import { changeDatabaseOwner, insertAuditLog } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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

export async function PUT(request: Request, context: RouteContext) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;

    const params = await context.params;
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ message: "Invalid database id." }, { status: 400 });
    }

    const body = (await request.json()) as { owner_id?: number };
    const database = await changeDatabaseOwner(id, Number(body.owner_id), auth.session!.user.username);

    await insertAuditLog({
      actor: auth.session!.user.username,
      action: "db_inventory_owner_change",
      db: database.name,
      status: "success",
      detail: `Changed database owner for ${database.name}.`,
      metadata: { database_id: database.id, owner_id: database.owner_id }
    });

    return NextResponse.json({ database });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to change database owner.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
