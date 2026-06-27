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
  upsertDataPumpJob: (job: DataPumpJob) => void;
  clearCompletedDataPumpJobs: () => void;
  addExpdpTemplate: (template: ExpdpTemplate) => void;
  deleteExpdpTemplate: (id: string) => void;
  addImpdpTemplate: (template: ImpdpTemplate) => void;
  deleteImpdpTemplate: (id: string) => void;
  upsertRmanJob: (job: RmanJob) => void;
  clearCompletedRmanJobs: () => void;
}

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
      dataPumpJobs: [],
      expdpTemplates: [],
      impdpTemplates: [],
      rmanJobs: [],
      triggerTablespaceRefresh: () =>
        set((state) => ({
          tablespaceRefreshTrigger: state.tablespaceRefreshTrigger + 1
      })),
      setUser: (user) => set({ user }),
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
          if (state.notifications.some((n) => n.id === item.id)) return state;
          return { notifications: [{ ...item, read: false }, ...state.notifications].slice(0, 30) };
        }),
      markNotificationRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
        })),
      markAllNotificationsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true }))
        })),
      clearNotifications: () => set({ notifications: [] }),
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
