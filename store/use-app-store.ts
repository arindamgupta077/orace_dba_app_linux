"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DATABASES } from "@/lib/constants";
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
      selectedDb: process.env.NEXT_PUBLIC_DEFAULT_DB || DATABASES[0]?.name || "ORCL",
      databases: DATABASES,
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
      setAutoRefreshSeconds: (autoRefreshSeconds) => set({ autoRefreshSeconds }),
      addRequestHistory: (item) =>
        set((state) => ({
          requestHistory: [item, ...state.requestHistory].slice(0, 80)
        })),
      updateRequestHistory: (id, patch) =>
        set((state) => ({
          requestHistory: state.requestHistory.map((item) => (item.id === id ? { ...item, ...patch } : item))
        })),
      addAuditLog: (item) =>
        set((state) => ({
          auditLogs: [item, ...state.auditLogs].slice(0, 120)
        })),
      clearHistory: () => set({ requestHistory: [], auditLogs: [] }),
      canExecute: (action) => {
        const role = get().user?.role || "operator";
        if (role === "dba_admin") return true;
        if (role === "auditor") return !["kill_session", "datafile_extend", "stats_refresh", "take_rman_backup", "recompile_invalid"].includes(action);
        return action !== "datafile_extend";
      },
      addNotification: (item) =>
        set((state) => {
          if (state.notifications.some((n) => n.id === item.id)) return state;
          return { notifications: [{ ...item, read: false }, ...state.notifications].slice(0, 50) };
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
          return { dataPumpJobs: [job, ...state.dataPumpJobs].slice(0, 30) };
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
          return { rmanJobs: [job, ...state.rmanJobs].slice(0, 20) };
        }),
      clearCompletedRmanJobs: () =>
        set((state) => ({
          rmanJobs: state.rmanJobs.filter((j) => j.status === "running")
        }))
    }),
    {
      name: "dba-app-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        selectedDb: state.selectedDb,
        requestHistory: state.requestHistory,
        auditLogs: state.auditLogs,
        autoRefreshSeconds: state.autoRefreshSeconds,
        notifications: state.notifications,
        dataPumpJobs: state.dataPumpJobs,
        expdpTemplates: state.expdpTemplates,
        impdpTemplates: state.impdpTemplates,
        rmanJobs: state.rmanJobs
      })
    }
  )
);
