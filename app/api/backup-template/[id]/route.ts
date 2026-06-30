import { NextResponse } from "next/server";

import { deleteBackupTemplate, insertAuditLog, updateBackupTemplate, listBackupTemplates } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;
    const session = auth.session!;

    const { id } = await params;
    const backupId = Number(id);
    if (!backupId) {
      return NextResponse.json({ message: "Invalid backup template id." }, { status: 400 });
    }

    const body = (await request.json()) as {
      databaseId?: number;
      backupName?: string;
      scheduledTime?: string;
      backupType?: string;
      isActive?: boolean;
    };

    const databaseId = Number(body.databaseId);
    const backupName = (body.backupName || "").trim();

    if (!databaseId || !backupName) {
      return NextResponse.json({ message: "databaseId and backupName are required." }, { status: 400 });
    }

    const template = await updateBackupTemplate({
      backupId,
      databaseId,
      backupName,
      scheduledTime: body.scheduledTime?.trim() || undefined,
      backupType: body.backupType?.trim() || undefined,
      isActive: body.isActive !== false,
      actor: session.user.username
    });

    await insertAuditLog({
      actor: session.user.username,
      action: "backup_template_update",
      status: "success",
      detail: `Updated backup template "${backupName}".`
    });

    return NextResponse.json({ template });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update backup template.";
    if (/ORA-00001|unique/i.test(message)) {
      return NextResponse.json({ message: "A backup with that name already exists for this database." }, { status: 409 });
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAppAdmin();
    if (auth.response) return auth.response;
    const session = auth.session!;

    const { id } = await params;
    const backupId = Number(id);
    if (!backupId) {
      return NextResponse.json({ message: "Invalid backup template id." }, { status: 400 });
    }

    const templates = await listBackupTemplates();
    const existing = templates.find((t) => t.backup_id === backupId);
    const name = existing?.backup_name || `ID ${backupId}`;

    await deleteBackupTemplate(backupId);

    await insertAuditLog({
      actor: session.user.username,
      action: "backup_template_delete",
      status: "success",
      detail: `Deleted backup template "${name}".`
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete backup template.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
