"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuditLogItem, DatabaseTarget, DbaAction, NotificationItem, RequestHistoryItem, UserSession, DataPumpJob, ExpdpTemplate, ImpdpTemplate, RmanJob } from "@/types/dba";

interface AppState {
  user?: UserSession;
  selectedDb: string;
  databases: DatabaseTarget[];
  requestHistory: RequestHistoryItem[];
  auditLogs: AuditLogItem[];
  autoRefreshSeconds: number;
  tablespaceRefreshTrigger: number;
  notifications: NotificationItem[];
  /**
   * Persisted list of notification IDs the user has dismissed via the bell
   * "Clear" button. The /api/notifications/stream SSE endpoint replays every
   * alert that is still pending_approval on every (re)connect — which used to
   * resurrect cleared alerts after a page reload. We now remember the
   * dismissed ids so `addNotification` can silently drop replayed items the
   * user has already cleared. New alerts get fresh ids, so they still pop up.
   */
  dismissedNotificationIds: string[];
  dataPumpJobs: DataPumpJob[];
  expdpTemplates: ExpdpTemplate[];
  impdpTemplates: ImpdpTemplate[];
  rmanJobs: RmanJob[];
  setUser: (user?: UserSession) => void;
  setSelectedDb: (db: string) => void;
  setDatabases: (databases: DatabaseTarget[]) => void;
  setAutoRefreshSeconds: (seconds: number) => void;
  addRequestHistory: (item: RequestHistoryItem) => void;
  updateRequestHistory: (id: string, patch: Partial<RequestHistoryItem>) => void;
  addAuditLog: (item: AuditLogItem) => void;
  clearHistory: () => void;
  canExecute: (action: DbaAction) => boolean;
  triggerTablespaceRefresh: () => void;
  addNotification: (item: Omit<NotificationItem, "read">) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  dismissNotification: (id: string) => void;
  /** Forget a single previously-dismissed notification id so it can reappear. */
  undismissNotification: (id: string) => void;
  upsertDataPumpJob: (job: DataPumpJob) => void;
  clearCompletedDataPumpJobs: () => void;
  addExpdpTemplate: (template: ExpdpTemplate) => void;
  deleteExpdpTemplate: (id: string) => void;
  addImpdpTemplate: (template: ImpdpTemplate) => void;
  deleteImpdpTemplate: (id: string) => void;
  upsertRmanJob: (job: RmanJob) => void;
  clearCompletedRmanJobs: () => void;
}

