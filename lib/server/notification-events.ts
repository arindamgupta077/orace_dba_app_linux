import "server-only";

import type { AlertNotification, NotificationItemType, NotificationPayload } from "@/types/dba";

export type { NotificationPayload as GlobalNotificationPayload };

interface BroadcastPayload extends NotificationPayload {
  sent_at: string;
}

interface NotificationListener {
  id: string;
  userRole?: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatId?: ReturnType<typeof setInterval>;
}

const encoder = new TextEncoder();
const globalState = globalThis as typeof globalThis & {
  __globalNotifListeners?: Map<string, NotificationListener>;
  __globalNotifRecent?: BroadcastPayload[];
};

const listeners = globalState.__globalNotifListeners ?? new Map<string, NotificationListener>();
globalState.__globalNotifListeners = listeners;

const RECENT_BUFFER_LIMIT = 50;
const recentBroadcasts = globalState.__globalNotifRecent ?? [];
globalState.__globalNotifRecent = recentBroadcasts;

function writeSse(listener: NotificationListener, event: string, data: unknown) {
  listener.controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function removeListener(id: string) {
  const l = listeners.get(id);
  if (!l) return;
  if (l.heartbeatId) clearInterval(l.heartbeatId);
  listeners.delete(id);
}

export function addGlobalNotificationListener(
  controller: ReadableStreamDefaultController<Uint8Array>,
  replayItems?: NotificationPayload[],
  userRole?: string
) {
  const id = `gn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listener: NotificationListener = { id, userRole, controller };
  listeners.set(id, listener);

  try {
    writeSse(listener, "connected", { sent_at: new Date().toISOString() });

    if (replayItems && replayItems.length > 0) {
      for (const item of replayItems) {
        try {
          writeSse(listener, "notification", { ...item, replayed: true, sent_at: new Date().toISOString() });
        } catch {
          break;
        }
      }
    }

    if (recentBroadcasts.length > 0) {
      const replayedIds = new Set((replayItems ?? []).map((r) => r.id));
      for (const item of recentBroadcasts) {
        if (replayedIds.has(item.id)) continue;
        // dba_admin never sees approval-workflow notifications in the bell —
        // they surface in the dedicated WorkflowStatusModal instead.
        if (userRole === "dba_admin" && item.type === "approval_workflow") {
          continue;
        }
        try {
          writeSse(listener, "notification", { ...item, replayed: true });
        } catch {
          break;
        }
      }
    }

    listener.heartbeatId = setInterval(() => {
      try {
        writeSse(listener, "heartbeat", { sent_at: new Date().toISOString() });
      } catch {
        removeListener(id);
      }
    }, 25000);
  } catch {
    removeListener(id);
  }

  return () => removeListener(id);
}

export function emitGlobalNotification(payload: NotificationPayload) {
  const broadcast: BroadcastPayload = { ...payload, sent_at: new Date().toISOString() };

  recentBroadcasts.push(broadcast);
  if (recentBroadcasts.length > RECENT_BUFFER_LIMIT) {
    recentBroadcasts.splice(0, recentBroadcasts.length - RECENT_BUFFER_LIMIT);
  }

  for (const listener of listeners.values()) {
    try {
      writeSse(listener, "notification", broadcast);
    } catch {
      removeListener(listener.id);
    }
  }
}

export function alertTypeToTargetPath(alertType: string): string {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "/tablespaces";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive" || t === "disk_utilization") return "/filesystem-drive";
  if (t === "approval_workflow") return "/admin-panel/pending-approvals";
  return "/tablespaces";
}

export function resolveNotificationType(alertType: string): NotificationItemType {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "tablespace";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive") return "filesystem_drive";
  if (t === "approval_workflow") return "approval_workflow";
  return "generic";
}

export function alertTypeToAuditAction(alertType: string): string {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "Tablespace Alert";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive" || t === "disk_utilization") return "disk_utilization";
  if (t === "approval_workflow") return "approval_workflow";
  return "alert_log";
}

/**
 * Derive a human-readable subject for an alert — the tablespace name for
 * tablespace alerts, or the filesystem/drive name for filesystem alerts — so
 * the audit log "Detail" column reads e.g. "tablespace alert created for
 * USERS on database ORCL." instead of embedding the opaque alert id
 * (e.g. "ALT-1A9412A7BE4D5280D2D942CBEF66E5DE-1783681017693-456" or
 * "FS-1783679781797").
 */
export function deriveAlertSubject(alert: Pick<AlertNotification, "alert_type" | "db" | "tablespace" | "object_name">): string {
  const t = alert.alert_type.trim().toLowerCase();
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive" || t === "disk_utilization") {
    return alert.object_name || alert.tablespace || alert.db;
  }
  // tablespace, datafile_extend, alert_log, generic, etc.
  return alert.tablespace || alert.object_name || alert.db;
}

