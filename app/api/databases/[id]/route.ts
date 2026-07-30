import { NextResponse } from "next/server";

import {
  deleteDatabaseInventory,
  getDatabaseInventory,
  insertAuditLog,
  insertChangeAuditLog,
  updateDatabaseInventory
} from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DatabaseInventoryInput } from "@/types/dba";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
    database_instance: body.database_instance ? String(body.database_instance) : undefined,
    db_port: body.db_port !== undefined && body.db_port !== null && String(body.db_port).trim() !== "" ? Number(body.db_port) : undefined,
    division: body.division ? String(body.division) : undefined
  };
}

async function readDatabaseId(context: RouteContext) {
  const params = await context.params;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid database id.");
  }
  return id;
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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const id = await readDatabaseId(context);
    const database = await getDatabaseInventory(id, {
      role: session.user.role,
      userId: session.userId
    });
    if (!database) {
      return NextResponse.json({ message: "Database not found." }, { status: 404 });
    }

    return NextResponse.json({ database });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load database.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;

    const id = await readDatabaseId(context);
    const body = (await request.json()) as Partial<DatabaseInventoryInput>;

    // Fetch old record before update for field-level diff tracking
    const oldRecord = await getDatabaseInventory(id);

    const database = await updateDatabaseInventory(id, readInventoryBody(body), auth.session!.user.username);

    await insertAuditLog({
      actor: auth.session!.user.username,
      action: "db_inventory_update",
      db: database.name,
      status: "success",
      detail: `Updated database inventory record for ${database.name}.`,
      metadata: { database_id: database.id, owner_id: database.owner_id }
    });

    // Compute field-level diffs for change audit
    if (oldRecord) {
      const fieldMap: Array<{ field: string; oldVal: string; newVal: string }> = [
        { field: "database_name", oldVal: oldRecord.database_name, newVal: database.database_name },
        { field: "environment", oldVal: oldRecord.environment, newVal: database.environment },
        { field: "location", oldVal: oldRecord.location, newVal: database.location },
        { field: "operating_system", oldVal: oldRecord.os, newVal: database.os },
        { field: "database_role", oldVal: oldRecord.role, newVal: database.role },
        { field: "database_type", oldVal: oldRecord.db_type, newVal: database.db_type },
        { field: "status", oldVal: oldRecord.status, newVal: database.status },
        { field: "environment_label", oldVal: oldRecord.env_label, newVal: database.env_label },
        { field: "owner_id", oldVal: String(oldRecord.owner_id), newVal: String(database.owner_id) },
        { field: "server_name", oldVal: oldRecord.server_name || "", newVal: database.server_name || "" },
        { field: "server_ip", oldVal: oldRecord.server_ip || "", newVal: database.server_ip || "" },
        { field: "zone", oldVal: oldRecord.zone || "", newVal: database.zone || "" },
        { field: "server_type", oldVal: oldRecord.server_type, newVal: database.server_type },
        { field: "db_version", oldVal: oldRecord.db_version || "", newVal: database.db_version || "" },
        { field: "db_edition", oldVal: oldRecord.db_edition || "", newVal: database.db_edition || "" },
        { field: "database_instance", oldVal: oldRecord.database_instance || "", newVal: database.database_instance || "" },
        { field: "db_port", oldVal: String(oldRecord.db_port), newVal: String(database.db_port) },
        { field: "division", oldVal: oldRecord.division, newVal: database.division }
      ];
      const changes = fieldMap
        .filter((f) => f.oldVal !== f.newVal)
        .map((f) => ({ field: f.field, oldValue: f.oldVal, newValue: f.newVal }));

      if (changes.length > 0) {
        await insertChangeAuditLog({
          entityType: "DATABASE_INVENTORY",
          entityId: database.id,
          entityName: database.name,
          action: "UPDATE",
          changedBy: auth.session!.user.username,
          changes
        });
      }
    }

    return NextResponse.json({ database });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update database.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;

    const id = await readDatabaseId(context);
    const existing = await getDatabaseInventory(id);
    await deleteDatabaseInventory(id);

    await insertAuditLog({
      actor: auth.session!.user.username,
      action: "db_inventory_delete",
      db: existing?.name,
      status: "success",
      detail: `Deleted database inventory record ${existing?.name || id}.`,
      metadata: { database_id: id, owner_id: existing?.owner_id }
    });

    await insertChangeAuditLog({
      entityType: "DATABASE_INVENTORY",
      entityId: id,
      entityName: existing?.name || String(id),
      action: "DELETE",
      changedBy: auth.session!.user.username,
      changeSummary: `Deleted database "${existing?.name || id}" (ID: ${id})`
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete database.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
