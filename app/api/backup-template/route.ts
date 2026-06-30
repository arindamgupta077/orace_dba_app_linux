import { NextResponse } from "next/server";

import { createBackupTemplate, insertAuditLog, listBackupTemplates } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

async function requireDbaRole() {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  }
  if (session.user.role !== "app_admin" && session.user.role !== "dba_admin") {
    return { session: null, response: NextResponse.json({ message: "DBA admin role required." }, { status: 403 }) };
  }
  return { session, response: null };
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
    const auth = await requireDbaRole();
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    const templates = await listBackupTemplates(activeOnly);
    return NextResponse.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load backup templates.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;
    const session = auth.session!;

    const body = (await request.json()) as {
      databaseId?: number;
      backupName?: string;
      scheduledTime?: string;
      backupType?: string;
    };

    const databaseId = Number(body.databaseId);
    const backupName = (body.backupName || "").trim();

    if (!databaseId || !backupName) {
      return NextResponse.json({ message: "databaseId and backupName are required." }, { status: 400 });
    }

    const template = await createBackupTemplate({
      databaseId,
      backupName,
      scheduledTime: body.scheduledTime?.trim() || undefined,
      backupType: body.backupType?.trim() || undefined,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "backup_template_create",
      status: "success",
      detail: `Created backup template "${backupName}" for database ${template.database_name}.`
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create backup template.";
    if (/ORA-00001|unique/i.test(message)) {
      return NextResponse.json({ message: "A backup with that name already exists for this database." }, { status: 409 });
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}
