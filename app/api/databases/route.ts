import { NextResponse } from "next/server";

import {
  createDatabaseInventory,
  insertAuditLog,
  listDatabaseInventory
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DatabaseInventoryInput } from "@/types/dba";

export const dynamic = "force-dynamic";

function readInventoryBody(body: Partial<DatabaseInventoryInput>): DatabaseInventoryInput {
  return {
    database_name: String(body.database_name || ""),
    environment: String(body.environment || ""),
    location: String(body.location || ""),
    operating_system: String(body.operating_system || ""),
    database_role: String(body.database_role || ""),
    database_type: String(body.database_type || ""),
    status: String(body.status || ""),
    environment_label: String(body.environment_label || ""),
    owner_id: Number(body.owner_id),
    server_name: body.server_name ? String(body.server_name) : undefined,
    server_ip: body.server_ip ? String(body.server_ip) : undefined,
    zone: body.zone ? String(body.zone) : undefined,
    server_type: body.server_type ? String(body.server_type) : undefined,
    db_version: body.db_version ? String(body.db_version) : undefined,
    db_edition: body.db_edition ? String(body.db_edition) : undefined,
    db_port: body.db_port !== undefined && body.db_port !== null && String(body.db_port).trim() !== "" ? Number(body.db_port) : undefined,
    division: body.division ? String(body.division) : undefined
  };
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

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const databases = await listDatabaseInventory({
      role: session.user.role,
      userId: session.userId,
      selectorOnly: new URL(request.url).searchParams.get("selector") === "1"
    });
    return NextResponse.json({ databases });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load database inventory.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;

    const body = (await request.json()) as Partial<DatabaseInventoryInput>;
    const database = await createDatabaseInventory(readInventoryBody(body), auth.session!.user.username);

    await insertAuditLog({
      actor: auth.session!.user.username,
      action: "db_inventory_create",
      db: database.name,
      status: "success",
      detail: `Created database inventory record for ${database.name}.`,
      metadata: { database_id: database.id, owner_id: database.owner_id }
    });

    return NextResponse.json({ database }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create database.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
