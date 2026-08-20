"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuditLogItem, DatabaseTarget, DbaAction, NotificationItem, RequestHistoryItem, UserSession, DataPumpJob, DataPumpJobStatus, DataPumpOperation, ExpdpTemplate, ImpdpTemplate, RmanJob, RmanJobStatus } from "@/types/dba";
import { markAllNotificationsReadApi, markNotificationReadApi } from "@/services/api";

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
  updateDatabaseRebootEvent: (dbName: string, eventType: string) => void;
  updateDatabaseIncidentStatus: (dbName: string, status?: string) => void;
  setAutoRefreshSeconds: (seconds: number) => void;
  addRequestHistory: (item: RequestHistoryItem) => void;
  updateRequestHistory: (id: string, patch: Partial<RequestHistoryItem>) => void;
  addAuditLog: (item: AuditLogItem) => void;
  clearHistory: () => void;
  canExecute: (action: DbaAction) => boolean;
  triggerTablespaceRefresh: () => void;
  addNotification: (item: Omit<NotificationItem, "read"> & { read?: boolean }) => void;
  markNotificationRead: (id: string, skipApi?: boolean) => void;
  markAllNotificationsRead: (category?: "db" | "console", skipApi?: boolean) => void;
  setDataPumpJobs: (jobs: DataPumpJob[]) => void;
  upsertDataPumpJob: (job: DataPumpJob) => void;
  completeDataPumpJobForDb: (db?: string, operation?: DataPumpOperation, status?: DataPumpJobStatus, message?: string) => void;
  clearCompletedDataPumpJobs: (db?: string) => void;
  setExpdpTemplates: (templates: ExpdpTemplate[]) => void;
  addExpdpTemplate: (template: ExpdpTemplate) => void;
  deleteExpdpTemplate: (id: string) => void;
  setImpdpTemplates: (templates: ImpdpTemplate[]) => void;
  addImpdpTemplate: (template: ImpdpTemplate) => void;
  deleteImpdpTemplate: (id: string) => void;
  upsertRmanJob: (job: RmanJob) => void;
  completeRmanJobForDb: (db?: string, status?: RmanJobStatus, message?: string) => void;
  clearCompletedRmanJobs: () => void;
}

