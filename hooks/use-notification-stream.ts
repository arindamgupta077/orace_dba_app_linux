"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/use-app-store";
import type { NotificationItem, NotificationPayload } from "@/types/dba";

function payloadToNotificationItem(data: NotificationPayload): Omit<NotificationItem, "read"> {
  return {
    id: data.id,
    type: data.type,
    severity: data.severity,
    db: data.db,
    title: data.title,
    message: data.message,
    timestamp: data.timestamp || new Date().toISOString(),
    targetPath: data.targetPath
  };
}

export function useNotificationStream() {
  const addNotification = useAppStore((s) => s.addNotification);
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;

      es = new EventSource("/api/notifications/stream");

      es.addEventListener("notification", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as NotificationPayload;
          addNotificationRef.current(payloadToNotificationItem(data));
        } catch {
          // ignore malformed events
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) {
          retryTimeout = setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, []);
}