// Maximum number of dismissed-notification ids to persist. Bell
// notifications are deduped by id (the underlying alert id), so capping at
// ~500 keeps the longest realistic session's worth of cleared alerts while
// keeping localStorage small.
const DISMISSED_NOTIFICATION_ID_LIMIT = 500;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: undefined,
      selectedDb: process.env.NEXT_PUBLIC_DEFAULT_DB || "",
      databases: [],
      requestHistory: [],
      auditLogs: [],
      autoRefreshSeconds: 60,
      tablespaceRefreshTrigger: 0,
      notifications: [],
      dismissedNotificationIds: [],
      dataPumpJobs: [],
      expdpTemplates: [],
      impdpTemplates: [],
      rmanJobs: [],
      triggerTablespaceRefresh: () =>
        set((state) => ({
          tablespaceRefreshTrigger: state.tablespaceRefreshTrigger + 1
      })),
      setUser: (user) =>
        set((state) => {
          const notifications =
            user?.role === "dba_admin"
              ? state.notifications.filter(
                  (n) => n.type !== "approval_workflow" && n.title !== "Approval Required"
                )
              : state.notifications;
          return { user, notifications };
        }),
      setSelectedDb: (selectedDb) => set({ selectedDb }),
      setDatabases: (databases) =>
        set((state) => {
          const configuredDefault = process.env.NEXT_PUBLIC_DEFAULT_DB || "";
          const nextDefault =
            databases.find((db) => db.name === configuredDefault)?.name ||
            databases[0]?.name ||
            "";
          const selectedDb = databases.some((db) => db.name === state.selectedDb)
            ? state.selectedDb
            : nextDefault;

          return { databases, selectedDb };
        }),
      setAutoRefreshSeconds: (autoRefreshSeconds) => set({ autoRefreshSeconds }),
      addRequestHistory: (item) =>
        set((state) => ({
          requestHistory: [item, ...state.requestHistory].slice(0, 30)
        })),
      updateRequestHistory: (id, patch) =>
        set((state) => ({
          requestHistory: state.requestHistory.map((item) => (item.id === id ? { ...item, ...patch } : item))
        })),
      addAuditLog: (item) =>
        set((state) => ({
          auditLogs: [item, ...state.auditLogs].slice(0, 60)
        })),
      clearHistory: () => set({ requestHistory: [], auditLogs: [] }),
      canExecute: (action) => {
        const role = get().user?.role || "client";
        if (role === "dba_admin") return true;
        if (role === "auditor") return !["kill_session", "datafile_extend", "stats_refresh", "take_rman_backup", "recompile_invalid"].includes(action);
        return action !== "datafile_extend";
      },
      addNotification: (item) =>
        set((state) => {
          // Hide "approval_workflow" / "Approval Required" notifications for dba_admin users
          if (
            state.user?.role === "dba_admin" &&
            (item.type === "approval_workflow" || item.title === "Approval Required")
          ) {
            return state;
          }
          if (state.dismissedNotificationIds.includes(String(item.id))) {
            return state;
          }
          const existingIndex = state.notifications.findIndex((n) => String(n.id) === String(item.id));
          if (existingIndex >= 0) {
            const updated = [...state.notifications];
            updated[existingIndex] = { ...updated[existingIndex], ...item, read: updated[existingIndex].read };
            return { notifications: updated };
          }
          return { notifications: [{ ...item, read: false }, ...state.notifications].slice(0, 30) };
        }),
      markNotificationRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (String(n.id) === String(id) ? { ...n, read: true } : n))
        })),
      markAllNotificationsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true }))
        })),
      clearNotifications: () =>
        set((state) => {
          // Remember every currently-visible notification id as dismissed so
          // that the next SSE replay (after reload/reconnect) doesn't pull
          // them back. New alerts get fresh ids, so they still surface.
          const ids = state.notifications.map((n) => String(n.id));
          if (!ids.length) return { notifications: [] };
          const merged = [...ids, ...state.dismissedNotificationIds];
          // Keep insertion order while dropping duplicates; cap to limit to
          // avoid unbounded growth over long sessions.
          const seen = new Set<string>();
          const deduped: string[] = [];
          for (const id of merged) {
            if (seen.has(id)) continue;
            seen.add(id);
            deduped.push(id);
          }
          const trimmed = deduped.slice(-DISMISSED_NOTIFICATION_ID_LIMIT);
          return { notifications: [], dismissedNotificationIds: trimmed };
        }),
      dismissNotification: (id) =>
        set((state) => {
          const stringId = String(id);
          if (state.dismissedNotificationIds.includes(stringId)) return {};
          return {
            notifications: state.notifications.filter((n) => String(n.id) !== stringId),
            dismissedNotificationIds: [...state.dismissedNotificationIds, stringId].slice(-DISMISSED_NOTIFICATION_ID_LIMIT)
          };
        }),
      undismissNotification: (id) =>
        set((state) => ({
          dismissedNotificationIds: state.dismissedNotificationIds.filter((existing) => existing !== String(id))
        })),
      upsertDataPumpJob: (job) =>
        set((state) => {
          const existing = state.dataPumpJobs.findIndex((j) => j.id === job.id);
          if (existing >= 0) {
            const updated = [...state.dataPumpJobs];
            updated[existing] = job;
            return { dataPumpJobs: updated };
          }
          return { dataPumpJobs: [job, ...state.dataPumpJobs].slice(0, 15) };
        }),
      clearCompletedDataPumpJobs: () =>
        set((state) => ({
          dataPumpJobs: state.dataPumpJobs.filter((j) => j.status === "running")
        })),
      addExpdpTemplate: (template) =>
        set((state) => ({
          expdpTemplates: [template, ...state.expdpTemplates.filter((t) => t.id !== template.id)]
        })),
      deleteExpdpTemplate: (id) =>
        set((state) => ({ expdpTemplates: state.expdpTemplates.filter((t) => t.id !== id) })),
      addImpdpTemplate: (template) =>
        set((state) => ({
          impdpTemplates: [template, ...state.impdpTemplates.filter((t) => t.id !== template.id)]
        })),
      deleteImpdpTemplate: (id) =>
        set((state) => ({ impdpTemplates: state.impdpTemplates.filter((t) => t.id !== id) })),
      upsertRmanJob: (job) =>
        set((state) => {
          const existing = state.rmanJobs.findIndex((j) => j.id === job.id);
          if (existing >= 0) {
            const updated = [...state.rmanJobs];
            updated[existing] = job;
            return { rmanJobs: updated };
          }
          return { rmanJobs: [job, ...state.rmanJobs].slice(0, 10) };
        }),
      clearCompletedRmanJobs: () =>
        set((state) => ({
          rmanJobs: state.rmanJobs.filter((j) => j.status === "running")
        }))
    }),
    {
      name: "dba-app-store",
      storage: createJSONStorage(() => ({
        getItem: (name: string) => localStorage.getItem(name),
        setItem: (name: string, value: string) => {
          try {
            localStorage.setItem(name, value);
          } catch (err) {
            // Quota exceeded — silently degrade instead of crashing the UI.
            // The truncation in partialize should prevent this, but this is a
            // safety net for edge-case payloads.
            console.warn("[dba-app-store] localStorage write failed, clearing old data:", err);
            try {
              localStorage.removeItem(name);
              localStorage.setItem(name, value);
            } catch {
              // Still failing — nothing we can do; app state lives in memory only.
              console.warn("[dba-app-store] localStorage quota unrecoverable; running in-memory only.");
            }
          }
        },
        removeItem: (name: string) => localStorage.removeItem(name)
      })),
      partialize: (state) => ({
        user: state.user,
        selectedDb: state.selectedDb,
        autoRefreshSeconds: state.autoRefreshSeconds,

        // ── Request History (cap 30) ───────────────────────────
        // Strip raw_data entirely and truncate raw_output to keep
        // each item small. raw_data can contain hundreds of rows
        // (sessions, SQL metrics, tablespaces…) and is the #1
        // cause of quota exhaustion.
        requestHistory: state.requestHistory.slice(0, 30).map((item) => {
          if (!item.response) return item;
          const { raw_output, raw_data: _rd, ...restResp } = item.response;
          return {
            ...item,
            response: {
              ...restResp,
              raw_output: raw_output && raw_output.length > 1500
                ? raw_output.slice(0, 1500) + "\n…[truncated for storage]"
                : raw_output,
              raw_data: {}
            }
          };
        }),

        // ── Audit Logs (cap 60) ────────────────────────────────
        auditLogs: state.auditLogs.slice(0, 60),

        // ── Notifications (cap 30) ─────────────────────────────
        notifications: state.notifications.slice(0, 30),

        // ── Dismissed Notification IDs (cap 500) ──────────────
        // Persist so cleared alerts don't get pulled back in by the next SSE
        // replay after a page reload (see addNotification guard above).
        dismissedNotificationIds: state.dismissedNotificationIds.slice(-DISMISSED_NOTIFICATION_ID_LIMIT),

        // ── Data Pump Jobs (cap 15, strip params) ──────────────
        dataPumpJobs: state.dataPumpJobs.slice(0, 15).map(({ params: _p, ...rest }) => ({
          ...rest,
          params: {}
        })),

        // ── RMAN Jobs (cap 10, strip response + params) ────────
        rmanJobs: state.rmanJobs.slice(0, 10).map(({ response: _r, params: _p, ...rest }) => ({
          ...rest,
          params: {},
          response: undefined
        })),

        // ── Templates (cap 20 each) ────────────────────────────
        expdpTemplates: state.expdpTemplates.slice(0, 20),
        impdpTemplates: state.impdpTemplates.slice(0, 20)
      })
    }
  )
);
