import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  notifyDataPumpJob,
  type DataPumpCallbackPayload
} from "@/lib/server/datapump-events";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { insertAuditLog, upsertDataPumpJobHistory } from "@/lib/server/repository";

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // n8n sometimes delivers the callback as a single object and sometimes as
  // an array of objects. Normalize both forms so completion records are never
  // dropped silently.
  const payloads: DataPumpCallbackPayload[] = Array.isArray(parsed)
    ? (parsed as DataPumpCallbackPayload[])
    : [parsed as DataPumpCallbackPayload];

  if (payloads.length === 0 || !payloads[0]?.job_id) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  for (const body of payloads) {
    if (!body?.job_id) continue;

    try {
      await upsertDataPumpJobHistory({
        id: body.job_id,
        operation: body.action || "expdp",
        db: body.db || "DEFAULT",
        // Preserve the original STARTED_AT when the row already exists; only
        // stamp "now" when we are inserting a brand-new record from the
        // callback (which happens if the start-time persistence was lost).
        started_at: new Date().toISOString(),
        completed_at: body.status !== "running" ? new Date().toISOString() : undefined,
        status: body.status,
        dump_file: body.dump_file,
        transfer_status: body.transfer_status,
        message: body.message,
        params: {}
      });
    } catch (err) {
      console.error("[datapump/callback] Failed to update DATAPUMP_JOB_HISTORY table:", err);
    }

// Audit the completion so the audit page records the final outcome.
    // The start audit was already written by /api/dba/actions when the
    // user fired the EXPDP/IMPDP job; this completes the lifecycle.
    const isSuccess = body.status === "success" || body.status === "completed";
    try {
      await insertAuditLog({
        actor: "n8n",
        action: body.action || "expdp",
        db: body.db,
        status: isSuccess ? "success" : "error",
        detail: `${(body.action || "expdp").toUpperCase()} job ${body.job_id} ${isSuccess ? "completed successfully" : "failed"} on ${body.db || "the target database"}. ${body.message || ""}`.trim(),
        metadata: {
          job_id: body.job_id,
          dump_file: body.dump_file,
          transfer_status: body.transfer_status,
          source: "n8n-callback"
        }
      });
    } catch (err) {
      console.error("[datapump/callback] Failed to insert audit log:", err);
    }

    // Push the live update to any dashboard SSE listeners (specific job_id
    // and wildcard subscribers - so the Active Jobs banner updates in real
    // time for every logged-in user, not just the operator who started it).
    notifyDataPumpJob(body);

    // Broadcast a global bell notification so every authenticated user is
    // informed when a Data Pump export/import completes (or fails).
    const operationLabel = (body.action || "expdp").toUpperCase();
    const shortDb = body.db || "unknown DB";
    emitGlobalNotification({
      id: `${body.job_id}-done`,
      type: "generic",
      severity: isSuccess ? "info" : "critical",
      db: shortDb,
      title: `${operationLabel} ${isSuccess ? "completed" : "failed"}`,
      message:
        body.message ||
        (isSuccess
          ? `${operationLabel} job finished successfully on ${shortDb}.`
          : `${operationLabel} job failed on ${shortDb}. Check the log for details.`),
      timestamp: new Date().toISOString(),
      targetPath: "/data-pump"
    });
  }

  return NextResponse.json({ ok: true, jobs: payloads.map((p) => p.job_id) });
}