// Notifications are 100% database-dependent. Notification items and read statuses
// are loaded from and persisted directly to Oracle database tables via API endpoints
// (/api/notifications/stream, /api/notifications/history, /api/notifications/read).
// LocalStorage is NOT used for notification state.

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
      updateDatabaseRebootEvent: (dbName, eventType) =>
        set((state) => ({
          databases: state.databases.map((db) =>
            db.name.trim().toUpperCase() === dbName.trim().toUpperCase()
              ? { ...db, latest_reboot_event: eventType }
              : db
          )
        })),
      updateDatabaseIncidentStatus: (dbName, status) =>
        set((state) => ({
          databases: state.databases.map((db) =>
            db.name.trim().toUpperCase() === dbName.trim().toUpperCase()
              ? { ...db, incident_status: status }
              : db
          )
        })),
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
        if (role === "auditor") return !["kill_session", "datafile_extend", "stats_refresh", "take_rman_backup", "delete_archivelog", "delete_backup", "recompile_invalid"].includes(action);
        return action !== "datafile_extend";
      },
      addNotification: (item) =>
        set((state) => {
          const existingIndex = state.notifications.findIndex((n) => String(n.id) === String(item.id));

          // If this is a lightweight read-status sync event (empty title and message) and the item
          // isn't in memory, ignore it so we don't create a blank phantom card.
          if (existingIndex < 0 && !item.title && !item.message) {
            return state;
          }

          let updated: NotificationItem[];
          if (existingIndex >= 0) {
            updated = [...state.notifications];
            const oldItem = updated[existingIndex];

            // Use incoming item's read state if explicitly provided, otherwise
            // keep the existing state.  The old "OR" gate (item.read || oldItem.read)
            // was a one-way door that prevented unread items from ever being
            // displayed correctly after a stale read event.
            const isRead = item.read !== undefined ? item.read : oldItem.read;
            const readBy = isRead ? (item.readBy || oldItem.readBy) : undefined;
            const readAt = isRead ? (item.readAt || oldItem.readAt) : undefined;

            const lowerT = (item.title || oldItem.title || "").toLowerCase();
            const lowerM = (item.message || oldItem.message || "").toLowerCase();
            const isImpdp = item.type === "impdp" || item.dpAction === "impdp" || lowerT.includes("impdp") || lowerM.includes("impdp");
            const isExpdp = item.type === "expdp" || item.dpAction === "expdp" || lowerT.includes("expdp") || lowerM.includes("expdp");
            const isDp = isImpdp || isExpdp || item.type === "datapump";
            const isRman = item.type === "rman" || lowerT.includes("rman") || lowerM.includes("rman");

            const resolvedTargetPath = isDp
              ? "/data-pump"
              : isRman
              ? "/backups"
              : item.targetPath || oldItem.targetPath;

            const resolvedType = isImpdp
              ? "impdp"
              : isExpdp
              ? "expdp"
              : isDp
              ? "datapump"
              : isRman
              ? "rman"
              : item.type && item.type !== "generic"
              ? item.type
              : oldItem.type || "generic";

            updated[existingIndex] = {
              ...oldItem,
              ...item,
              type: resolvedType,
              severity: item.severity || oldItem.severity,
              db: item.db || oldItem.db,
              title: item.title || oldItem.title,
              message: item.message || oldItem.message,
              targetPath: resolvedTargetPath,
              timestamp: oldItem.timestamp || item.timestamp,
              read: isRead,
              readBy,
              readAt
            };
          } else {
            const lowerT = (item.title || "").toLowerCase();
            const lowerM = (item.message || "").toLowerCase();
            const isImpdp = item.type === "impdp" || item.dpAction === "impdp" || lowerT.includes("impdp") || lowerM.includes("impdp");
            const isExpdp = item.type === "expdp" || item.dpAction === "expdp" || lowerT.includes("expdp") || lowerM.includes("expdp");
            const isDp = isImpdp || isExpdp || item.type === "datapump";
            const isRman = item.type === "rman" || lowerT.includes("rman") || lowerM.includes("rman");

            const resolvedTargetPath = isDp ? "/data-pump" : isRman ? "/backups" : item.targetPath;
            const resolvedType = isImpdp ? "impdp" : isExpdp ? "expdp" : isDp ? "datapump" : isRman ? "rman" : item.type;

            updated = [{ ...item, type: resolvedType, targetPath: resolvedTargetPath, read: item.read ?? false }, ...state.notifications];
          }

          updated.sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );

          return { notifications: updated.slice(0, 100) };
        }),
      markNotificationRead: (id, skipApi) => {
        // Skip API call if already read locally or if called from SSE handler
        const existing = get().notifications.find((n) => String(n.id) === String(id));
        if (!skipApi && !(existing?.read)) {
          void markNotificationReadApi(id).catch(() => {});
        }
        const username = get().user?.username || "system";
        const nowIso = new Date().toISOString();
        set((state) => ({
          notifications: state.notifications.map((n) =>
            String(n.id) === String(id)
              ? { ...n, read: true, readBy: n.readBy || username, readAt: n.readAt || nowIso }
              : n
          )
        }));
      },
      markAllNotificationsRead: (category, skipApi) => {
        if (!skipApi) {
          void markAllNotificationsReadApi(category).catch(() => {});
        }
        const username = get().user?.username || "system";
        const nowIso = new Date().toISOString();
        set((state) => ({
          notifications: state.notifications.map((n) => {
            const isConsole = n.type === "dba_shift";
            const shouldMark = !category || (category === "console" && isConsole) || (category === "db" && !isConsole);
            if (shouldMark) {
              return { ...n, read: true, readBy: n.readBy || username, readAt: n.readAt || nowIso };
            }
            return n;
          })
        }));
      },
      setDataPumpJobs: (dataPumpJobs) => set({ dataPumpJobs }),
      upsertDataPumpJob: (job) =>
        set((state) => {
          const existingIndex = state.dataPumpJobs.findIndex((j) => j.id === job.id);
          if (existingIndex >= 0) {
            const updated = [...state.dataPumpJobs];
            const old = updated[existingIndex];
            const isFinished = job.status === "success" || job.status === "completed" || job.status === "error";
            const newStatus = (old.status === "running" && job.status === "error" && (
              (job.message || "").toLowerCase().includes("failed to fetch") ||
              (job.message || "").toLowerCase().includes("fetch failed") ||
              (job.message || "").toLowerCase().includes("network")
            )) ? "running" : (job.status || old.status);

            let newMessage = job.message || old.message;
            if (isFinished && (!newMessage || newMessage === "In progress — waiting for n8n callback…" || newMessage === "In progress — waiting for agent callback…")) {
              newMessage = job.status === "error" ? "Job failed" : "Completed successfully";
            }

            updated[existingIndex] = {
              ...old,
              ...job,
              status: newStatus,
              dump_file: job.dump_file || old.dump_file,
              transfer_status: job.transfer_status || old.transfer_status,
              message: newMessage,
              completed_at: job.completed_at || old.completed_at || (isFinished ? new Date().toISOString() : undefined),
              requested_by: job.requested_by || old.requested_by
            };
            return { dataPumpJobs: updated };
          }
          return { dataPumpJobs: [job, ...state.dataPumpJobs].slice(0, 50) };
        }),
      clearCompletedDataPumpJobs: (db?: string) =>
        set((state) => ({
          dataPumpJobs: state.dataPumpJobs.filter(
            (j) => j.status === "running" || (db && j.db?.toUpperCase() !== db.toUpperCase())
          )
        })),
      completeDataPumpJobForDb: (db, operation, status = "success", message) =>
        set((state) => {
          const nowIso = new Date().toISOString();
          let updatedAny = false;
          const updated = state.dataPumpJobs.map((j) => {
            const dbMatch = !db || !j.db || j.db.trim().toUpperCase() === db.trim().toUpperCase();
            const opMatch = !operation || j.operation.toLowerCase() === operation.toLowerCase();
            if (j.status === "running" && dbMatch && opMatch) {
              updatedAny = true;
              return {
                ...j,
                status,
                completed_at: j.completed_at || nowIso,
                message: message || (status === "error" ? "Job failed" : "Completed successfully")
              };
            }
            return j;
          });
          if (!updatedAny) return state;
          return { dataPumpJobs: updated };
        }),
      setExpdpTemplates: (expdpTemplates) => set({ expdpTemplates }),
      addExpdpTemplate: (template) =>
        set((state) => ({
          expdpTemplates: [template, ...state.expdpTemplates.filter((t) => t.id !== template.id)]
        })),
      deleteExpdpTemplate: (id) =>
        set((state) => ({ expdpTemplates: state.expdpTemplates.filter((t) => t.id !== id) })),
      setImpdpTemplates: (impdpTemplates) => set({ impdpTemplates }),
      addImpdpTemplate: (template) =>
        set((state) => ({
          impdpTemplates: [template, ...state.impdpTemplates.filter((t) => t.id !== template.id)]
        })),
      deleteImpdpTemplate: (id) =>
        set((state) => ({ impdpTemplates: state.impdpTemplates.filter((t) => t.id !== id) })),
      upsertRmanJob: (job) =>
        set((state) => {
          const existing = state.rmanJobs.findIndex(
            (j) =>
              j.id === job.id ||
              (job.request_id && j.request_id && j.request_id === job.request_id)
          );
          if (existing >= 0) {
            const updated = [...state.rmanJobs];
            const old = updated[existing];
            updated[existing] = {
              ...old,
              ...job,
              id: old.id || job.id,
              request_id: job.request_id || old.request_id,
              status: job.status || old.status,
              completed_at: job.completed_at || old.completed_at || (job.status !== "running" ? new Date().toISOString() : undefined),
              response: job.response || old.response,
              error: job.error || old.error
            };
            return { rmanJobs: updated };
          }
          return { rmanJobs: [job, ...state.rmanJobs].slice(0, 10) };
        }),
      completeRmanJobForDb: (db, status = "success", message) =>
        set((state) => {
          const nowIso = new Date().toISOString();
          let updatedAny = false;
          const updated = state.rmanJobs.map((j) => {
            if (j.status === "running" && (!db || j.db?.toUpperCase() === db.toUpperCase())) {
              updatedAny = true;
              return {
                ...j,
                status,
                completed_at: j.completed_at || nowIso,
                response: j.response || (message ? {
                  status: status === "error" ? "error" : "success",
                  request_id: j.request_id || `RMAN-${Date.now()}`,
                  action: "take_rman_backup",
                  db_status: status === "success" ? "healthy" : "critical",
                  ai_summary: message,
                  findings: [],
                  recommendations: [],
                  raw_data: {},
                  raw_output: message
                } : undefined)
              };
            }
            return j;
          });
          return updatedAny ? { rmanJobs: updated } : state;
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

        // ── Data Pump Jobs (cap 50, strip params) ──────────────
        dataPumpJobs: state.dataPumpJobs.slice(0, 50).map(({ params: _p, ...rest }) => ({
          ...rest,
          params: {}
        })),

        // ── Templates (cap 20 each) ────────────────────────────
        expdpTemplates: state.expdpTemplates.slice(0, 20),
        impdpTemplates: state.impdpTemplates.slice(0, 20)
      })
    }
  )
);
