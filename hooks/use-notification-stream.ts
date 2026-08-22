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
            const lowerTitle = (data.title || "").toLowerCase();
            const lowerMsg = (data.message || "").toLowerCase();
            const isNonJobType = data.type === "dba_shift" || data.type === "approval_workflow" || data.type === "tablespace" || data.type === "filesystem_drive" || data.type === "alert_log";

            // Sync RMAN background jobs state if a LIVE RMAN notification arrives
            if (!isNonJobType && (data.type === "rman" || (!data.type && (/\brman\b/i.test(lowerTitle) || /\brman\b/i.test(lowerMsg))))) {
              const isFail = data.severity === "critical" || lowerTitle.includes("failed") || lowerMsg.includes("failed");
              const isDone = lowerTitle.includes("completed") || lowerTitle.includes("finished") || lowerMsg.includes("completed") || lowerMsg.includes("finished") || data.severity === "info";
              if (isFail || isDone) {
                useAppStore.getState().completeRmanJobForDb(data.db, isFail ? "error" : "success", data.message);
              }
            }

            // Sync Data Pump (EXPDP & IMPDP) background jobs state if a LIVE Data Pump notification arrives
            const isExpdp = !isNonJobType && (data.type === "expdp" || data.dpAction === "expdp" || (!data.type && /\bexpdp\b/i.test(lowerTitle + " " + lowerMsg)));
            const isImpdp = !isNonJobType && (data.type === "impdp" || data.dpAction === "impdp" || (!data.type && /\bimpdp\b/i.test(lowerTitle + " " + lowerMsg)));
            if (isExpdp || isImpdp) {
              const isFail = data.severity === "critical" || lowerTitle.includes("failed") || lowerMsg.includes("failed");
              const dpStatus = data.dpStatus || (isFail ? "error" : "success");
              const rawJobId = data.dpJobId || (data.id ? data.id.replace(/-done$/, "") : "");
              const operation = isExpdp ? "expdp" : "impdp";

              if (rawJobId) {
                useAppStore.getState().upsertDataPumpJob({
                  id: rawJobId,
                  operation,
                  db: data.db,
                  status: dpStatus,
                  dump_file: data.dpDumpFile,
                  message: data.message,
                  started_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                  params: {}
                });
              }
              useAppStore.getState().completeDataPumpJobForDb(data.db, operation, dpStatus, data.message);
            }

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

  // Global listener for Data Pump SSE callback stream (wildcard job_id=*) to sync EXPDP/IMPDP completions instantly
  useEffect(() => {
    if (!user) return;
    let dpEs: EventSource | null = null;
    try {
      dpEs = new EventSource("/api/datapump/sse?job_id=*");
      dpEs.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data as string);
          if (payload && payload.job_id) {
            const action = (payload.action || "expdp").toLowerCase() as "expdp" | "impdp";
            const status = payload.status || "success";
            const isFinished = status !== "running";

            useAppStore.getState().upsertDataPumpJob({
              id: payload.job_id,
              operation: action,
              db: payload.db,
              status: status,
              started_at: new Date().toISOString(),
              completed_at: isFinished ? new Date().toISOString() : undefined,
              dump_file: payload.dump_file,
              transfer_status: payload.transfer_status,
              message: payload.message,
              params: {}
            });

            if (isFinished) {
              useAppStore.getState().completeDataPumpJobForDb(
                payload.db,
                action,
                status,
                payload.message
              );
            }
          }
        } catch {
          // ignore bad frames
        }
      };
    } catch {
      // ignore connection errors
    }

    return () => {
      dpEs?.close();
    };
  }, [user]);
}
