import "server-only";

import { getActionDefinition } from "@/lib/action-catalog";
import {
  findPendingApprovalRequest,
  getApprovalWebhookPayload,
  getProtectedAction,
  insertApprovalRequest,
  updateApprovalDecision,
  updateApprovalExecution,
  insertAuditLog,
  insertRequestHistory,
  persistRunData
} from "@/lib/server/repository";
import { getServerEnv } from "@/lib/server/env";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import { normalizeDbaResponse } from "@/lib/server/dba-response-normalizer";
import { isDestructiveSql } from "@/lib/server/destructive-sql-detector";
import type {
  ApprovalRequest,
  ApprovalRiskLevel,
  DbaAction,
  DbaRequestPayload,
  DbaResponse,
  DbEnvironment
} from "@/types/dba";

/** Protected environments — only these require approval */
const PROTECTED_ENVIRONMENTS = new Set(["PROD", "DR"]);

/**
 * Returns true when the given action + environment combination
 * requires an approval request before the webhook may be sent.
 *
 * For static protected actions (drop_user, drop_profile, etc.) the decision
 * is driven by the `app_protected_actions` registry.
 *
 * For the dynamic `query` action, the `params` object is inspected: on PROD,
 * the SQL text is run through the destructive-SQL detector. Only destructive
 * statements are gated — safe SELECTs pass through immediately.
 *
 * `app_admin` always bypasses approval.
 */
export async function requiresApproval(
  action: string,
  environment: string,
  userRole?: string,
  params?: Record<string, unknown>
): Promise<boolean> {
  if (userRole === "app_admin") return false;
  if (!PROTECTED_ENVIRONMENTS.has(environment)) return false;

  // Static registry-based check for known destructive DBA operations.
  if (await getProtectedAction(action)) return true;

  // Dynamic check: destructive SQL on the Execute Query panel.
  if (action === "query") {
    const sql = typeof params?.sql_query === "string" ? params.sql_query : "";
    if (!sql.trim()) return false;
    return isDestructiveSql(sql).destructive;
  }

  return false;
}

export interface CreateApprovalInput {
  action: string;
  db: string;
  payload: DbaRequestPayload;
  userId: number;
  username: string;
  environment: string;
  /** Override the display name shown in the Pending Approvals UI. Used by
   *  dynamic actions (e.g. destructive SQL) that need a more specific label
   *  than the action catalog title. */
  displayNameOverride?: string;
  /** Override the risk level frozen on the approval row. */
  riskLevelOverride?: ApprovalRiskLevel;
  /** Fine-grained dedup key for dynamic actions where multiple distinct
   *  requests can exist simultaneously for the same action+db+requester
   *  (e.g. two different destructive SQL statements). When omitted, the
   *  duplicate guard matches on action+db+requester alone. */
  dedupSignature?: string;
}

/**
 * Builds the deterministic DbaResponse that the API route returns to the
 * requesting client whenever an action requires approval (either newly
 * created or an already-pending duplicate request).
 */
function buildPendingApprovalResponse(
  requestId: string,
  input: CreateApprovalInput,
  displayName: string
): DbaResponse {
  return {
    status:          "pending_approval",
    request_id:      requestId,
    action:          input.action as DbaAction,
    db_status:       "unknown",
    ai_summary:      `Action "${displayName}" requires approval from an App Administrator before it can be executed on ${input.environment}. Your request has been submitted and is pending review.`,
    findings:        [],
    recommendations: [],
    raw_data:        {},
    raw_output:      "",
    approval: {
      channel:  "app_admin",
      approver: "App Administrator",
      status:   "waiting",
      steps: [
        { label: "Request submitted", status: "done"    },
        { label: "Admin review",     status: "current" },
        { label: "Webhook dispatched", status: "pending" }
      ]
    }
  };
}

