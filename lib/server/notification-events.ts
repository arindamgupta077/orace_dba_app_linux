import "server-only";

import type { AlertNotification, NotificationItemType, NotificationPayload } from "@/types/dba";

export type { NotificationPayload as GlobalNotificationPayload };

interface BroadcastPayload extends NotificationPayload {
  sent_at: string;
}

interface NotificationListener {
  id: string;
  userRole?: string;
  userId?: number;
  username?: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatId?: ReturnType<typeof setInterval>;
}

export function isNotificationForUser(
  payload: NotificationPayload,
  listener: { userRole?: string; userId?: number; username?: string }
): boolean {
  if (payload.targetRole && listener.userRole !== payload.targetRole) {
    return false;
  }
  if (payload.targetUserId !== undefined && listener.userId !== undefined && listener.userId !== payload.targetUserId) {
    return false;
  }
  if (payload.targetUsername && listener.username && listener.username.toLowerCase() !== payload.targetUsername.toLowerCase()) {
    return false;
  }
  return true;
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

function writeSse(listener: NotificationListener, event: string, data: unknown): boolean {
  try {
    listener.controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    return true;
  } catch {
    // Client disconnected — remove listener silently
    removeListener(listener.id);
    return false;
  }
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
  userRole?: string,
  userId?: number,
  username?: string
) {
  const id = `gn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listener: NotificationListener = { id, userRole, userId, username, controller };
  listeners.set(id, listener);

  try {
    writeSse(listener, "connected", { sent_at: new Date().toISOString() });

    if (replayItems && replayItems.length > 0) {
      for (const item of replayItems) {
        if (!item.title && !item.message) continue;
        if (!isNotificationForUser(item, listener)) continue;
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
        if (!item.title && !item.message) continue;
        if (!isNotificationForUser(item, listener)) continue;
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

  // Only store "real" notifications in the replay buffer, not read-status sync
  // events (ALL_READ_EVENT and lightweight read updates with empty titles).
  // Read-status sync events are transient — they should reach currently connected
  // clients but must NOT be replayed to future connections on page reload,
  // because the DB replay already provides the authoritative read state.
  const isReadStatusEvent =
    payload.id === "ALL_READ_EVENT" ||
    (payload.read === true && !payload.title && !payload.message);

  if (!isReadStatusEvent) {
    recentBroadcasts.push(broadcast);
    if (recentBroadcasts.length > RECENT_BUFFER_LIMIT) {
      recentBroadcasts.splice(0, recentBroadcasts.length - RECENT_BUFFER_LIMIT);
    }
  }

  for (const listener of listeners.values()) {
    if (!isNotificationForUser(payload, listener)) continue;
    try {
      writeSse(listener, "notification", broadcast);
    } catch {
      removeListener(listener.id);
    }
  }
}

export function markRecentBroadcastRead(id: string, actor: string = "system", readAt: string = new Date().toISOString()) {
  for (const item of recentBroadcasts) {
    if (String(item.id) === String(id)) {
      item.read = true;
      item.readBy = actor;
      item.readAt = readAt;
    }
  }
}

export function markAllRecentBroadcastsRead(category?: "db" | "console" | "all", actor: string = "system", readAt: string = new Date().toISOString()) {
  for (const item of recentBroadcasts) {
    const isConsole = item.type === "dba_shift";
    const shouldMark = !category || category === "all" || (category === "console" && isConsole) || (category === "db" && !isConsole);
    if (shouldMark) {
      item.read = true;
      item.readBy = actor;
      item.readAt = readAt;
    }
  }
}

export function alertTypeToTargetPath(alertType: string): string {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "/tablespaces";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive" || t === "disk_utilization") return "/filesystem-drive";
  if (t === "approval_workflow") return "/admin-panel/pending-approvals";
  if (t === "db_monitoring") return "/general-admin";
  if (t === "dba_shift") return "/dba-console/shift-management";
  if (t === "alert_log") return "/alerts";
  return "/tablespaces";
}

export function resolveNotificationType(alertType: string): NotificationItemType {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "tablespace";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive") return "filesystem_drive";
  if (t === "approval_workflow") return "approval_workflow";
  if (t === "db_monitoring") return "db_monitoring";
  if (t === "dba_shift") return "dba_shift";
  if (t === "alert_log") return "alert_log";
  return "generic";
}

export function alertTypeToAuditAction(alertType: string): string {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "Tablespace Alert";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive" || t === "disk_utilization") return "disk_utilization";
  if (t === "approval_workflow") return "approval_workflow";
  if (t === "db_monitoring") return "db_monitoring";
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

