"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/use-app-store";
import type { NotificationItem, NotificationPayload } from "@/types/dba";

function payloadToNotificationItem(data: NotificationPayload): NotificationItem {
  return {
    id: data.id,
    type: data.type,
    severity: data.severity,
    db: data.db,
    title: data.title,
    message: data.message,
    timestamp: data.timestamp || new Date().toISOString(),
    targetPath: data.targetPath,
    read: data.read ?? false,
    readBy: data.readBy,
    readAt: data.readAt
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
          const data = JSON.parse(event.data as string) as NotificationPayload;

          const isForMe =
            (!data.targetRole || data.targetRole === user?.role) &&
            (data.targetUserId === undefined || data.targetUserId === user?.userId) &&
            (!data.targetUsername || data.targetUsername.toLowerCase() === user?.username?.toLowerCase());

          if (!isForMe) return;

          const isPendingApprovalRequest =
            data.title === "Approval Required" ||
            (data.type === "approval_workflow" && (data.targetRole === "app_admin" || !data.title.includes("Approved") && !data.title.includes("Rejected") && !data.title.includes("Complete") && !data.title.includes("Failed")));

          if (isPendingApprovalRequest && user?.role !== "app_admin") {
            return;
          }

          if (data.id === "ALL_READ_EVENT") {
            const cat = data.type === "dba_shift" ? "console" : data.db === "db" ? "db" : undefined;
            // skipApi=true to prevent re-calling the API which would re-broadcast and create a loop
            useAppStore.getState().markAllNotificationsRead(cat, true);
            return;
          }
          if (data.type === "approval_workflow") {
            window.dispatchEvent(new CustomEvent("dba-approval-update", { detail: data }));
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
