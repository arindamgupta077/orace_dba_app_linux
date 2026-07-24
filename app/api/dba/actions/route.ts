import { NextResponse } from "next/server";

import { getActionDefinition } from "@/lib/action-catalog";
import { requiresApproval, createApprovalRequest } from "@/lib/server/approval-workflow";
import { normalizeDbaResponse } from "@/lib/server/dba-response-normalizer";
import { isDestructiveSql, sqlDedupSignature } from "@/lib/server/destructive-sql-detector";
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
    await insertAuditLog({
      actor: session.user.username,
      action,
      db,
      status: result.status,
      detail: `${action} submitted to n8n webhook for ${db}.`,
      metadata: { request_id: result.request_id, duration_ms: durationMs }
    });

    if (action === "expdp" || action === "impdp") {
      const jobIdStr = (params.job_id as string) || requestId;
      const isStillRunning = (result.raw_data as Record<string, unknown>)?.status === "running" || (result.raw_data as Record<string, unknown>)?.async === true;
      await upsertDataPumpJobHistory({
        id: jobIdStr,
        operation: action,
        db,
        status: isStillRunning ? "running" : (result.status === "success" ? "success" : "error"),
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
