import { NextResponse } from "next/server";

import { emitGlobalNotification } from "@/lib/server/notification-events";
import { insertAlertNotification, insertAuditLog, upsertRmanJobHistory } from "@/lib/server/repository";
import type { RmanJob, RmanJobStatus } from "@/types/dba";

export const dynamic = "force-dynamic";

interface RmanCallbackPayload {
  request_id?: string;
  id?: string;
  db?: string;
  status?: string;
  ai_summary?: string;
  raw_output?: string;
  message?: string;
  error?: string;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RmanCallbackPayload;
    const requestId = String(payload.request_id || payload.id || "").trim();
    const db = String(payload.db || "DEFAULT").trim().toUpperCase();

    if (!requestId) {
      return NextResponse.json({ message: "request_id is required." }, { status: 400 });
    }

    const rawStatus = String(payload.status || "success").toLowerCase();
    const status: RmanJobStatus =
      rawStatus === "success" || rawStatus === "completed"
        ? "success"
        : rawStatus === "error" || rawStatus === "failed"
          ? "error"
          : "running";

    const aiSummary = payload.ai_summary || payload.message || (status === "success" ? "RMAN backup completed successfully." : "RMAN backup failed.");
    const rawOutput = payload.raw_output || payload.error || "";

    const completedJob: RmanJob = {
      id: requestId,
      request_id: requestId,
      db,
      status,
      started_at: new Date().toISOString(),
      completed_at: status !== "running" ? new Date().toISOString() : undefined,
      params: {},
      response: {
        status: status === "error" ? "error" : "success",
        request_id: requestId,
        action: "take_rman_backup",
        db_status: status === "success" ? "healthy" : "critical",
        ai_summary: aiSummary,
        findings: [],
        recommendations: [],
        raw_data: {},
        raw_output: rawOutput
      },
      error: status === "error" ? rawOutput || aiSummary : undefined
    };

    await upsertRmanJobHistory(completedJob);

    await insertAuditLog({
      actor: "n8n",
      action: "take_rman_backup",
      db,
      status,
      detail: `RMAN backup ${requestId} for ${db} ${status === "success" ? "completed successfully" : "failed"}.`,
      metadata: { request_id: requestId }
    });

    const notifId = `rman-${requestId}-${status}`;
    const notifMsg = aiSummary;
    try {
      await insertAlertNotification({
        id: notifId,
        source: "rman",
        alertType: "generic",
        db,
        severity: status === "success" ? "info" : "critical",
        status: status === "success" ? "completed" : "failed",
        message: notifMsg,
        createdBy: "n8n"
      });
    } catch {
      // Ignore duplicate insert error
    }

    emitGlobalNotification({
      id: notifId,
      type: "generic",
      severity: status === "success" ? "info" : "critical",
      db,
      title: status === "success" ? "RMAN Backup Completed" : "RMAN Backup Failed",
      message: notifMsg,
      timestamp: new Date().toISOString(),
      targetPath: "/backups"
    });

    return NextResponse.json({ ok: true, job: completedJob });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process RMAN callback.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
