import { NextResponse } from "next/server";

import { getActionDefinition } from "@/lib/action-catalog";
import { requiresApproval, createApprovalRequest } from "@/lib/server/approval-workflow";
import { normalizeDbaResponse } from "@/lib/server/dba-response-normalizer";
import { isDestructiveSql, sqlDedupSignature } from "@/lib/server/destructive-sql-detector";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { notifyDataPumpJob, type DataPumpCallbackPayload } from "@/lib/server/datapump-events";
import { getServerEnv } from "@/lib/server/env";
import { getDatabaseTargetByName, getDashboardHistoryTrends, getPerformanceTrendDaysConfig, insertAlertNotification, insertAuditLog, insertRebootHistory, insertRequestHistory, persistRunData, upsertDataPumpJobHistory, upsertRmanJobHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { normalizeMetrics, safeNum } from "@/components/dashboard/dashboard-utils";
import { createMockResponse } from "@/services/mock-data";
import type { DbaAction, DbaRequestPayload, DbaResponse, RebootEventType, RmanJobStatus } from "@/types/dba";

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

function buildActionDedupSignature(action: string, params: Record<string, unknown>): string {
  const targetKeys = [
    "username",
    "user",
    "target_user",
    "old_username",
    "new_username",
    "tablespace",
    "tablespace_name",
    "file_name",
    "datafile",
    "profile_name",
    "role_name",
    "job_name",
    "owner",
    "schema",
    "table_name",
    "object_name",
    "sid",
    "serial",
    "sql_id"
  ];

  const sigParts: string[] = [`action=${action}`];

  for (const key of targetKeys) {
    const val = params[key];
    if (val !== undefined && val !== null && val !== "") {
      sigParts.push(`${key}=${String(val).trim().toLowerCase()}`);
    }
  }

  if (sigParts.length === 1 && Object.keys(params).length > 0) {
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      if (key.startsWith("_")) continue;
      const val = params[key];
      if (
        val !== undefined &&
        val !== null &&
        val !== "" &&
        (typeof val === "string" || typeof val === "number" || typeof val === "boolean")
      ) {
        sigParts.push(`${key}=${String(val).trim().toLowerCase()}`);
      }
    }
  }

  return sigParts.join(";");
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
      db_type: dbTarget?.db_type,
      db_version: dbTarget?.db_version
    };

    // ── Production Gate for Listener Start/Stop ───────────────────────
    if ((action === "start_listener" || action === "stop_listener") && dbTarget.env_label === "PROD") {
      return NextResponse.json(
        { message: "Start and Stop Listener operations are disabled for production databases." },
        { status: 403 }
      );
    }

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
      } else {
        dedupSignature = buildActionDedupSignature(action, params);
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
      const dpStartId = `${dataPumpJobId}-start`;
      const dpStartMsg = `${session.user.username} initiated an ${action.toUpperCase()} job on ${db} at ${new Date(startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Status will update on the n8n callback.`;
      try {
        await insertAlertNotification({
          id: dpStartId,
          source: "datapump",
          alertType: action,
          db,
          severity: "warning",
          status: "acknowledged",
          message: dpStartMsg,
          createdBy: session.user.username
        });
      } catch {
        // Ignore duplicate insert error
      }

      emitGlobalNotification({
        id: dpStartId,
        type: action as "expdp" | "impdp",
        severity: "warning",
        db,
        title: `${action.toUpperCase()} started`,
        message: dpStartMsg,
        timestamp: new Date().toISOString(),
        targetPath: "/data-pump",
        dpJobId: dataPumpJobId,
        dpAction: action as "expdp" | "impdp",
        dpStatus: "running"
      });
    }

    const isRmanAction = action === "take_rman_backup";
    const rmanRequestId = isRmanAction
      ? ((params.request_id as string) || (params.job_id as string) || `RMAN-${Date.now()}-${Math.floor(Math.random() * 1000)}`)
      : undefined;

    if (isRmanAction && rmanRequestId) {
      const sessionUser = session?.user?.username;
      const requestedBy = String(params.requested_by || params.requestedBy || sessionUser || "dba");
      params.request_id = rmanRequestId;
      params.requested_by = requestedBy;
      payload.params = { ...params, request_id: rmanRequestId, requested_by: requestedBy };

      await upsertRmanJobHistory({
        id: rmanRequestId,
        request_id: rmanRequestId,
        db,
        status: "running",
        started_at: new Date(startedAt).toISOString(),
        requested_by: requestedBy,
        params
      }).catch((err: unknown) => {
        console.error("[dba/actions] Failed to persist RMAN job start row:", err);
      });
    }

    // ── Pre-action Reboot History for Stop Database on PROD ──────────────────
    // When user clicks "stop database" for a PROD database, first insert a
    // record of column "event_type" ('PRE_SHUTDOWN') into db_reboot_history table.
    // Without updating/inserting this event_type value, do NOT send the webhook request to n8n.
    if (action === "stop_database" && dbTarget.env_label === "PROD") {
      try {
        await insertRebootHistory({
          dbName: db,
          environment: dbTarget.env_label,
          eventType: "PRE_SHUTDOWN",
          requestedBy: session.user.username,
          capturedAt: new Date().toISOString(),
          spfileValue: "",
          auditSysOps: "TRUE",
          auditTrail: "DB, EXTENDED",
          dbNameParam: db,
          isCompliant: true,
          shutdownOption: String(params.shutdown_option || "IMMEDIATE")
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[dba/actions] Failed to insert PRE_SHUTDOWN record into db_reboot_history for ${db}:`,
          errorMsg
        );
        throw new Error(
          `Failed to record PRE_SHUTDOWN event in db_reboot_history: ${errorMsg}. Stop database request was not sent to n8n.`
        );
      }
    }

    // ── Attach Historical Performance Trends for RUN ALL (check_performance) ──
    if (action === "check_performance") {
      if (!params.last_days_performance_trends && !params.historical_trends && !params.last_performance_trends) {
        try {
          const configDays = await getPerformanceTrendDaysConfig().catch(() => 3);
          const hours = configDays * 24;
          const { rows: snapshots } = await getDashboardHistoryTrends(db, hours, 500);
          if (snapshots && snapshots.length > 0) {
            const trendPoints = snapshots.map((s) => {
              const m = normalizeMetrics(s.metrics);
              let maxTbsPct: number | null = null;
              let maxTbsName: string | null = null;
              for (const t of m?.tablespaces ?? []) {
                const pct = safeNum(t.pct_used);
                if (maxTbsPct === null || pct > maxTbsPct) {
                  maxTbsPct = pct;
                  maxTbsName = t.tablespace_name;
                }
              }
              const fra = m?.fra;
              const fraPct = fra && safeNum(fra.fra_size_gb) > 0 ? safeNum(fra.pct_used) : null;
              const os = m?.os_resources;
              const memPct = os?.memory_used_pct != null ? safeNum(os.memory_used_pct) : null;
              return {
                timestamp: s.refresh_timestamp,
                avg_response_time_ms: m?.db_response_time_ms ?? null,
                avg_active_sessions_1h: m?.avg_active_sessions_1hr ?? null,
                peak_active_sessions_1h: m?.peak_active_sessions_1hr ?? null,
                max_tablespace_util_pct: maxTbsPct,
                max_tablespace_name: maxTbsName,
                cpu_utilization_pct: os != null ? safeNum(os.cpu_usage_pct) : null,
                os_memory_utilization_pct: memPct,
                fra_utilization_pct: fraPct
              };
            });

            const respTimes = trendPoints.map((p) => p.avg_response_time_ms).filter((v): v is number => v != null);
            const avgSessions = trendPoints.map((p) => p.avg_active_sessions_1h).filter((v): v is number => v != null);
            const peakSessions = trendPoints.map((p) => p.peak_active_sessions_1h).filter((v): v is number => v != null);
            const cpus = trendPoints.map((p) => p.cpu_utilization_pct).filter((v): v is number => v != null);
            const mems = trendPoints.map((p) => p.os_memory_utilization_pct).filter((v): v is number => v != null);
            const fras = trendPoints.map((p) => p.fra_utilization_pct).filter((v): v is number => v != null);

            let overallMaxTbsPct: number | null = null;
            let overallMaxTbsName: string | null = null;
            for (const p of trendPoints) {
              if (p.max_tablespace_util_pct != null && (overallMaxTbsPct === null || p.max_tablespace_util_pct > overallMaxTbsPct)) {
                overallMaxTbsPct = p.max_tablespace_util_pct;
                overallMaxTbsName = p.max_tablespace_name;
              }
            }

            const calcAvg = (arr: number[]) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null);

            const trendsData = {
              trend_days: configDays,
              avg_response_time_ms: calcAvg(respTimes),
              avg_active_sessions_1h: calcAvg(avgSessions),
              peak_active_sessions_1h: peakSessions.length ? Math.max(...peakSessions) : null,
              max_tablespace_util_pct: overallMaxTbsPct,
              max_tablespace_name: overallMaxTbsName,
              cpu_utilization_pct: calcAvg(cpus),
              os_memory_utilization_pct: calcAvg(mems),
              fra_utilization_pct: calcAvg(fras),
              trend_points: trendPoints
            };

            params.trend_days = configDays;
            params.timeframe = `${configDays}d`;
            params.last_days_performance_trends = trendsData;
          }
        } catch (err) {
          console.warn("[dba/actions] Could not load trends fallback for check_performance:", err);
        }
      }

      // Ensure database inventory metadata is present in params
      params.db_version = dbTarget?.db_version || null;
      params.os = dbTarget?.os || null;
      params.db_type = dbTarget?.db_type || null;
      params.database_inventory = {
        db_version: dbTarget?.db_version || null,
        os: dbTarget?.os || null,
        db_type: dbTarget?.db_type || null
      };
      if (payload) {
        payload.params = { ...params };
      }
    }

    const env = getServerEnv();
    let result: DbaResponse;

    if (env.mockMode) {
      await sleep(850 + Math.random() * 650);
      result = normalizeDbaResponse(createMockResponse(action, db, Boolean(definition.destructive), params), action);
      if (isRmanAction && rmanRequestId) {
        result.request_id = rmanRequestId;
      }
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
        if (isRmanAction && rmanRequestId) {
          result.request_id = result.request_id || rmanRequestId;
        }
      } catch (fetchErr) {
        if (action === "take_rman_backup" && rmanRequestId) {
          const errMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          result = {
            status: "success",
            request_id: rmanRequestId,
            action,
            db_status: "warning",
            ai_summary: `RMAN backup initiated for ${db}. Running in background on Oracle server (waiting for n8n status update).`,
            findings: [],
            recommendations: [],
            raw_data: { async: true, job_id: rmanRequestId, status: "running", note: errMessage },
            raw_output: `RMAN job ${rmanRequestId} dispatched to server via n8n. Backup log will update upon completion.`
          };
        } else if (action === "expdp" || action === "impdp") {
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

    if (isRmanAction && rmanRequestId) {
      const outputText = String(result.raw_output || "");
      const isCompleted =
        outputText.includes("Recovery Manager complete") ||
        outputText.includes("Finished backup") ||
        (result.raw_data as Record<string, unknown>)?.status === "completed";

      const isError = result.status === "error" || outputText.includes("ORA-") || outputText.includes("RMAN-0");

      const finalStatus: RmanJobStatus = isError
        ? "error"
        : isCompleted
          ? "success"
          : "running";

      const isStillRunning = finalStatus === "running";

      if (isStillRunning) {
        result = {
          ...result,
          status: "success",
          ai_summary: result.ai_summary || `RMAN backup ${rmanRequestId} initiated for ${db}. Running in background on Oracle server (waiting for n8n completion callback).`,
          raw_data: {
            ...result.raw_data,
            async: true,
            status: "running",
            request_id: rmanRequestId
          },
          raw_output: result.raw_output || `RMAN job ${rmanRequestId} dispatched to server via n8n. Log will update upon n8n callback.`
        };
      } else {
        result = {
          ...result,
          status: finalStatus === "error" ? "error" : "success",
          request_id: rmanRequestId,
          raw_data: {
            ...result.raw_data,
            async: false,
            status: finalStatus,
            request_id: rmanRequestId
          }
        };
      }

      await upsertRmanJobHistory({
        id: rmanRequestId,
        request_id: result.request_id || rmanRequestId,
        db,
        status: finalStatus,
        started_at: new Date(startedAt).toISOString(),
        completed_at: isStillRunning ? undefined : new Date().toISOString(),
        requested_by: String(params.requested_by || session?.user?.username || "dba"),
        params,
        response: result
      }).catch((err: unknown) => {
        console.error("[dba/actions] Failed to save RMAN job history:", err);
      });
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
    // ── Reboot History: capture audit snapshot for PROD start database
    // n8n returns the raw V$PARAMETER values inside raw_data.audit_snapshot.
    // We extract them here and insert one row into db_reboot_history.
    // Failures are non-fatal — they must never block the DBA response.
    if (action === "start_database" && dbTarget.env_label === "PROD") {
      try {
        const auditSnapshot = (
          result.raw_data as Record<string, unknown>
        )?.audit_snapshot as {
          CAPTURED_AT?: string;
          SPFILE_VALUE?: string;
          AUDIT_SYS_OPS?: string;
          AUDIT_TRAIL?: string;
          DB_NAME?: string;
        } | undefined;

        if (auditSnapshot) {
          const spfileValue = (auditSnapshot.SPFILE_VALUE ?? "").trim();
          const auditSysOps = (auditSnapshot.AUDIT_SYS_OPS ?? "").trim().toUpperCase();
          const auditTrail  = (auditSnapshot.AUDIT_TRAIL   ?? "").trim().toUpperCase().replace(/\s+/g, " ");

          const isCompliant =
            spfileValue === "" &&
            auditSysOps === "TRUE" &&
            ["DB, EXTENDED", "DB_EXTENDED"].includes(auditTrail);

          const failures: string[] = [];
          if (spfileValue !== "")
            failures.push(`spfile="${spfileValue}" — must be blank`);
          if (auditSysOps !== "TRUE")
            failures.push(`audit_sys_operations="${auditSysOps}" — expected TRUE`);
          if (!["DB, EXTENDED", "DB_EXTENDED"].includes(auditTrail))
            failures.push(`audit_trail="${auditTrail}" — expected "DB, EXTENDED"`);

          const eventType: RebootEventType =
            result.status === "error" ? "POST_MOUNT_FAILED" : "POST_MOUNT_COMPLIANT";

          await insertRebootHistory({
            dbName:         db,
            environment:    dbTarget.env_label,
            eventType,
            requestedBy:    session.user.username,
            capturedAt:     auditSnapshot.CAPTURED_AT ?? new Date().toISOString(),
            spfileValue:    spfileValue,
            auditSysOps:    auditSysOps,
            auditTrail:     auditTrail,
            dbNameParam:    (auditSnapshot.DB_NAME ?? "").trim(),
            isCompliant,
            failureReasons: failures.length > 0 ? failures.join("; ") : undefined,
            shutdownOption: undefined
          });
        }
      } catch (rebootHistoryErr) {
        console.error(
          "[dba/actions] Failed to insert reboot history record:",
          rebootHistoryErr instanceof Error ? rebootHistoryErr.message : rebootHistoryErr
        );
      }
    }

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

        const dpDoneId = `${jobIdStr}-done`;
        const dpDoneMsg = result.ai_summary || `${action.toUpperCase()} job ${jobIdStr} on ${db} finished with status "${finalStatus}".`;
        try {
          await insertAlertNotification({
            id: dpDoneId,
            source: "datapump",
            alertType: action,
            db,
            severity: finalStatus === "success" ? "info" : "critical",
            status: finalStatus === "success" ? "completed" : "failed",
            message: dpDoneMsg,
            createdBy: session.user.username
          });
        } catch {
          // Ignore duplicate insert error
        }

        emitGlobalNotification({
          id: dpDoneId,
          type: action as "expdp" | "impdp",
          severity: finalStatus === "success" ? "info" : "critical",
          db,
          title: `${action.toUpperCase()} ${finalStatus === "success" ? "completed" : "failed"}`,
          message: dpDoneMsg,
          timestamp: new Date().toISOString(),
          targetPath: "/data-pump",
          dpJobId: jobIdStr,
          dpAction: action as "expdp" | "impdp",
          dpStatus: finalStatus === "success" ? "success" : "error"
        });
      }
    }

    // ── Database Lifecycle Alert Notifications ──────────────────────────────
    // Generate "Database Alerts" notification for "database start", "database stop",
    // "listener start" and "listener stop" events.
    if (action === "start_database" || action === "stop_database" || action === "start_listener" || action === "stop_listener") {
      const isSuccess = result.status === "success";
      let notifType: "database_start" | "database_stop" | "listener_start" | "listener_stop";
      let notifSeverity: "info" | "warning" | "error" | "critical";
      let notifStatus: "completed" | "failed";
      let notifTitle: string;
      let defaultMsg: string;

      if (action === "start_database") {
        notifType = "database_start";
        notifSeverity = isSuccess ? "info" : "error";
        notifStatus = isSuccess ? "completed" : "failed";
        notifTitle = isSuccess ? `Database Started: ${db}` : `Database Start Failed: ${db}`;
        defaultMsg = isSuccess
          ? `Database ${db} instance was started successfully by ${session.user.username}.`
          : `Failed to start database ${db} instance.`;
      } else if (action === "stop_database") {
        const shutdownOpt = String(params.shutdown_option || "IMMEDIATE");
        notifType = "database_stop";
        notifSeverity = isSuccess ? "warning" : "critical";
        notifStatus = isSuccess ? "completed" : "failed";
        notifTitle = isSuccess ? `Database Stopped: ${db}` : `Database Stop Failed: ${db}`;
        defaultMsg = isSuccess
          ? `Database ${db} instance was shut down (${shutdownOpt}) by ${session.user.username}.`
          : `Failed to shut down database ${db} instance.`;
      } else if (action === "start_listener") {
        notifType = "listener_start";
        notifSeverity = isSuccess ? "info" : "error";
        notifStatus = isSuccess ? "completed" : "failed";
        notifTitle = isSuccess ? `Listener Started: ${db}` : `Listener Start Failed: ${db}`;
        defaultMsg = isSuccess
          ? `Oracle Net Listener for ${db} was started successfully by ${session.user.username}.`
          : `Failed to start Oracle Net Listener for ${db}.`;
      } else {
        notifType = "listener_stop";
        notifSeverity = isSuccess ? "warning" : "error";
        notifStatus = isSuccess ? "completed" : "failed";
        notifTitle = isSuccess ? `Listener Stopped: ${db}` : `Listener Stop Failed: ${db}`;
        defaultMsg = isSuccess
          ? `Oracle Net Listener for ${db} was stopped by ${session.user.username}.`
          : `Failed to stop Oracle Net Listener for ${db}.`;
      }

      const notifId = `${notifType.toUpperCase().replace(/_/g, "-")}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const notifMsg = result.ai_summary || defaultMsg;

      try {
        await insertAlertNotification({
          id: notifId,
          source: "general_admin",
          alertType: notifType,
          db,
          severity: notifSeverity,
          status: notifStatus,
          message: notifMsg,
          createdBy: session.user.username
        });
      } catch (insertNotifErr) {
        console.error("[dba/actions] Failed to insert alert notification:", insertNotifErr);
      }

      emitGlobalNotification({
        id: notifId,
        type: notifType,
        severity: notifSeverity,
        db,
        title: notifTitle,
        message: notifMsg,
        timestamp: new Date().toISOString(),
        targetPath: "/general-admin"
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

      if (
        payload.action === "start_database" ||
        payload.action === "stop_database" ||
        payload.action === "start_listener" ||
        payload.action === "stop_listener"
      ) {
        const act = payload.action;
        const notifType = (
          act === "start_database"
            ? "database_start"
            : act === "stop_database"
            ? "database_stop"
            : act === "start_listener"
            ? "listener_start"
            : "listener_stop"
        ) as "database_start" | "database_stop" | "listener_start" | "listener_stop";
        const notifSeverity = act === "stop_database" ? "critical" : "error";
        const notifTitle =
          act === "start_database"
            ? `Database Start Failed: ${payload.db}`
            : act === "stop_database"
            ? `Database Stop Failed: ${payload.db}`
            : act === "start_listener"
            ? `Listener Start Failed: ${payload.db}`
            : `Listener Stop Failed: ${payload.db}`;
        const notifId = `${notifType.toUpperCase().replace(/_/g, "-")}-ERR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        try {
          await insertAlertNotification({
            id: notifId,
            source: "general_admin",
            alertType: notifType,
            db: payload.db,
            severity: notifSeverity,
            status: "failed",
            message,
            createdBy: session.user.username
          });
        } catch {
          // ignore duplicate / non-fatal
        }

        emitGlobalNotification({
          id: notifId,
          type: notifType,
          severity: notifSeverity,
          db: payload.db,
          title: notifTitle,
          message,
          timestamp: new Date().toISOString(),
          targetPath: "/general-admin"
        });
      }
    }

    return NextResponse.json({ message }, { status: 500 });
  }
}
