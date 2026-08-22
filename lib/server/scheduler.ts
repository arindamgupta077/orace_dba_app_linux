import "server-only";

import cron, { type ScheduledTask } from "node-cron";

import { SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES } from "@/lib/security-posture-policy";
import { getServerEnv } from "@/lib/server/env";
import {
  claimOutdatedSecurityPostureNotifications,
  getActiveSchedules,
  getAuditRetentionPolicyConfig,
  getSecurityPosturePolicyConfig,
  insertAuditLog,
  markSecurityPostureOutdatedWebhookSent,
  purgeExpiredAuditLogs,
  releaseSecurityPostureOutdatedWebhookClaim,
  updateScheduleRunMetadata,
  type DashboardSchedule,
} from "@/lib/server/repository";
import { triggerSecurityPostureOutdatedNotification } from "@/lib/server/security-posture";
import { triggerDashboardRefresh } from "@/lib/server/dashboard-refresh";

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
  auditPurgeTask: ScheduledTask | null;
  currentOutdatedCheckIntervalMinutes: number;
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
      auditPurgeTask: null,
      currentOutdatedCheckIntervalMinutes: SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES,
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

  console.log(
    `[scheduler] Firing refresh_dashboard for ${schedule.db_name} (schedule id=${schedule.id}, interval=${schedule.interval_min}m)`
  );

  const result = await triggerDashboardRefresh({
    dbName: schedule.db_name,
    requestedBy: "scheduler",
    reason: `Scheduled refresh for ${schedule.db_name} (interval=${schedule.interval_min}m).`,
    metadata: { schedule_id: schedule.id, interval_min: schedule.interval_min }
  });

  const status = result.success ? "success" : "error";

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
 * Reschedule the overdue security posture check task when policy is updated.
 */
export function rescheduleOutdatedPostureTask(intervalMinutes: number): void {
  const state = getState();
  const normalized = Math.max(1, Math.min(1440, Math.round(intervalMinutes)));
  if (state.outdatedPostureTask) {
    state.outdatedPostureTask.stop();
    state.outdatedPostureTask = null;
  }
  const expr = toCronExpression(normalized);
  state.outdatedPostureTask = cron.schedule(expr, () => {
    notifyOutdatedSecurityPostures().catch((e) =>
      console.warn("[scheduler] Error in notifyOutdatedSecurityPostures:", e)
    );
  });
  state.currentOutdatedCheckIntervalMinutes = normalized;
  console.log(`[scheduler] Overdue security posture check task rescheduled: every ${normalized}m (cron="${expr}")`);
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

    // Check if security posture check interval changed in DB
    try {
      const policy = await getSecurityPosturePolicyConfig();
      const state = getState();
      if (policy.outdatedWebhookCheckIntervalMinutes !== state.currentOutdatedCheckIntervalMinutes) {
        rescheduleOutdatedPostureTask(policy.outdatedWebhookCheckIntervalMinutes);
      }
    } catch {
      // Ignore policy sync check failure
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

async function runAuditLogRetentionCleanup(): Promise<void> {
  try {
    const policy = await getAuditRetentionPolicyConfig();
    if (!policy.autoPurgeEnabled || policy.retentionDays <= 0) return;
    console.log(`[scheduler] Running automated audit log retention purge (older than ${policy.retentionDays} days)...`);
    const result = await purgeExpiredAuditLogs(policy.retentionDays, "scheduler");
    if (result.deletedCount > 0) {
      console.log(`[scheduler] Automated purge completed: removed ${result.deletedCount} expired audit log records.`);
    }
  } catch (error) {
    console.warn("[scheduler] Error during automated audit log retention cleanup:", error);
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

  // Daily automated audit log retention cleanup (runs at 02:30 AM every day)
  state.auditPurgeTask = cron.schedule("30 2 * * *", () => {
    runAuditLogRetentionCleanup().catch((e) =>
      console.warn("[scheduler] Audit retention cleanup error:", e)
    );
  });

  let initialCheckMin = SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES;
  try {
    const policy = await getSecurityPosturePolicyConfig();
    initialCheckMin = policy.outdatedWebhookCheckIntervalMinutes;
  } catch {
    // fallback
  }

  rescheduleOutdatedPostureTask(initialCheckMin);

  console.log(
    `[scheduler] Scheduler running. Re-syncs schedules every ${SYNC_INTERVAL_MIN}m; checks overdue security posture every ${initialCheckMin}m; audit log retention cleanup daily at 02:30.`
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
 * Force an immediate reload of security posture policy schedule.
 */
export async function reloadSecurityPosturePolicy(): Promise<void> {
  const policy = await getSecurityPosturePolicyConfig().catch(() => null);
  if (policy) {
    rescheduleOutdatedPostureTask(policy.outdatedWebhookCheckIntervalMinutes);
  }
}

/**
 * Force an immediate reload and optional cleanup run for audit log retention policy.
 */
export async function reloadAuditRetentionPolicy(): Promise<void> {
  await runAuditLogRetentionCleanup().catch(() => {});
}

/**
 * Return the IDs of schedules currently being managed.
 * Used by API routes to check scheduler health.
 */
export function getActiveJobIds(): number[] {
  return Array.from(getState().jobs.keys());
}

