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
  const requestId = (params.request_id as string) || `RMAN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const id = requestId;
  const started_at = new Date().toISOString();
  const requested_by =
    (params.requested_by as string) ||
    (params.requestedBy as string) ||
    useAppStore.getState().user?.username ||
    "dba";
  const jobParams = { ...params, request_id: requestId, requested_by };

  const runningJob: RmanJob = {
    id,
    request_id: requestId,
    db,
    status: "running",
    started_at,
    requested_by,
    params: jobParams
  };

  useAppStore.getState().upsertRmanJob(runningJob);
  useAppStore.getState().addNotification({
    id: `notif-start-${id}`,
    type: "generic",
    severity: "info",
    db,
    title: "RMAN Backup Started",
    message: `${String(params.backup_type ?? "FULL")} backup started on ${db}. Running in background — request ID ${requestId}.`,
    timestamp: started_at,
    targetPath: "/backups"
  });

  const promise = executeDBAAction("take_rman_backup", db, jobParams)
    .then((response) => {
      const outputText = String(response.raw_output || "");
      const isCompleted =
        outputText.includes("Recovery Manager complete") ||
        outputText.includes("Finished backup") ||
        (response.raw_data as Record<string, unknown>)?.status === "completed" ||
        ((response.raw_data as Record<string, unknown>)?.async === false && response.status === "success");

      const isStillRunning = !isCompleted;

      if (isStillRunning) {
        useAppStore.getState().upsertRmanJob({
          id,
          request_id: response.request_id || requestId,
          db,
          status: "running",
          started_at,
          params: jobParams,
          response
        });
        return;
      }

      const completed_at = new Date().toISOString();
      const succeeded = response.status === "success" && !outputText.includes("ORA-") && !outputText.includes("RMAN-0");

      useAppStore.getState().upsertRmanJob({
        id,
        request_id: response.request_id || requestId,
        db,
        status: succeeded ? "success" : "error",
        started_at,
        completed_at,
        params: jobParams,
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

/** Check if an RMAN job is currently in-flight in this window session. */
export function isRmanJobActive(id: string): boolean {
  return activeJobs.has(id);
}

/** How many RMAN jobs are currently in-flight (for badge counts). */
export function getActiveRmanJobCount(): number {
  return activeJobs.size;
}
