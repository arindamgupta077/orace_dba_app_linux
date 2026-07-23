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
  const user = useAppStore((s) => s.user);
  const addNotification = useAppStore((s) => s.addNotification);
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  useEffect(() => {
    if (!user) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;

      es = new EventSource("/api/notifications/stream");

      es.addEventListener("notification", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "approval_workflow") {
            // Approval events are surfaced in a dedicated modal for the
            // requester (dba_admin) instead of the bell list. Other roles
            // still get them in the bell via addNotification below.
            window.dispatchEvent(new CustomEvent("dba-approval-update", { detail: data }));
            if (user?.role === "dba_admin") {
              return;
            }
          }
          addNotificationRef.current(payloadToNotificationItem(data));
          if (!data.replayed) {
            console.log("[useNotificationStream] New live notification received:", data);
            window.dispatchEvent(new CustomEvent("dba-notification", { detail: data }));
          }
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
  }, [user]);
}
