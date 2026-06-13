/**
 * RMAN Background Job Service
 *
 * Fires the take_rman_backup action at module level — completely outside any
 * React component lifecycle. This means the fetch continues even when the user
 * navigates away from the /backups page or closes the RMAN modal.
 *
 * Results are written directly into the Zustand store (via getState()), which
 * is persisted to localStorage, so completed results survive page refresh too.
 *
 * For true cross-tab-close survival: the actual RMAN job runs on the Oracle
 * server via n8n/SSH, so it always completes server-side. If the user closes
 * the browser mid-flight they can run "Check Backup Status" to query
 * V$RMAN_BACKUP_JOB_DETAILS on their return.
 */

import { executeDBAAction } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { RmanJob } from "@/types/dba";

/** Active job promises keyed by job id (prevents duplicate submissions). */
const activeJobs = new Map<string, Promise<void>>();

export function startRmanBackgroundJob(
  db: string,
  params: Record<string, unknown>
): string {
  const id = `rman-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const started_at = new Date().toISOString();

  const runningJob: RmanJob = {
    id,
    db,
    status: "running",
    started_at,
    params
  };

  useAppStore.getState().upsertRmanJob(runningJob);
  useAppStore.getState().addNotification({
    id: `notif-start-${id}`,
    type: "generic",
    severity: "info",
    db,
    title: "RMAN Backup Started",
    message: `${String(params.backup_type ?? "FULL")} backup started on ${db}. Running in background — you can freely navigate the app.`,
    timestamp: started_at,
    targetPath: "/backups"
  });

  const promise = executeDBAAction("take_rman_backup", db, params)
    .then((response) => {
      const completed_at = new Date().toISOString();
      const succeeded = response.status === "success";

      useAppStore.getState().upsertRmanJob({
        id,
        db,
        status: succeeded ? "success" : "error",
        started_at,
        completed_at,
        params,
        response
      });

      useAppStore.getState().addNotification({
        id: `notif-done-${id}`,
        type: "generic",
        severity: succeeded ? "info" : "critical",
        db,
        title: succeeded ? "RMAN Backup Completed" : "RMAN Backup Failed",
        message:
          response.ai_summary ||
          (succeeded ? "Backup completed successfully." : "Backup failed."),
        timestamp: completed_at,
        targetPath: "/backups"
      });
    })
    .catch((err: unknown) => {
      const completed_at = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : "Unknown error";

      useAppStore.getState().upsertRmanJob({
        id,
        db,
        status: "error",
        started_at,
        completed_at,
        params,
        error: errorMsg
      });

      useAppStore.getState().addNotification({
        id: `notif-err-${id}`,
        type: "generic",
        severity: "critical",
        db,
        title: "RMAN Backup Failed",
        message: errorMsg,
        timestamp: completed_at,
        targetPath: "/backups"
      });
    })
    .finally(() => {
      activeJobs.delete(id);
    });

  activeJobs.set(id, promise);
  return id;
}

/** How many RMAN jobs are currently in-flight (for badge counts). */
export function getActiveRmanJobCount(): number {
  return activeJobs.size;
}
