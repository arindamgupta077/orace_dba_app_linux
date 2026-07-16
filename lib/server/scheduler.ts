import "server-only";

import cron, { type ScheduledTask } from "node-cron";

import { SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES } from "@/lib/security-posture-policy";
import { getServerEnv } from "@/lib/server/env";
import {
  claimOutdatedSecurityPostureNotifications,
  getDatabaseTargetByName,
  getActiveSchedules,
  insertAuditLog,
  markSecurityPostureOutdatedWebhookSent,
  releaseSecurityPostureOutdatedWebhookClaim,
  updateScheduleRunMetadata,
  type DashboardSchedule,
} from "@/lib/server/repository";
import { triggerSecurityPostureOutdatedNotification } from "@/lib/server/security-posture";
import type { DbaRequestPayload } from "@/types/dba";

// ─── State ───────────────────────────────────────────────────────────────────
//
// Store all mutable scheduler state on globalThis so that every module
// instance that Next.js creates (instrumentation context, API-route context,
// HMR reload) shares exactly ONE copy. Without this, the API-route context
// gets an empty `jobs` Map and can never stop the cron tasks registered by
// the instrumentation context.

interface ManagedJob {
  task: ScheduledTask;
  schedule: DashboardSchedule;
}

interface SchedulerGlobal {
  jobs: Map<number, ManagedJob>;
  syncTask: ScheduledTask | null;
  outdatedPostureTask: ScheduledTask | null;
  started: boolean;
}

declare global {
  var __dashboardScheduler: SchedulerGlobal | undefined;
}

