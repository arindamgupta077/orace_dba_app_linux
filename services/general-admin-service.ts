/**
 * General Administration Background Execution Service
 *
 * Runs DBA actions (database control, listener control, SQL query execution)
 * at the module level — completely detached from any React component lifecycle.
 *
 * This ensures that when the user clicks "Start Database", "Stop Database",
 * "Change DB Mode", "Start Listener", or "Run Query", the in-flight network request
 * and n8n webhook execution continue unabated even when navigating across pages.
 *
 * When execution finishes, results are saved to session storage and broadcasted
 * via window CustomEvents so any mounted General Admin component reflects the
 * final result immediately.
 */

import { executeDBAAction, fetchMonitoringIncidentHistory, fetchRebootHistory } from "@/services/api";
import { loadSessionData, saveSessionData } from "@/components/general-admin/storage-helpers";
import { useAppStore } from "@/store/use-app-store";
import type { DbaAction, DbaResponse } from "@/types/dba";

export type AdminActionType = "db-control" | "listener-control" | "query";

export interface GeneralAdminRunState {
  status: "idle" | "loading" | "success" | "error";
  output: string | null;
  timestamp: string | null;
  action?: DbaAction | string | null;
  response?: DbaResponse | null;
}

interface ActiveJob {
  type: AdminActionType;
  action: DbaAction | string;
  db: string;
  startedAt: number;
  promise: Promise<DbaResponse | null>;
}

// Module-level in-flight tracking across component mounts/unmounts
const activeJobs = new Map<string, ActiveJob>();

function getJobKey(type: AdminActionType, db: string): string {
  return `${type}_${db.trim().toUpperCase()}`;
}

export function getActiveAdminAction(type: AdminActionType, db?: string | null): (DbaAction | string) | null {
  if (!db) return null;
  const key = getJobKey(type, db);
  return activeJobs.get(key)?.action ?? null;
}

export function isAdminActionRunning(type: AdminActionType, db?: string | null): boolean {
  if (!db) return false;
  const key = getJobKey(type, db);
  return activeJobs.has(key);
}

/**
 * Execute Database Control action in the background.
 */
