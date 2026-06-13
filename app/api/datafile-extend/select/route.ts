import { NextResponse } from "next/server";

import { emitAlertNotificationEvent } from "@/lib/server/alert-events";
import { getAlertNotification, insertAuditLog, updateAlertNotification } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const alertId = String(body.alert_id || "").trim();
  const tablespace = String(body.tablespace || "").trim().toUpperCase();
  const sizeGb = Number(body.size_gb);

  if (!alertId) {
    return NextResponse.json({ message: "alert_id is required." }, { status: 400 });
  }
  if (!tablespace) {
    return NextResponse.json({ message: "tablespace is required." }, { status: 400 });
  }
  if (!Number.isFinite(sizeGb) || sizeGb <= 0) {
    return NextResponse.json({ message: "size_gb must be a positive number." }, { status: 400 });
  }

  const alert = await getAlertNotification(alertId);
  if (!alert) {
    return NextResponse.json({ message: `Alert not found: ${alertId}` }, { status: 404 });
  }

  const meta = (alert.metadata || {}) as Record<string, unknown>;
  const resumeUrl = typeof meta.resume_url === "string" ? meta.resume_url.trim() : "";

  if (!resumeUrl) {
    return NextResponse.json(
      { message: "No resume URL found in this alert. The n8n Wait Node may not have stored it." },
      { status: 400 }
    );
  }

  // Resume the n8n Wait Node.
  // The Wait node in the user's workflow is configured for HTTP Method: GET,
  // so we append the selection as query parameters — n8n makes them available
  // as $json.query.tablespace and $json.query.size_gb in the next node.
  let resolvedResumeUrl: string;
  try {
    const urlObj = new URL(resumeUrl);
    urlObj.searchParams.set("tablespace", tablespace);
    urlObj.searchParams.set("size_gb", String(sizeGb));
    urlObj.searchParams.set("approved_by", session.user.username);
    resolvedResumeUrl = urlObj.toString();
  } catch {
    return NextResponse.json(
      { message: `Invalid resume URL stored in alert: ${resumeUrl}` },
      { status: 400 }
    );
  }

  const resumeResponse = await fetch(resolvedResumeUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!resumeResponse.ok) {
    const text = await resumeResponse.text().catch(() => resumeResponse.statusText);
    return NextResponse.json(
      { message: `n8n resume failed (${resumeResponse.status}): ${text}` },
      { status: 502 }
    );
  }

  // Update the alert to reflect that the DBA has submitted their selection.
  const updatedAlert = await updateAlertNotification({
    id: alertId,
    status: "approved",
    actor: session.user.username,
    message: `Tablespace ${tablespace} selected for extension (${sizeGb} GB) by ${session.user.username}.`,
    metadata: {
      ...meta,
      selected_tablespace: tablespace,
      selected_size_gb: sizeGb,
      selection_submitted_by: session.user.username,
      selection_submitted_at: new Date().toISOString(),
      step: "sql_generation"
    }
  });

  try {
    await insertAuditLog({
      actor: session.user.username,
      action: "datafile_extend",
      db: alert.db,
      status: "approved",
      detail: `Tablespace ${tablespace} selected for +${sizeGb} GB extension on alert ${alertId}.`,
      metadata: { alert_id: alertId, tablespace, size_gb: sizeGb }
    });
  } catch {
    // audit failure is non-fatal
  }

  emitAlertNotificationEvent("updated", updatedAlert);

  return NextResponse.json({ alert: updatedAlert });
}
