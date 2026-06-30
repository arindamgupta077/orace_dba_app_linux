import "server-only";

import { getServerEnv } from "@/lib/server/env";
import { withOracleConnection } from "@/lib/server/oracle";

export type ShiftWebhookEvent =
  | "dba_login"
  | "dba_logout"
  | "handover_submitted"
  | "handover_acknowledged"
  | "handover_override";

export interface ShiftWebhookPayload {
  action: ShiftWebhookEvent;
  username: string;
  email: string;
  [key: string]: unknown;
}

export interface ShiftWebhookResult {
  ok: boolean;
  status: number;
  error?: string;
}

async function logWebhookDispatch(input: {
  eventType: string;
  payload: unknown;
  statusCode: number | null;
  responseBody: string | null;
  success: boolean;
  errorMsg: string | null;
}): Promise<void> {
  try {
    await withOracleConnection(async (connection) => {
      await connection.execute(
        `INSERT INTO app_webhook_logs (
           event_type, payload, status_code, response_body, success, error_msg
         ) VALUES (
           :eventType, EMPTY_CLOB() || :payload, :statusCode, :responseBody, :success, :errorMsg
         )`,
        {
          eventType: input.eventType,
          payload: JSON.stringify(input.payload),
          statusCode: input.statusCode,
          responseBody: input.responseBody,
          success: input.success ? "Y" : "N",
          errorMsg: input.errorMsg
        },
        { autoCommit: true }
      );
    });
  } catch (logError) {
    // Logging must never throw — the original transaction is already committed.
    console.error("[shift-webhook] Failed to persist webhook log:", logError);
  }
}

async function postOnce(
  url: string,
  secret: string,
  payload: unknown
): Promise<ShiftWebhookResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Webhook-Secret": secret
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    return { ok: response.ok, status: response.status, error: response.ok ? undefined : `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Network error"
    };
  }
}

/**
 * Dispatches a shift event to the n8n admin webhook.
 *
 * This function is designed to be called AFTER the database transaction has
 * been committed. It performs a best-effort POST with one retry (2s backoff)
 * and logs the outcome to app_webhook_logs. It NEVER throws — webhook
 * failures are logged and swallowed so they can never affect the DB state.
 */
export async function dispatchShiftWebhook(
  eventType: ShiftWebhookEvent,
  payload: ShiftWebhookPayload
): Promise<ShiftWebhookResult> {
  const env = getServerEnv();
  const webhookUrl = env.adminWebhookUrl;

  if (!webhookUrl) {
    console.warn(`[shift-webhook] ${eventType} skipped: NEXT_PUBLIC_ADMIN_WEBHOOK_URL is not configured.`);
    await logWebhookDispatch({
      eventType,
      payload,
      statusCode: null,
      responseBody: null,
      success: false,
      errorMsg: "NEXT_PUBLIC_ADMIN_WEBHOOK_URL is not configured"
    });
    return { ok: false, status: 0, error: "Webhook URL not configured" };
  }

  if (!env.adminWebhookSecret) {
    console.warn(`[shift-webhook] ${eventType} skipped: ADMIN_WEBHOOK_SECRET is not configured.`);
    await logWebhookDispatch({
      eventType,
      payload,
      statusCode: null,
      responseBody: null,
      success: false,
      errorMsg: "ADMIN_WEBHOOK_SECRET is not configured"
    });
    return { ok: false, status: 0, error: "Webhook secret not configured" };
  }

  let result = await postOnce(webhookUrl, env.adminWebhookSecret, payload);

  // One retry with 2s backoff on failure.
  if (!result.ok) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await postOnce(webhookUrl, env.adminWebhookSecret, payload);
  }

  await logWebhookDispatch({
    eventType,
    payload,
    statusCode: result.status,
    responseBody: null,
    success: result.ok,
    errorMsg: result.ok ? null : result.error || "Unknown error"
  });

  if (!result.ok) {
    console.error(`[shift-webhook] ${eventType} failed after retry: ${result.error}`);
  }

  return result;
}
