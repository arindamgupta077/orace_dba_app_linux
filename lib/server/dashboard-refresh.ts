import "server-only";

import { getServerEnv } from "@/lib/server/env";
import { normalizeDbaResponse } from "@/lib/server/dba-response-normalizer";
import { emitGlobalNotification } from "@/lib/server/notification-events";
import {
  getDatabaseTargetByName,
  getLatestDashboardHistory,
  insertAuditLog,
  insertRequestHistory,
  persistRunData
} from "@/lib/server/repository";
import { createMockResponse } from "@/services/mock-data";
import type { DbaRequestPayload, DbaResponse } from "@/types/dba";

/** Cooldown duration for automated dashboard refresh on DOWN incidents: 1 hour (60 minutes) */
export const DOWN_INCIDENT_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

/** Default timeout for dashboard refresh webhook call: 5 minutes (300,000 ms) */
export const DEFAULT_DASHBOARD_REFRESH_TIMEOUT_MINUTES = 5;

export function getDashboardRefreshTimeoutMs(): number {
  const rawMinutes = process.env.DASHBOARD_REFRESH_TIMEOUT_MINUTES?.trim();
  if (rawMinutes) {
    const min = Number(rawMinutes);
    if (Number.isFinite(min) && min > 0) return min * 60_000;
  }
  const rawMs = process.env.DASHBOARD_REFRESH_TIMEOUT_MS?.trim();
  if (rawMs) {
    const ms = Number(rawMs);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return DEFAULT_DASHBOARD_REFRESH_TIMEOUT_MINUTES * 60_000;
}

interface DashboardRefreshState {
  downIncidentRefreshTimestamps: Map<string, number>;
}

declare global {
  var __dashboardRefreshState: DashboardRefreshState | undefined;
}

function getRefreshState(): DashboardRefreshState {
  if (!globalThis.__dashboardRefreshState) {
    globalThis.__dashboardRefreshState = {
      downIncidentRefreshTimestamps: new Map()
    };
  }
  return globalThis.__dashboardRefreshState;
}

export interface TriggerDashboardRefreshOptions {
  dbName: string;
  requestedBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TriggerDashboardRefreshResult {
  success: boolean;
  message: string;
  response?: DbaResponse;
  skipped?: boolean;
  cooldownActive?: boolean;
  remainingCooldownMin?: number;
}

/**
 * Checks whether a database is currently within the 1-hour cooldown period
 * for automated DOWN incident dashboard refreshes.
 */
export async function getDownIncidentCooldownInfo(
  dbName: string,
  cooldownMs: number = DOWN_INCIDENT_REFRESH_COOLDOWN_MS
): Promise<{
  inCooldown: boolean;
  lastRefreshTimestamp?: number;
  remainingCooldownMs: number;
  remainingCooldownMin: number;
}> {
  const key = dbName.trim().toUpperCase();
  const state = getRefreshState();
  let lastTimestamp = state.downIncidentRefreshTimestamps.get(key);

  // If not found in memory (e.g. server restarted), check latest dashboard history
  if (!lastTimestamp) {
    try {
      const latest = await getLatestDashboardHistory(dbName);
      if (
        latest &&
        latest.refreshed_by === "automation:monitoring" &&
        latest.refresh_timestamp
      ) {
        const histTime = new Date(latest.refresh_timestamp).getTime();
        if (Number.isFinite(histTime)) {
          lastTimestamp = histTime;
          state.downIncidentRefreshTimestamps.set(key, histTime);
        }
      }
    } catch {
      // Ignore DB query errors for fallback check
    }
  }

  if (!lastTimestamp) {
    return {
      inCooldown: false,
      remainingCooldownMs: 0,
      remainingCooldownMin: 0
    };
  }

  const elapsed = Date.now() - lastTimestamp;
  if (elapsed < cooldownMs) {
    const remainingMs = cooldownMs - elapsed;
    const remainingMin = Math.ceil(remainingMs / 60000);
    return {
      inCooldown: true,
      lastRefreshTimestamp: lastTimestamp,
      remainingCooldownMs: remainingMs,
      remainingCooldownMin: remainingMin
    };
  }

  return {
    inCooldown: false,
    lastRefreshTimestamp: lastTimestamp,
    remainingCooldownMs: 0,
    remainingCooldownMin: 0
  };
}

/**
 * Resets the DOWN incident refresh cooldown for a database
 * (e.g. when database is confirmed UP / incident resolved).
 */
export function resetDownIncidentRefreshCooldown(dbName: string): void {
  const key = dbName.trim().toUpperCase();
  getRefreshState().downIncidentRefreshTimestamps.delete(key);
}

/**
 * Triggers automated dashboard refresh for a database on a DOWN incident,
 * enforcing a 1-hour cooldown so repeating 1-minute DOWN incidents do not
 * continuously re-trigger the dashboard refresh.
 */
export async function triggerDashboardRefreshOnDownIncident(options: {
  dbName: string;
  incidentId: string;
  cooldownMs?: number;
}): Promise<TriggerDashboardRefreshResult> {
  const { dbName, incidentId, cooldownMs = DOWN_INCIDENT_REFRESH_COOLDOWN_MS } = options;
  const cooldownInfo = await getDownIncidentCooldownInfo(dbName, cooldownMs);

  if (cooldownInfo.inCooldown) {
    const msg = `Automated dashboard refresh skipped for ${dbName}: 1-hour cooldown active (${cooldownInfo.remainingCooldownMin}m remaining).`;
    console.log(`[automation:cooldown] ${msg}`);

    return {
      success: true,
      skipped: true,
      cooldownActive: true,
      remainingCooldownMin: cooldownInfo.remainingCooldownMin,
      message: msg
    };
  }

  // Stamp timestamp before running to immediately block concurrent duplicate triggers
  const key = dbName.trim().toUpperCase();
  getRefreshState().downIncidentRefreshTimestamps.set(key, Date.now());

  return triggerDashboardRefresh({
    dbName,
    requestedBy: "automation:monitoring",
    reason: `Automated dashboard refresh triggered by DOWN incident (${incidentId}) in app_db_monitoring_incidents for ${dbName}.`,
    metadata: {
      incident_id: incidentId,
      incident_status: "DOWN",
      trigger: "app_db_monitoring_incidents",
      cooldown_period_min: Math.round(cooldownMs / 60000)
    }
  });
}

/**
 * Executes the "refresh_dashboard" action for a database.
 * Triggers n8n to execute the monitoring branches, write snapshot to dashboard_history,
 * and return the fresh metrics payload. Also handles mock mode and auditing.
 */
export async function triggerDashboardRefresh(
  options: TriggerDashboardRefreshOptions
): Promise<TriggerDashboardRefreshResult> {
  const { dbName, requestedBy = "automation:monitoring", reason, metadata = {} } = options;
  const startedAt = Date.now();
  const requestId = `REQ-REFRESH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const env = getServerEnv();
  const dbTarget = await getDatabaseTargetByName(dbName);

  const payload: DbaRequestPayload = {
    action: "refresh_dashboard",
    db: dbName,
    params: {},
    requested_by: requestedBy,
    environment: dbTarget?.env_label,
    os: dbTarget?.os,
    db_type: dbTarget?.db_type
  };

  if (env.mockMode) {
    console.log(`[automation] Mock refresh_dashboard triggered for ${dbName}`);
    const mockResult = normalizeDbaResponse(
      createMockResponse("refresh_dashboard", dbName, false, {}),
      "refresh_dashboard"
    );

    const durationMs = Date.now() - startedAt;
    await insertRequestHistory({
      id: requestId,
      action: "refresh_dashboard",
      db: dbName,
      requestedBy,
      status: mockResult.status,
      durationMs,
      payload,
      response: mockResult
    }).catch(() => {});

    await persistRunData({
      historyRequestId: requestId,
      externalRequestId: mockResult.request_id,
      requestedBy,
      action: "refresh_dashboard",
      db: dbName,
      status: mockResult.status,
      aiSummary: mockResult.ai_summary,
      rawOutput: mockResult.raw_output,
      rawData: mockResult.raw_data,
      findings: mockResult.findings,
      recommendations: mockResult.recommendations
    }).catch(() => {});

    await insertAuditLog({
      actor: requestedBy,
      action: "refresh_dashboard",
      db: dbName,
      status: "success",
      detail: reason || `Automated dashboard refresh completed (mock mode) for ${dbName}.`,
      metadata: { ...metadata, mock: true, duration_ms: durationMs }
    }).catch(() => {});

    // Broadcast refresh completion to connected clients
    emitGlobalNotification({
      id: `REFRESH-${dbName}-${Date.now()}`,
      type: "refresh_dashboard",
      severity: "info",
      db: dbName,
      title: `Dashboard Refreshed: ${dbName}`,
      message: `Automated dashboard refresh completed for ${dbName}.`,
      timestamp: new Date().toISOString(),
      targetPath: "/"
    });

    return {
      success: true,
      message: `Mock dashboard refresh completed for ${dbName}.`,
      response: mockResult
    };
  }

  if (!env.webhookUrl) {
    const warning = `Skipping refresh_dashboard for ${dbName}: DBA_WEBHOOK_URL not configured.`;
    console.warn(`[automation] ${warning}`);
    return { success: false, message: warning };
  }

  try {
    console.log(`[automation] Firing refresh_dashboard for ${dbName} (${reason || "automated trigger"})`);

    const timeoutMs = getDashboardRefreshTimeoutMs();
    const response = await fetch(env.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs) // 5-minute default timeout
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`n8n webhook returned ${response.status}: ${text}`);
    }

    const json = await response.json();
    const dbaResponse = normalizeDbaResponse(json, "refresh_dashboard");
    const durationMs = Date.now() - startedAt;

    console.log(`[automation] refresh_dashboard completed successfully for ${dbName}`);

    await insertRequestHistory({
      id: requestId,
      action: "refresh_dashboard",
      db: dbName,
      requestedBy,
      status: dbaResponse.status,
      durationMs,
      payload,
      response: dbaResponse
    }).catch(() => {});

    await persistRunData({
      historyRequestId: requestId,
      externalRequestId: dbaResponse.request_id,
      requestedBy,
      action: "refresh_dashboard",
      db: dbName,
      status: dbaResponse.status,
      aiSummary: dbaResponse.ai_summary,
      rawOutput: dbaResponse.raw_output,
      rawData: dbaResponse.raw_data,
      findings: dbaResponse.findings,
      recommendations: dbaResponse.recommendations
    }).catch(() => {});

    await insertAuditLog({
      actor: requestedBy,
      action: "refresh_dashboard",
      db: dbName,
      status: "success",
      detail: reason || `Automated dashboard refresh completed for ${dbName}.`,
      metadata: { ...metadata, duration_ms: durationMs, request_id: requestId }
    }).catch(() => {});

    // Broadcast refresh completion to connected clients
    emitGlobalNotification({
      id: `REFRESH-${dbName}-${Date.now()}`,
      type: "refresh_dashboard",
      severity: "info",
      db: dbName,
      title: `Dashboard Refreshed: ${dbName}`,
      message: `Automated dashboard refresh completed for ${dbName}.`,
      timestamp: new Date().toISOString(),
      targetPath: "/"
    });

    return {
      success: true,
      message: `Dashboard refresh completed for ${dbName}.`,
      response: dbaResponse
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[automation] refresh_dashboard HTTP call ended with: ${message} for ${dbName}`);

    // Fallback: check if n8n managed to insert the dashboard snapshot into Oracle
    try {
      const latest = await getLatestDashboardHistory(dbName);
      if (latest?.refresh_timestamp) {
        const snapshotTime = new Date(latest.refresh_timestamp).getTime();
        if (Number.isFinite(snapshotTime) && snapshotTime >= startedAt - 15_000) {
          console.log(
            `[automation] Confirmed fresh snapshot exists in dashboard_history for ${dbName} despite HTTP error (${message})`
          );
          const durationMs = Date.now() - startedAt;
          await insertAuditLog({
            actor: requestedBy,
            action: "refresh_dashboard",
            db: dbName,
            status: "success",
            detail: reason || `Automated dashboard refresh completed for ${dbName} (snapshot confirmed in DB).`,
            metadata: { ...metadata, note: `HTTP ended with ${message}, snapshot confirmed in DB`, duration_ms: durationMs }
          }).catch(() => {});

          emitGlobalNotification({
            id: `REFRESH-${dbName}-${Date.now()}`,
            type: "refresh_dashboard",
            severity: "info",
            db: dbName,
            title: `Dashboard Refreshed: ${dbName}`,
            message: `Automated dashboard refresh completed for ${dbName}.`,
            timestamp: new Date().toISOString(),
            targetPath: "/"
          });

          return {
            success: true,
            message: `Dashboard refresh completed for ${dbName} (verified via DB snapshot).`
          };
        }
      }
    } catch {
      // Ignore fallback verification errors
    }

    const durationMs = Date.now() - startedAt;
    await insertAuditLog({
      actor: requestedBy,
      action: "refresh_dashboard",
      db: dbName,
      status: "error",
      detail: `Automated dashboard refresh failed for ${dbName}: ${message}`,
      metadata: { ...metadata, error: message, duration_ms: durationMs }
    }).catch(() => {});

    return {
      success: false,
      message
    };
  }
}
