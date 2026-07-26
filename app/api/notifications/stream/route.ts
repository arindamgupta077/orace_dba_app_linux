import { addGlobalNotificationListener } from "@/lib/server/notification-events";
import { listAlertNotifications, listRecentApprovalNotifications, listRecentShiftNotifications } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { alertTypeToTargetPath, resolveNotificationType } from "@/lib/server/notification-events";
import type { NotificationPayload } from "@/types/dba";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Build replay items from recent database alerts, monitoring incidents,
 * and DBA console shift activities so bell icon feeds are populated immediately
 * when the browser loads or reconnects.
 */
async function buildReplayItems(): Promise<NotificationPayload[]> {
  const replayMap = new Map<string, NotificationPayload>();

  // 1. Database Alerts (Latest 50 records from app_alert_notifications)
  try {
    const result = await listAlertNotifications({
      limit: 50,
      offset: 0
    });

    for (const alert of result.items) {
      replayMap.set(alert.id, {
        id: alert.id,
        type: resolveNotificationType(alert.alert_type),
        severity: alert.severity,
        db: alert.db,
        title: (() => {
          const sev = alert.severity.toUpperCase();
          if (alert.alert_type === "tablespace") return `Tablespace ${sev}: ${alert.tablespace || alert.db}`;
          if (alert.alert_type === "filesystem_drive") return `Filesystem ${sev}: ${alert.object_name || alert.db}`;
          if (alert.alert_type === "dba_shift") return `DBA Console Event`;
          if (alert.alert_type === "approval_workflow") {
            const st = (alert.status || "").toLowerCase();
            if (st === "approved") return "Approval Approved";
            if (st === "rejected") return "Approval Rejected";
            if (st === "completed") return "Execution Complete";
            if (st === "failed") return "Execution Failed";
            return "Approval Required";
          }
          if (alert.alert_type === "db_monitoring") {
            return alert.status === "completed" ? `Database Online: ${alert.db}` : `DB Monitoring Incident: ${alert.db}`;
          }
          if (alert.alert_type === "alert_log") return `Alert Log Error: ${alert.db}`;
          return `Alert ${sev}: ${alert.db}`;
        })(),
        message: alert.message,
        timestamp: alert.created_at,
        targetPath: alertTypeToTargetPath(alert.alert_type),
        read: alert.read ?? false,
        readBy: alert.readBy,
        readAt: alert.readAt
      });
    }
  } catch {
    // Ignore alert notification replay errors
  }

  // 2. DBA Console Activities (Latest 50 shift session & handover records)
  try {
    const shiftItems = await listRecentShiftNotifications(50);
    for (const item of shiftItems) {
      replayMap.set(item.id, item);
    }
  } catch {
    // Ignore shift activity replay errors
  }

  // 3. Approval Workflow Requests (Latest 30 approval request records from app_approval_requests)
  try {
    const approvalItems = await listRecentApprovalNotifications(30);
    for (const item of approvalItems) {
      if (!replayMap.has(item.id)) {
        replayMap.set(item.id, item);
      }
    }
  } catch {
    // Ignore approval replay errors
  }

  return Array.from(replayMap.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function GET(request: Request) {
  let userRole: string | undefined;
  try {
    const session = await requireAuthenticatedSession();
    userRole = session?.user?.role;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Fetch missed alerts before opening the stream to avoid race conditions
  const replayItems = await buildReplayItems();

  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = addGlobalNotificationListener(controller, replayItems, userRole);
      request.signal.addEventListener("abort", unsubscribe, { once: true });
    },
    cancel() {
      unsubscribe();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
