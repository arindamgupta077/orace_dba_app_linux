/**
 * Dashboard Background Refresh Service
 *
 * Runs the "refresh_dashboard" DBA action at the module level — outside of
 * any React component lifecycle.
 *
 * This ensures that when the user clicks the "Refresh" button on the Dashboard,
 * the network request and n8n monitoring workflow execution continue unabated
 * even when navigating across pages or reloading.
 *
 * Results (metrics snapshot, timestamps, refreshedBy) are saved to session
 * and local storage, and broadcasted via window CustomEvents so any mounted
 * Dashboard component displays the updated metrics immediately.
 */

import { executeDBAAction, fetchDashboardHistory, fetchDataPumpJobsApi } from "@/services/api";
import { normalizeMetrics } from "@/components/dashboard/dashboard-utils";
import { loadSessionData, saveSessionData } from "@/components/general-admin/storage-helpers";
import type { DashboardMetrics, DbaResponse } from "@/types/dba";

interface ActiveRefreshJob {
  db: string;
  startedAt: number;
  promise: Promise<DashboardMetrics | null>;
}

// Module-level in-flight tracking across component mounts/unmounts
const activeRefreshes = new Map<string, ActiveRefreshJob>();

function getRefreshKey(db: string): string {
  return db.trim().toUpperCase();
}

/** Check if a dashboard refresh is currently running for a database. */
export function isDashboardRefreshing(db?: string | null): boolean {
  if (!db) return false;
  const key = getRefreshKey(db);
  if (activeRefreshes.has(key)) return true;

  // Check session storage in case of recent navigation
  const saved = loadSessionData<{ refreshing: boolean; startedAt: number } | null>(
    `dashboard_refreshing_${db}`,
    null
  );
  if (saved?.refreshing && Date.now() - saved.startedAt < 120_000) {
    return activeRefreshes.has(key);
  }
  return false;
}

/** Get cached dashboard metrics from session/local storage. */
export function getCachedDashboardMetrics(db: string): DashboardMetrics | null {
  return loadSessionData<DashboardMetrics | null>(`dashboard_metrics_${db}`, null);
}

/** Get cached dashboard refreshed_at timestamp from storage. */
export function getCachedDashboardRefreshedAt(db: string): string | null {
  return loadSessionData<string | null>(`dashboard_refreshed_at_${db}`, null);
}

/** Get cached dashboard refreshed_by user from storage. */
export function getCachedDashboardRefreshedBy(db: string): string | null {
  return loadSessionData<string | null>(`dashboard_refreshed_by_${db}`, null);
}

/**
 * Trigger the dashboard refresh workflow in the background.
 */
export function triggerDashboardRefresh(
  db: string,
  requestedBy?: string
): Promise<DashboardMetrics | null> {
  if (!db) return Promise.resolve(null);
  const key = getRefreshKey(db);

  const existing = activeRefreshes.get(key);
  if (existing) {
    return existing.promise;
  }

  const startedAt = Date.now();
  saveSessionData(`dashboard_refreshing_${db}`, { refreshing: true, startedAt });

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("dba-dashboard-refresh-start", {
        detail: { db, startedAt }
      })
    );
  }

  const promise = (async () => {
    try {
      // Trigger DataPump background sync alongside refresh
      void fetchDataPumpJobsApi(db, 10).catch(() => {});

      const response: DbaResponse = await executeDBAAction("refresh_dashboard", db, {});
      let freshMetrics: DashboardMetrics | null = null;
      let refreshTimestamp = new Date().toISOString();
      let refreshedByUser: string | null = requestedBy || null;

      if (response && response.raw_data) {
        freshMetrics = normalizeMetrics(response.raw_data);
      }

      // If response raw_data didn't contain normalized metrics, query canonical row from Oracle
      if (!freshMetrics) {
        try {
          const historyRes = await fetchDashboardHistory(db);
          if (historyRes.has_data && historyRes.metrics) {
            freshMetrics = normalizeMetrics(historyRes.metrics) ?? historyRes.metrics;
            refreshTimestamp = historyRes.refresh_timestamp || refreshTimestamp;
            refreshedByUser = historyRes.refreshed_by || refreshedByUser;
          }
        } catch (fetchErr) {
          console.warn("[dashboard-refresh-service] Fallback history fetch error:", fetchErr);
        }
      } else {
        if (freshMetrics.captured_at) {
          refreshTimestamp = freshMetrics.captured_at;
        }
      }

      if (freshMetrics) {
        saveSessionData(`dashboard_metrics_${db}`, freshMetrics);
        saveSessionData(`dashboard_refreshed_at_${db}`, refreshTimestamp);
        saveSessionData(`dashboard_refreshed_by_${db}`, refreshedByUser);
      }

      saveSessionData(`dashboard_refreshing_${db}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("dba-dashboard-refresh-complete", {
            detail: {
              db,
              metrics: freshMetrics,
              refreshedAt: refreshTimestamp,
              refreshedBy: refreshedByUser,
              response
            }
          })
        );
      }

      return freshMetrics;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Dashboard refresh failed.";
      saveSessionData(`dashboard_refreshing_${db}`, null);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("dba-dashboard-refresh-error", {
            detail: { db, error: errorMsg }
          })
        );
      }

      throw err;
    } finally {
      activeRefreshes.delete(key);
    }
  })();

  activeRefreshes.set(key, { db, startedAt, promise });
  return promise;
}
