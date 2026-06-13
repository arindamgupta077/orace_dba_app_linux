import "server-only";

import type { AlertNotification } from "@/types/dba";

type AlertNotificationEventAction = "created" | "updated";

interface AlertNotificationEvent {
  action: AlertNotificationEventAction;
  alert: AlertNotification;
  sent_at: string;
}

interface AlertNotificationListener {
  id: string;
  db?: string;
  alertType?: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatId?: ReturnType<typeof setInterval>;
}

type AlertNotificationListenerRegistry = Map<string, AlertNotificationListener>;

const encoder = new TextEncoder();
const globalAlertState = globalThis as typeof globalThis & {
  __alertNotificationListeners?: AlertNotificationListenerRegistry;
};
const listeners = globalAlertState.__alertNotificationListeners ?? new Map<string, AlertNotificationListener>();

globalAlertState.__alertNotificationListeners = listeners;

function normalizeFilter(value?: string) {
  return value?.trim().toLowerCase();
}

function writeSseEvent(listener: AlertNotificationListener, event: string, data: unknown) {
  listener.controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function removeAlertNotificationListener(id: string) {
  const listener = listeners.get(id);
  if (!listener) return;

  if (listener.heartbeatId) {
    clearInterval(listener.heartbeatId);
  }

  listeners.delete(id);
}

export function addAlertNotificationListener(
  input: { db?: string; alertType?: string },
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  const id = `alert-listener-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listener: AlertNotificationListener = {
    id,
    db: normalizeFilter(input.db),
    alertType: normalizeFilter(input.alertType),
    controller
  };

  listeners.set(id, listener);

  try {
    writeSseEvent(listener, "connected", { sent_at: new Date().toISOString() });
    listener.heartbeatId = setInterval(() => {
      try {
        writeSseEvent(listener, "heartbeat", { sent_at: new Date().toISOString() });
      } catch {
        removeAlertNotificationListener(id);
      }
    }, 25000);
  } catch {
    removeAlertNotificationListener(id);
  }

  return () => removeAlertNotificationListener(id);
}

export function emitAlertNotificationEvent(action: AlertNotificationEventAction, alert: AlertNotification) {
  const payload: AlertNotificationEvent = {
    action,
    alert,
    sent_at: new Date().toISOString()
  };

  for (const listener of listeners.values()) {
    if (listener.db && listener.db !== normalizeFilter(alert.db)) continue;
    if (listener.alertType && listener.alertType !== normalizeFilter(alert.alert_type)) continue;

    try {
      writeSseEvent(listener, "alert", payload);
    } catch {
      removeAlertNotificationListener(listener.id);
    }
  }
}