/**
 * Creates an approval request, persisting the frozen webhook payload.
 * Also emits an SSE notification and inserts an audit log entry.
 *
 * Idempotent: if a pending request already exists for the same action / db /
 * requester (e.g. from a double-click or a network retry), that existing
 * request is returned instead of creating a duplicate row.
 *
 * Returns the DbaResponse that the API route should send back to the client.
 */
export async function createApprovalRequest(
  input: CreateApprovalInput
): Promise<{ approvalRequest: ApprovalRequest; dbaResponse: DbaResponse }> {
  // ── Duplicate guard ────────────────────────────────────────────────────
  // A click-storm, a retry after a network drop, or a tab refresh can re-POST
  // the same protected action. Rather than creating N pending rows for one
  // logical request, re-use the existing pending request so the reviewer sees
  // exactly one item in their queue.
  //
  // For dynamic actions (e.g. destructive `query`), `dedupSignature` narrows
  // the match so that different SQL statements each get their own request,
  // while the exact same statement re-submitted is deduped.
  const existing = await findPendingApprovalRequest({
    actionName:       input.action,
    dbName:           input.db,
    requesterUserId:  input.userId,
    paramsSignature:  input.dedupSignature
  });
  if (existing) {
    return {
      approvalRequest: existing,
      dbaResponse:     buildPendingApprovalResponse(existing.request_id, input, existing.display_name)
    };
  }

  // ── Resolve display name + risk level ──────────────────────────────────
  // Caller-provided overrides win (destructive SQL uses a more specific label).
  // Otherwise, the protected-actions registry is the source of truth, with
  // the action catalog as a fallback when the migration hasn't been installed.
  const registry = await getProtectedAction(input.action);
  const definition = getActionDefinition(input.action as DbaAction);
  const displayName =
    input.displayNameOverride ??
    registry?.display_name ??
    definition?.title ??
    input.action;
  const riskLevel: ApprovalRiskLevel =
    input.riskLevelOverride ??
    registry?.risk_level ??
    (definition?.destructive ? "critical" : "high");

  const requestId = `APR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  // Freeze the exact webhook payload — replayed verbatim on approval.
  // The webhook payload is NEVER modified; the dedup signature is only injected
  // into the separate `request_params` column (used for admin UI display + dedup search).
  const webhookPayload = JSON.stringify(input.payload);

  // Human-readable params for the admin UI. For dynamic actions (destructive
  // SQL), embed a hidden `_dedup_sig` so findPendingApprovalRequest can
  // narrow the duplicate search via DBMS_LOB.INSTR without a schema change.
  // The signature is stripped from the UI display (keys starting with `_`).
  const paramsForDisplay: Record<string, unknown> = { ...(input.payload.params ?? {}) };
  if (input.dedupSignature) {
    paramsForDisplay._dedup_sig = input.dedupSignature;
  }
  const requestParams = Object.keys(paramsForDisplay).length > 0
    ? JSON.stringify(paramsForDisplay)
    : undefined;

  const approvalRequest = await insertApprovalRequest({
    requestId,
    actionName:        input.action,
    displayName,
    dbName:            input.db,
    environment:       input.environment,
    requesterUserId:   input.userId,
    requesterUsername: input.username,
    riskLevel,
    webhookPayload,
    requestParams
  });

  // Audit log
  await insertAuditLog({
    actor:  input.username,
    action: "approval_workflow",
    db:     input.db,
    status: "pending_approval",
    detail: `Approval requested for "${displayName}" on ${input.db} (${input.environment})`,
    metadata: { request_id: requestId, action: input.action }
  });

  // Broadcast SSE notification so app_admin users see the bell alert
  emitGlobalNotification({
    id:         requestId,
    type:       "approval_workflow",
    severity:   "warning",
    db:         input.db,
    title:      "Approval Required",
    message:    `${input.username} requested "${displayName}" on ${input.db} (${input.environment})`,
    timestamp:  new Date().toISOString(),
    targetPath: "/admin-panel/pending-approvals"
  });

  return {
    approvalRequest,
    dbaResponse: buildPendingApprovalResponse(requestId, input, displayName)
  };
}

export interface DecideApprovalInput {
  requestId: string;
  decision: "approved" | "rejected";
  reviewerUserId: number;
  reviewerUsername: string;
  comment?: string;
}

/** Thrown when a PATCH lands on a request that has already been approved /
 *  rejected / cancelled (concurrent reviewer, stale retry, double-click).
 *  The API route maps this to HTTP 409 Conflict. */
export class ApprovalAlreadyProcessedError extends Error {
  constructor(public requestId: string) {
    super(`Approval request ${requestId} has already been processed and is no longer pending.`);
    this.name = "ApprovalAlreadyProcessedError";
  }
}

/**
 * Approve or reject a pending approval request.
 *
 * Idempotency guarantees:
 *   updateApprovalDecision only flips the row when it is still 'pending', and
 *   relies on rowsAffected to bail atomically. This means:
 *     - a duplicate PATCH from a double-click / network retry is rejected,
 *     - two reviewers acting concurrently: only one wins (rowsAffected = 1),
 *       the other gets null here and we throw `ALREADY_PROCESSED`.
 *   Only the winner proceeds to dispatch the webhook, so it is never sent twice.
 *
 * On approval:
 *   1. Marks the request approved in the DB
 *   2. Replays the frozen webhook payload to n8n
 *   3. Records the execution result
 *   4. Inserts an audit log entry
 *
 * On rejection:
 *   1. Marks the request rejected
 *   2. Inserts an audit log entry
 */
export async function decideApprovalRequest(
  input: DecideApprovalInput
): Promise<{ request: ApprovalRequest; dbaResponse?: DbaResponse }> {
  // Persist the decision (atomic conditional-update — see rowsAffected guard).
  const updated = await updateApprovalDecision({
    requestId:        input.requestId,
    decision:         input.decision,
    reviewerUserId:   input.reviewerUserId,
    reviewerUsername: input.reviewerUsername,
    comment:          input.comment
  });

  if (!updated) {
    throw new ApprovalAlreadyProcessedError(input.requestId);
  }

  // Audit log for the decision
  await insertAuditLog({
    actor:  input.reviewerUsername,
    action: "approval_workflow",
    db:     updated.db_name,
    status: input.decision,
    detail: `${input.decision === "approved" ? "Approved" : "Rejected"} request for "${updated.display_name}" on ${updated.db_name}`,
    metadata: {
      request_id: input.requestId,
      comment:    input.comment
    }
  });

  // Broadcast real-time SSE notification so dba_admin navbar button updates immediately
  emitGlobalNotification({
    id:         `UPD-${updated.request_id}-${Date.now()}`,
    type:       "approval_workflow",
    severity:   input.decision === "approved" ? "info" : "error",
    db:         updated.db_name,
    title:      `Approval ${input.decision === "approved" ? "Approved" : "Rejected"}`,
    message:    `Request for "${updated.display_name}" on ${updated.db_name} was ${input.decision} by ${input.reviewerUsername}.`,
    timestamp:  new Date().toISOString(),
    targetPath: "/dba-console"
  });

  let dbaResponse: DbaResponse | undefined;

  // If approved — replay the frozen payload to n8n and wait for execution response
  if (input.decision === "approved") {
    dbaResponse = await dispatchApprovedWebhook(updated, input.reviewerUsername);
  }

  return { request: updated, dbaResponse };
}

async function dispatchApprovedWebhook(
  request: ApprovalRequest,
  actorUsername: string
): Promise<DbaResponse> {
  const env = getServerEnv();

  // Record "executing" state
  await updateApprovalExecution({
    requestId:       request.request_id,
    executionStatus: "executing",
    actorUsername
  });

  try {
    const rawPayloadStr = await getApprovalWebhookPayload(request.request_id);
    if (!rawPayloadStr) {
      throw new Error(`Webhook payload not found for request ${request.request_id}`);
    }

    let parsedPayload: DbaRequestPayload;
    try {
      parsedPayload = JSON.parse(rawPayloadStr);
    } catch {
      parsedPayload = {
        action:       request.action_name as DbaAction,
        db:           request.db_name,
        params:       {},
        requested_by: request.requester_username,
        user_id:      request.requester_user_id,
        environment:  request.environment as DbEnvironment
      };
    }

    let responseBody: unknown;

    if (env.mockMode) {
      await new Promise((r) => setTimeout(r, 500));
      responseBody = { status: "success", ai_summary: `[Mock] Executed "${request.display_name}" on ${request.db_name}.`, raw_output: "Mock execution successful." };
    } else {
      if (!env.webhookUrl) {
        throw new Error("DBA_WEBHOOK_URL is not configured.");
      }

      const response = await fetch(env.webhookUrl, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {})
        },
        body:  rawPayloadStr,
        cache: "no-store"
      });

      try { responseBody = await response.json(); } catch { responseBody = { status: response.statusText }; }

      if (!response.ok) {
        throw new Error(`n8n webhook failed (${response.status}): ${JSON.stringify(responseBody)}`);
      }
    }

    const dbaResponse = normalizeDbaResponse(responseBody, request.action_name as DbaAction);

    await updateApprovalExecution({
      requestId:       request.request_id,
      executionStatus: "success",
      actorUsername,
      response:        dbaResponse
    });

    const runId = `REQ-APP-${Date.now()}`;
    await insertRequestHistory({
      id:          runId,
      action:      request.action_name as DbaAction,
      db:          request.db_name,
      requestedBy: request.requester_username,
      status:      dbaResponse.status,
      durationMs:  0,
      payload:     parsedPayload,
      response:    dbaResponse
    });

    await persistRunData({
      historyRequestId:  runId,
      externalRequestId: dbaResponse.request_id,
      requestedBy:       request.requester_username,
      action:            request.action_name as DbaAction,
      db:                request.db_name,
      status:            dbaResponse.status,
      aiSummary:         dbaResponse.ai_summary,
      rawOutput:         dbaResponse.raw_output,
      rawData:           dbaResponse.raw_data,
      findings:          dbaResponse.findings,
      recommendations:   dbaResponse.recommendations
    });

    await insertAuditLog({
      actor:  actorUsername,
      action: "approval_workflow",
      db:     request.db_name,
      status: "completed",
      detail: `Approved "${request.display_name}" on ${request.db_name}: ${dbaResponse.ai_summary || dbaResponse.raw_output || "Executed successfully."}`,
      metadata: { request_id: request.request_id, dba_response: dbaResponse }
    });

    emitGlobalNotification({
      id:         `EXEC-${request.request_id}-${Date.now()}`,
      type:       "approval_workflow",
      severity:   "info",
      db:         request.db_name,
      title:      `Execution Complete: ${request.display_name}`,
      message:    `Approved action "${request.display_name}" on ${request.db_name} executed successfully.`,
      timestamp:  new Date().toISOString(),
      targetPath: "/dba-console"
    });

    return dbaResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    await updateApprovalExecution({
      requestId:       request.request_id,
      executionStatus: "failed",
      actorUsername,
      response:        { error: message }
    });

    await insertAuditLog({
      actor:  actorUsername,
      action: "approval_workflow",
      db:     request.db_name,
      status: "error",
      detail: `Webhook execution failed for "${request.display_name}" on ${request.db_name}: ${message}`,
      metadata: { request_id: request.request_id }
    });

    emitGlobalNotification({
      id:         `ERR-${request.request_id}-${Date.now()}`,
      type:       "approval_workflow",
      severity:   "error",
      db:         request.db_name,
      title:      `Execution Failed: ${request.display_name}`,
      message:    `Approved action "${request.display_name}" on ${request.db_name} failed: ${message}`,
      timestamp:  new Date().toISOString(),
      targetPath: "/dba-console"
    });

    throw error;
  }
}