function getState(): SchedulerGlobal {
  if (!globalThis.__dashboardScheduler) {
    globalThis.__dashboardScheduler = {
      jobs: new Map(),
      syncTask: null,
      outdatedPostureTask: null,
      started: false,
    };
  }
  return globalThis.__dashboardScheduler;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts an interval in minutes to a cron expression.
 * Examples:
 *   1  min  → "* * * * *"      (every minute)
 *   5  min  → "*\/5 * * * *"
 *   15 min  → "*\/15 * * * *"
 *   60 min  → "0 * * * *"      (every hour, on the hour)
 *   120 min → "0 *\/2 * * *"
 */
function toCronExpression(intervalMin: number): string {
  const m = Math.max(1, Math.round(intervalMin));
  if (m < 60) return `*/${m} * * * *`;
  const h = Math.round(m / 60);
  if (h === 1) return `0 * * * *`;
  return `0 */${h} * * *`;
}

// ─── Core trigger ────────────────────────────────────────────────────────────

async function triggerRefresh(schedule: DashboardSchedule): Promise<void> {
  // Guard: if this closure was created by an old task that was already replaced
  // (e.g. interval changed or schedule deleted), skip silently.
  // This protects against stale closures that survive after task.stop().
  const registered = getState().jobs.get(schedule.id);
  if (!registered || registered.schedule.interval_min !== schedule.interval_min) {
    console.log(
      `[scheduler] Skipping stale trigger for ${schedule.db_name} (id=${schedule.id}) — schedule has changed or been removed`
    );
    return;
  }

  const env = getServerEnv();

  if (!env.webhookUrl) {
    console.warn(
      `[scheduler] Skipping refresh for ${schedule.db_name}: DBA_WEBHOOK_URL not configured.`
    );
    return;
  }

  const dbTarget = await getDatabaseTargetByName(schedule.db_name);

  const payload: DbaRequestPayload = {
    action: "refresh_dashboard",
    db: schedule.db_name,
    params: {},
    requested_by: "scheduler",
    environment: dbTarget?.env_label,
    os: dbTarget?.os,
    db_type: dbTarget?.db_type,
  };

  let status: "success" | "error" = "success";

  try {
    console.log(
      `[scheduler] Firing refresh_dashboard for ${schedule.db_name} (schedule id=${schedule.id}, interval=${schedule.interval_min}m)`
    );

    const response = await fetch(env.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.webhookToken ? { "X-DBA-Token": env.webhookToken } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000), // 2-minute timeout
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`n8n webhook returned ${response.status}: ${text}`);
    }

    console.log(`[scheduler] refresh_dashboard completed for ${schedule.db_name}`);
  } catch (err) {
    status = "error";
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] refresh_dashboard failed for ${schedule.db_name}: ${message}`);

    await insertAuditLog({
      actor: "scheduler",
      action: "refresh_dashboard",
      db: schedule.db_name,
      status: "error",
      detail: `Scheduled refresh failed: ${message}`,
      metadata: { schedule_id: schedule.id, interval_min: schedule.interval_min },
    }).catch(() => {});
  }

  await updateScheduleRunMetadata({
    id: schedule.id,
    status,
    intervalMin: schedule.interval_min,
  }).catch((e) =>
    console.warn(`[scheduler] Failed to update run metadata for schedule ${schedule.id}:`, e)
  );
}

// ─── Schedule management ─────────────────────────────────────────────────────

function registerJob(schedule: DashboardSchedule): void {
  const { jobs } = getState();

  // Stop existing job for this id if it was running with a different interval
  const existing = jobs.get(schedule.id);
  if (existing) {
    existing.task.stop();
    jobs.delete(schedule.id);
  }

  if (!schedule.is_active) return;

  const expr = toCronExpression(schedule.interval_min);
  const task = cron.schedule(expr, () => {
    triggerRefresh(schedule).catch((e) =>
      console.error(`[scheduler] Unhandled error in triggerRefresh:`, e)
    );
  });

  jobs.set(schedule.id, { task, schedule });
  console.log(
    `[scheduler] Registered job for ${schedule.db_name} (id=${schedule.id}) cron="${expr}"`
  );
}

function removeStaleJobs(activeIds: Set<number>): void {
  const { jobs } = getState();
  for (const [id, { task }] of jobs) {
    if (!activeIds.has(id)) {
      task.stop();
      jobs.delete(id);
      console.log(`[scheduler] Removed stale job id=${id}`);
    }
  }
}

/**
 * Load all active schedules from Oracle and sync the in-memory cron jobs.
 * Called on server start and every SYNC_INTERVAL_MIN minutes.
 */
async function syncSchedules(): Promise<void> {
  try {
    const schedules = await getActiveSchedules();
    const activeIds = new Set(schedules.map((s) => s.id));

    removeStaleJobs(activeIds);

    const { jobs } = getState();
    for (const schedule of schedules) {
      const existing = jobs.get(schedule.id);

      // Re-register if not running or interval changed
      if (!existing || existing.schedule.interval_min !== schedule.interval_min) {
        registerJob(schedule);
      }
    }

    console.log(
      schedules.length > 0
        ? `[scheduler] Synced ${schedules.length} active schedule(s): ${schedules.map((s) => `${s.db_name}(${s.interval_min}m)`).join(", ")}`
        : `[scheduler] Synced — no active schedules, all jobs stopped.`
    );
  } catch (err) {
    console.warn(
      "[scheduler] Failed to sync schedules from Oracle:",
      err instanceof Error ? err.message : err
    );
  }
}

async function notifyOutdatedSecurityPostures(): Promise<void> {
  if (!getServerEnv().securityPostureWebhookUrl) return;
  try {
    const notifications = await claimOutdatedSecurityPostureNotifications();
    for (const notification of notifications) {
      try {
        await triggerSecurityPostureOutdatedNotification(notification);
        await markSecurityPostureOutdatedWebhookSent(notification.reportId);
        await insertAuditLog({
          actor: "scheduler",
          action: "posture_outdated",
          db: notification.databaseName,
          status: "success",
          detail: "Sent overdue security-posture notification to n8n.",
          metadata: { report_id: notification.reportId, last_upload_date: notification.lastUploadDate }
        });
      } catch (error) {
        await releaseSecurityPostureOutdatedWebhookClaim(notification.reportId).catch(() => {});
        console.warn(`[scheduler] Failed to notify n8n about overdue security posture for ${notification.databaseName}:`, error);
      }
    }
  } catch (error) {
    console.warn("[scheduler] Failed to check overdue security-posture reports:", error);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const SYNC_INTERVAL_MIN = 1; // reload schedules from DB every minute

/**
 * Start the scheduler. Called once from instrumentation.ts on server boot.
 * Safe to call multiple times (idempotent).
 */
export async function startScheduler(): Promise<void> {
  const state = getState();
  if (state.started) return;
  state.started = true;

  console.log("[scheduler] Starting dashboard refresh scheduler…");

  // Immediate first sync
  await syncSchedules();
  await notifyOutdatedSecurityPostures();

  // Periodic re-sync to pick up schedule changes made while the server is running
  state.syncTask = cron.schedule(`*/${SYNC_INTERVAL_MIN} * * * *`, () => {
    syncSchedules().catch((e) =>
      console.warn("[scheduler] Periodic sync error:", e)
    );
  });

  state.outdatedPostureTask = cron.schedule(
    toCronExpression(SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES),
    () => notifyOutdatedSecurityPostures()
  );

  console.log(
    `[scheduler] Scheduler running. Re-syncs schedules every ${SYNC_INTERVAL_MIN}m; checks overdue security posture every ${SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES}m.`
  );
}

/**
 * Force an immediate re-sync of schedules from Oracle.
 * Call this from API routes after creating, updating, or deleting a schedule.
 */
export async function reloadSchedules(): Promise<void> {
  await syncSchedules();
}

/**
 * Return the IDs of schedules currently being managed.
 * Used by API routes to check scheduler health.
 */
export function getActiveJobIds(): number[] {
  return Array.from(getState().jobs.keys());
}
