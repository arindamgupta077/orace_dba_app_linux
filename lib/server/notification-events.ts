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

export function addGlobalNotificationListener(controller: ReadableStreamDefaultController<Uint8Array>) {
  const id = `gn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listener: NotificationListener = { id, controller };
  listeners.set(id, listener);

  try {
    writeSse(listener, "connected", { sent_at: new Date().toISOString() });
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
