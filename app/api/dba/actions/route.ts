import { NextResponse } from "next/server";

import { getActionDefinition } from "@/lib/action-catalog";
import { requiresApproval, createApprovalRequest } from "@/lib/server/approval-workflow";
import { normalizeDbaResponse } from "@/lib/server/dba-response-normalizer";
import { isDestructiveSql, sqlDedupSignature } from "@/lib/server/destructive-sql-detector";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { notifyDataPumpJob, type DataPumpCallbackPayload } from "@/lib/server/datapump-events";
import { getServerEnv } from "@/lib/server/env";
import { getDatabaseTargetByName, insertAuditLog, insertRequestHistory, persistRunData, upsertDataPumpJobHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { createMockResponse } from "@/services/mock-data";
import type { DbaAction, DbaRequestPayload, DbaResponse } from "@/types/dba";

interface RequestBody {
  action?: string;
  db?: string;
  params?: Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function POST(request: Request) {
  const requestId = `REQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const startedAt = Date.now();

  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  let payload: DbaRequestPayload | null = null;

  try {
    const body = (await request.json()) as RequestBody;
    const action = (body.action || "").trim() as DbaAction;
    const db = (body.db || "").trim();
    const params = body.params && typeof body.params === "object" ? body.params : {};

    if (!action || !db) {
      return NextResponse.json({ message: "Both action and db are required." }, { status: 400 });
    }

    const definition = getActionDefinition(action);
    if (!definition) {
      return NextResponse.json({ message: `Unsupported action: ${action}` }, { status: 400 });
    }

    const dbTarget = await getDatabaseTargetByName(db, {
      role: session.user.role,
      userId: session.userId,
      enforceAccess: true
    });
    if (!dbTarget) return NextResponse.json({ message: "Database is unavailable." }, { status: 404 });
    payload = {
      action,
      db,
      params,
      requested_by: session.user.username,
      user_id: session.userId,
      environment: dbTarget?.env_label,
      os: dbTarget?.os,
      db_type: dbTarget?.db_type
    };

    // ── Approval gate ──────────────────────────────────────────────────
    // For the `query` action on PROD, the SQL is inspected for destructive
    // content. When destructive, an approval request is created using the
    // existing workflow — the frozen payload (including the original SQL) is
    // replayed verbatim to n8n once an app_admin approves.
    if (await requiresApproval(action, dbTarget.env_label, session.user.role, params)) {
      // For dynamic actions (destructive SQL), provide display name + risk
      // level + dedup signature overrides so the admin UI shows a meaningful
      // label and duplicate submissions are deduped by SQL content.
      let displayNameOverride: string | undefined;
      let riskLevelOverride: "critical" | undefined;
      let dedupSignature: string | undefined;

      if (action === "query") {
        const sqlText = typeof params.sql_query === "string" ? params.sql_query : "";
        const analysis = isDestructiveSql(sqlText);
        displayNameOverride = `Execute Destructive SQL — ${analysis.reasons[0] ?? "destructive operation"}`;
        riskLevelOverride = "critical";
        dedupSignature = sqlDedupSignature(analysis.normalizedSql);
      }

      const { dbaResponse: pendingResponse } = await createApprovalRequest({
        action,
        db,
        payload,
        userId:               session.userId,
        username:             session.user.username,
        environment:           dbTarget.env_label,
        displayNameOverride,
        riskLevelOverride,
        dedupSignature
      });
      const durationMs = Date.now() - startedAt;
      await insertRequestHistory({
        id: requestId,
        action,
        db,
        requestedBy: session.user.username,
        status:      "pending_approval",
        durationMs,
        payload,
        response:    pendingResponse
      });
      return NextResponse.json(pendingResponse);
    }
    // ─────────────────────────────────────────────────────

    // Data Pump start: fire the global bell + write the audit row BEFORE
    // dispatching to n8n. EXPDP/IMPDP can run for hours, so auditing at the
    // completion callback would leave the start event (who/when) unrecorded
    // if the callback never returns. Emitting here guarantees the start
    // event is captured regardless of what happens next.
    const isDataPumpAction = action === "expdp" || action === "impdp";
    const dataPumpJobId = isDataPumpAction
      ? ((params.job_id as string) || requestId)
      : undefined;

    if (isDataPumpAction && dataPumpJobId) {
      // 1) Persist the "running" row immediately so the active-job banner
      //    is visible to every authenticated user via /api/datapump/jobs
      //    polling, even before n8n acknowledges the webhook.
      await upsertDataPumpJobHistory({
        id: dataPumpJobId,
        operation: action,
        db,
        status: "running",
        started_at: new Date(startedAt).toISOString(),
        message: "Operation dispatched to server — waiting for n8n acknowledgement…",
        dump_file: (params.DUMPFILE as string) || (params.dump_file as string) || undefined,
        transfer_status: (params.dump_transfer_required as string) === "yes"
          ? `Will transfer to ${params.transfer_server as string || "DMPSERVER01"}`
          : "No transfer requested",
        requested_by: session.user.username,
        params
      }).catch((err) => {
        console.error("[dba/actions] Failed to persist Data Pump job start row:", err);
      });

      // 2) Audit the start so the audit page shows who/when/what immediately.
      await insertAuditLog({
        actor: session.user.username,
        action,
        db,
        status: "initiated",
        detail: `${action.toUpperCase()} job ${dataPumpJobId} initiated by ${session.user.username} on ${db}.`,
        metadata: { job_id: dataPumpJobId, requested_by: session.user.username, environment: dbTarget.env_label }
      });

      // 3) Push to any dashboard SSE listeners (wildcard subscribers too) so
      //    the running banner updates in real time before the poll fires.
      notifyDataPumpJob({
        job_id: dataPumpJobId,
        status: "running",
        action,
        db,
        message: "Operation dispatched to server — waiting for n8n acknowledgement…"
      });

      // 4) Broadcast a global bell notification so every logged-in user is
      //    informed that the EXPDP/IMPDP just started, exactly like a shift
      //    handover or filesystem alert.
      emitGlobalNotification({
        id: `${dataPumpJobId}-start`,
        type: "generic",
        severity: "warning",
        db,
        title: `${action.toUpperCase()} started`,
        message: `${session.user.username} initiated an ${action.toUpperCase()} job on ${db} at ${new Date(startedAt).toLocaleString()}. Status will update on the n8n callback.`,
        timestamp: new Date().toISOString(),
        targetPath: "/data-pump"
      });
    }

    const env = getServerEnv();
    let result: DbaResponse;

    if (env.mockMode) {
      await sleep(850 + Math.random() * 650);
      result = normalizeDbaResponse(createMockResponse(action, db, Boolean(definition.destructive), params), action);
    } else {
      if (!env.webhookUrl) {
        throw new Error("DBA_WEBHOOK_URL is required when mock mode is disabled.");
      }

      try {
        const response = await fetch(env.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {})
          },
          body: JSON.stringify(payload),
          cache: "no-store"
        });

        if (!response.ok) {
          const message = await parseErrorMessage(response);
          throw new Error(`n8n webhook failed (${response.status}): ${message}`);
        }

        result = normalizeDbaResponse(await response.json(), action);
      } catch (fetchErr) {
        // Data Pump long-running actions (expdp / impdp) can take hours, causing n8n respond node socket timeout.
        // If fetch failed due to socket timeout / aborted connection after starting, n8n is still running in background.
        if (action === "expdp" || action === "impdp") {
          const errMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          const jobIdStr = (params.job_id as string) || requestId;
          result = {
            status: "success",
            request_id: jobIdStr,
            action,
            db_status: "healthy",
            ai_summary: `Data Pump ${action.toUpperCase()} job initiated on server. Running in background (waiting for n8n completion callback).`,
            findings: [],
            recommendations: [],
            raw_data: {
              async: true,
              job_id: jobIdStr,
              status: "running",
              note: errMessage
            },
            raw_output: `Job ${jobIdStr} triggered via n8n webhook. Log will update upon n8n callback.`
          };
        } else {
          throw fetchErr;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    await insertRequestHistory({
      id: requestId,
      action,
      db,
      requestedBy: session.user.username,
      status: result.status,
      durationMs,
      payload,
      response: result
    });
    await persistRunData({
      historyRequestId: requestId,
      externalRequestId: result.request_id,
      requestedBy: session.user.username,
      action,
      db,
      status: result.status,
      aiSummary: result.ai_summary,
      rawOutput: result.raw_output,
      rawData: result.raw_data,
      findings: result.findings,
      recommendations: result.recommendations
    });
    // Data Pump actions are audited through dedicated start + completion
    // audit-log entries (an "initiated" row is written before the webhook
    // dispatch above, and a success/error row is written inside the expdp/
    // impdp branch below for sync completions, plus the n8n callback route
    // also writes a completion row). Skipping the generic "submitted to n8n
    // webhook" audit here keeps the audit page from showing duplicate rows
    // for the same Data Pump job. (The generic audit remains active for
    // every other DBA action.)
    if (action !== "expdp" && action !== "impdp") {
      await insertAuditLog({
        actor: session.user.username,
        action,
        db,
        status: result.status,
        detail: `${action} submitted to n8n webhook for ${db}.`,
        metadata: { request_id: result.request_id, duration_ms: durationMs }
      });
    }

if (action === "expdp" || action === "impdp") {
      const jobIdStr = dataPumpJobId || (params.job_id as string) || requestId;
      const isStillRunning = (result.raw_data as Record<string, unknown>)?.status === "running" || (result.raw_data as Record<string, unknown>)?.async === true;
      const finalStatus = isStillRunning
        ? "running"
        : result.status === "success"
          ? "success"
          : "error";

      // Refresh the row with whatever n8n returned. For long-running jobs
      // (async timeout branch) this leaves status="running"; for immediate
      // failures/successes it stamps the completion timestamp.
      await upsertDataPumpJobHistory({
        id: jobIdStr,
        operation: action,
        db,
        status: finalStatus,
        started_at: new Date(startedAt).toISOString(),
        ...(isStillRunning ? {} : { completed_at: new Date().toISOString() }),
        message: result.ai_summary || (isStillRunning ? "Operation running on server (waiting for n8n callback...)" : "Operation completed"),
        dump_file: (result.raw_data as Record<string, unknown>)?.dump_file as string | undefined,
        transfer_status: (result.raw_data as Record<string, unknown>)?.transfer_status as string | undefined,
        requested_by: session.user.username,
        params
      }).catch((err) => {
        console.error("[dba/actions] Failed to save Data Pump job history:", err);
      });

      // Live push to dashboard SSE listeners. The "start" notification was
      // already emitted above, so only emit the completion bell when the
      // action actually finished here (n8n returned within the socket
      // timeout). Long-running jobs will instead surface the completion bell
      // from /api/datapump/callback once n8n posts the final status.
      const ssePayload: DataPumpCallbackPayload = {
        job_id: jobIdStr,
        status: finalStatus as "running" | "success" | "error" | "completed",
        action,
        db,
        dump_file: (result.raw_data as Record<string, unknown>)?.dump_file as string | undefined,
        transfer_status: (result.raw_data as Record<string, unknown>)?.transfer_status as string | undefined,
        message: result.ai_summary || (isStillRunning ? "Operation running on server (waiting for n8n callback...)" : "Operation completed")
      };
      notifyDataPumpJob(ssePayload);

      if (!isStillRunning) {
        // Audit the completion (success/error) so it appears on the audit
        // page even though the start audit was written earlier.
        await insertAuditLog({
          actor: session.user.username,
          action,
          db,
          status: finalStatus,
          detail: `${action.toUpperCase()} job ${jobIdStr} ${finalStatus === "success" ? "completed successfully" : "failed"} on ${db}.`,
          metadata: { job_id: jobIdStr, duration_ms: Date.now() - startedAt, environment: dbTarget.env_label }
        });

        emitGlobalNotification({
          id: `${jobIdStr}-done`,
          type: "generic",
          severity: finalStatus === "success" ? "info" : "critical",
          db,
          title: `${action.toUpperCase()} ${finalStatus === "success" ? "completed" : "failed"}`,
          message: result.ai_summary || `${action.toUpperCase()} job ${jobIdStr} on ${db} finished with status "${finalStatus}".`,
          timestamp: new Date().toISOString(),
          targetPath: "/data-pump"
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected DBA action failure.";
    const durationMs = Date.now() - startedAt;

    if (payload) {
      await insertRequestHistory({
        id: requestId,
        action: payload.action,
        db: payload.db,
        requestedBy: session.user.username,
        status: "error",
        durationMs,
        payload,
        error: message
      });
      await insertAuditLog({
        actor: session.user.username,
        action: payload.action,
        db: payload.db,
        status: "error",
        detail: message,
        metadata: { duration_ms: durationMs }
      });
    }

    return NextResponse.json({ message }, { status: 500 });
  }
}