export function executeDbControlBackground(
  db: string,
  action: DbaAction,
  params: Record<string, unknown> = {},
  isProd = false
): Promise<DbaResponse | null> {
  const key = getJobKey("db-control", db);
  const existing = activeJobs.get(key);
  if (existing) {
    return existing.promise;
  }

  const storageKey = `general_admin_db_control_runstate_${db}`;
  const startedAt = Date.now();

  const loadingRunState: GeneralAdminRunState = {
    status: "loading",
    output: null,
    timestamp: null,
    action,
    response: null
  };

  saveSessionData(storageKey, loadingRunState);
  saveSessionData(`general_admin_active_loading_${key}`, { action, startedAt });

  if (action === "stop_database" && isProd) {
    useAppStore.getState().updateDatabaseRebootEvent(db, "PRE_SHUTDOWN");
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dba-database-update", {
          detail: { db, event_type: "PRE_SHUTDOWN" }
        })
      );
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("general-admin-runstate-change", {
        detail: { type: "db-control", db, action, runState: loadingRunState }
      })
    );
  }

  const promise = executeDBAAction(action, db, params)
    .then(async (result) => {
      const successRunState: GeneralAdminRunState = {
        status: result.status === "error" ? "error" : "success",
        output: result.raw_output || result.ai_summary || "(no output)",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action,
        response: result
      };

      saveSessionData(storageKey, successRunState);
      saveSessionData(`general_admin_active_loading_${key}`, null);

      if (isProd) {
        try {
          const history = await fetchRebootHistory(db, 1);
          if (history && history.length > 0) {
            useAppStore.getState().updateDatabaseRebootEvent(db, history[0].event_type);
          }
        } catch {
          // ignore
        }
      }

      try {
        const incidents = await fetchMonitoringIncidentHistory(1, db);
        if (incidents && incidents.length > 0) {
          useAppStore.getState().updateDatabaseIncidentStatus(db, incidents[0].status);
        }
      } catch {
        // ignore
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("general-admin-runstate-change", {
            detail: { type: "db-control", db, action, runState: successRunState }
          })
        );

        if (action === "start_database" && result.status !== "error") {
          window.dispatchEvent(
            new CustomEvent("dba-auto-check-monitoring-incident", {
              detail: { db }
            })
          );
        }
      }

      return result;
    })
    .catch((err: unknown) => {
      const errRunState: GeneralAdminRunState = {
        status: "error",
        output: err instanceof Error ? err.message : "Unknown error occurred.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action,
        response: null
      };

      saveSessionData(storageKey, errRunState);
      saveSessionData(`general_admin_active_loading_${key}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("general-admin-runstate-change", {
            detail: { type: "db-control", db, action, runState: errRunState }
          })
        );
      }

      return null;
    })
    .finally(() => {
      activeJobs.delete(key);
    });

  activeJobs.set(key, { type: "db-control", action, db, startedAt, promise });
  return promise;
}

/**
 * Execute Listener Control action in the background.
 */
export function executeListenerControlBackground(
  db: string,
  action: DbaAction,
  params: Record<string, unknown> = {}
): Promise<DbaResponse | null> {
  const key = getJobKey("listener-control", db);
  const existing = activeJobs.get(key);
  if (existing) {
    return existing.promise;
  }

  const storageKey = `general_admin_listener_control_runstate_${db}`;
  const startedAt = Date.now();

  const loadingRunState: GeneralAdminRunState = {
    status: "loading",
    output: null,
    timestamp: null,
    action,
    response: null
  };

  saveSessionData(storageKey, loadingRunState);
  saveSessionData(`general_admin_active_loading_${key}`, { action, startedAt });

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("general-admin-runstate-change", {
        detail: { type: "listener-control", db, action, runState: loadingRunState }
      })
    );
  }

  const promise = executeDBAAction(action, db, params)
    .then((result) => {
      const successRunState: GeneralAdminRunState = {
        status: result.status === "error" ? "error" : "success",
        output: result.raw_output || result.ai_summary || "(no output)",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action,
        response: result
      };

      saveSessionData(storageKey, successRunState);
      saveSessionData(`general_admin_active_loading_${key}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("general-admin-runstate-change", {
            detail: { type: "listener-control", db, action, runState: successRunState }
          })
        );
      }

      return result;
    })
    .catch((err: unknown) => {
      const errRunState: GeneralAdminRunState = {
        status: "error",
        output: err instanceof Error ? err.message : "Unknown error occurred.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action,
        response: null
      };

      saveSessionData(storageKey, errRunState);
      saveSessionData(`general_admin_active_loading_${key}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("general-admin-runstate-change", {
            detail: { type: "listener-control", db, action, runState: errRunState }
          })
        );
      }

      return null;
    })
    .finally(() => {
      activeJobs.delete(key);
    });

  activeJobs.set(key, { type: "listener-control", action, db, startedAt, promise });
  return promise;
}

/**
 * Execute SQL Query in the background.
 */
export function executeQueryBackground(
  db: string,
  query: string
): Promise<DbaResponse | null> {
  const key = getJobKey("query", db);
  const existing = activeJobs.get(key);
  if (existing) {
    return existing.promise;
  }

  const storageKey = `general_admin_query_runstate_${db}`;
  const startedAt = Date.now();

  const loadingRunState: GeneralAdminRunState = {
    status: "loading",
    output: null,
    timestamp: null,
    action: "query",
    response: null
  };

  saveSessionData(storageKey, loadingRunState);
  saveSessionData(`general_admin_active_loading_${key}`, { action: "query", startedAt });

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("general-admin-runstate-change", {
        detail: { type: "query", db, action: "query", runState: loadingRunState }
      })
    );
  }

  const promise = executeDBAAction("query", db, { sql_query: query.trim() })
    .then((result) => {
      const successRunState: GeneralAdminRunState = {
        status: result.status === "error" ? "error" : "success",
        output: result.raw_output || result.ai_summary || "(no output)",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action: "query",
        response: result
      };

      saveSessionData(storageKey, successRunState);
      saveSessionData(`general_admin_active_loading_${key}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("general-admin-runstate-change", {
            detail: { type: "query", db, action: "query", runState: successRunState }
          })
        );
      }

      return result;
    })
    .catch((err: unknown) => {
      const errRunState: GeneralAdminRunState = {
        status: "error",
        output: err instanceof Error ? err.message : "Unknown error occurred.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action: "query",
        response: null
      };

      saveSessionData(storageKey, errRunState);
      saveSessionData(`general_admin_active_loading_${key}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("general-admin-runstate-change", {
            detail: { type: "query", db, action: "query", runState: errRunState }
          })
        );
      }

      return null;
    })
    .finally(() => {
      activeJobs.delete(key);
    });

  activeJobs.set(key, { type: "query", action: "query", db, startedAt, promise });
  return promise;
}
