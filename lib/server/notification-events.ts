import "server-only";

import type { NotificationItemType, NotificationPayload } from "@/types/dba";

export type { NotificationPayload as GlobalNotificationPayload };

interface BroadcastPayload extends NotificationPayload {
  sent_at: string;
}

interface NotificationListener {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatId?: ReturnType<typeof setInterval>;
}

const encoder = new TextEncoder();
const globalState = globalThis as typeof globalThis & {
  __globalNotifListeners?: Map<string, NotificationListener>;
};
const listeners = globalState.__globalNotifListeners ?? new Map<string, NotificationListener>();
globalState.__globalNotifListeners = listeners;

function writeSse(listener: NotificationListener, event: string, data: unknown) {
  listener.controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function removeListener(id: string) {
  const l = listeners.get(id);
  if (!l) return;
  if (l.heartbeatId) clearInterval(l.heartbeatId);
  listeners.delete(id);
}

/**
 * Register a new SSE client.
 * @param controller  - The ReadableStream controller to write SSE frames into.
 * @param replayItems - Optional recent notifications to replay immediately on connect.
 *                      Ensures the bell icon is populated even after the browser was closed.
 */
export function addGlobalNotificationListener(
  controller: ReadableStreamDefaultController<Uint8Array>,
  replayItems?: NotificationPayload[]
) {
  const id = `gn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listener: NotificationListener = { id, controller };
  listeners.set(id, listener);

  try {
    writeSse(listener, "connected", { sent_at: new Date().toISOString() });

    // Replay any missed notifications (alerts that arrived while the browser was closed)
    if (replayItems && replayItems.length > 0) {
      for (const item of replayItems) {
        try {
          writeSse(listener, "notification", { ...item, replayed: true, sent_at: new Date().toISOString() });
        } catch {
          break; // stream already closed
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
  return "/tablespaces";
}

export function resolveNotificationType(alertType: string): NotificationItemType {
  const t = alertType.trim().toLowerCase();
  if (t === "tablespace") return "tablespace";
  if (t === "filesystem_drive" || t === "filesystem" || t === "drive") return "filesystem_drive";
  return "generic";
}
