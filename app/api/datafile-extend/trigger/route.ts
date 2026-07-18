import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { getDatabaseTargetByName, insertAuditLog } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let db = "";
  try {
    const body = (await request.json()) as { db?: string };
    db = String(body.db || "").trim();
  } catch {
    // no-op
  }

  if (!db) {
    return NextResponse.json({ message: "db is required." }, { status: 400 });
  }

  const env = getServerEnv();

  if (!env.webhookUrl) {
    return NextResponse.json(
      { message: "DBA_WEBHOOK_URL is not configured." },
      { status: 503 }
    );
  }

  const dbTarget = await getDatabaseTargetByName(db, {
    role: session.user.role,
    userId: session.userId,
    enforceAccess: true
  });
  if (!dbTarget) return NextResponse.json({ message: "Database is unavailable." }, { status: 404 });
  const payload = {
    action: "datafile_extend",
    db,
    requested_by: session.user.username,
    user_id: session.userId,
    environment: dbTarget?.env_label,
    os: dbTarget?.os,
    db_type: dbTarget?.db_type
  };

  // n8n must respond immediately via "Respond to Webhook" node.
  // Workflow continues async after that; human approval state lives in the app.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const n8nResponse = await fetch(env.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!n8nResponse.ok) {
      const text = await n8nResponse.text().catch(() => n8nResponse.statusText);
      return NextResponse.json(
        { message: `n8n webhook failed (${n8nResponse.status}): ${text}` },
        { status: 502 }
      );
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      const message = err instanceof Error ? err.message : "Failed to reach n8n.";
      return NextResponse.json({ message }, { status: 502 });
    }
    // AbortError = 30 s timeout. n8n may still be running on its side.
    // We proceed optimistically and rely on callback alerts for progress.
  } finally {
    clearTimeout(timeoutId);
  }

  try {
    await insertAuditLog({
      actor: session.user.username,
      action: "datafile_extend",
      db,
      status: "initiated",
      detail: `Datafile extension workflow triggered for ${db} by ${session.user.username}.`
    });
  } catch {
    // audit failure is non-fatal
  }

  return NextResponse.json({ ok: true, triggered_by: session.user.username, db });
}
