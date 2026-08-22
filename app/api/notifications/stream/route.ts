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
async function buildReplayItems(userRole?: string, userId?: number, username?: string): Promise<NotificationPayload[]> {
  const replayMap = new Map<string, NotificationPayload>();

  // 1. Database Alerts (Latest 50 records from app_alert_notifications)
  try {
    const result = await listAlertNotifications({
      limit: 50,
      offset: 0
    });

    for (const alert of result.items) {
      if (alert.alert_type === "datafile_extend") {
        continue;
      }
      const metadata = alert.metadata || {};
      const targetRole = typeof metadata.target_role === "string" ? metadata.target_role : undefined;
      const targetUserId = typeof metadata.target_user_id === "number" ? metadata.target_user_id : undefined;
      const targetUsername = typeof metadata.target_username === "string" ? metadata.target_username : (typeof metadata.requester_username === "string" ? metadata.requester_username : undefined);

      const isPendingReq = alert.alert_type === "approval_workflow" && (
        (alert.status || "").toLowerCase() === "pending_approval" ||
        (alert.status || "").toLowerCase() === "pending" ||
        (!alert.id.startsWith("UPD-") && !alert.id.startsWith("EXEC-") && !alert.id.startsWith("ERR-") && alert.status !== "approved" && alert.status !== "rejected")
      );

      const resolvedType = resolveNotificationType(alert.alert_type, alert.source, alert.id, alert.message);
      const isExplicitType = alert.alert_type && alert.alert_type !== "generic";
      const isExpdp = !isExplicitType && (resolvedType === "expdp" || /\bexpdp\b/i.test(alert.message || ""));
      const isImpdp = !isExplicitType && (resolvedType === "impdp" || /\bimpdp\b/i.test(alert.message || ""));
      const isRman = resolvedType === "rman";

      const finalType = isImpdp ? "impdp" : isExpdp ? "expdp" : resolvedType;

      const itemPayload: NotificationPayload = {
        id: alert.id,
        type: finalType,
        severity: alert.severity,
        db: alert.db,
        title: (() => {
          const sev = alert.severity.toUpperCase();
          if (alert.alert_type === "tablespace") return `Tablespace ${sev}: ${alert.tablespace || alert.db}`;
          if (alert.alert_type === "filesystem_drive") return `Filesystem ${sev}: ${alert.object_name || alert.db}`;
          if (alert.alert_type === "dba_shift") return alert.object_name || `DBA Console Event`;
          if (alert.alert_type === "approval_workflow") {
            const st = (alert.status || "").toLowerCase();
            if (alert.id.startsWith("EXEC-") || st === "completed") return "Execution Complete";
            if (alert.id.startsWith("ERR-") || st === "failed") return "Execution Failed";
            if (alert.id.startsWith("UPD-") || st === "approved" || st === "rejected") {
              return st === "approved" ? "Approval Approved" : "Approval Rejected";
            }
            return "Approval Required";
          }
          if (alert.alert_type === "db_monitoring") {
            return alert.status === "completed" ? `Database Online: ${alert.db}` : `DB Monitoring Incident: ${alert.db}`;
          }
          if (alert.alert_type === "alert_log") return `Alert Log Error: ${alert.db}`;
          if (isImpdp) {
            const st = (alert.status || "").toLowerCase();
            if (st === "completed" || st === "success") return `IMPDP completed`;
            if (st === "failed") return `IMPDP failed`;
            return `IMPDP started`;
          }
          if (isExpdp) {
            const st = (alert.status || "").toLowerCase();
            if (st === "completed" || st === "success") return `EXPDP completed`;
            if (st === "failed") return `EXPDP failed`;
            return `EXPDP started`;
          }
          if (isRman) {
            const st = (alert.status || "").toLowerCase();
            if (st === "completed" || st === "success") return `RMAN Backup completed`;
            if (st === "failed") return `RMAN Backup failed`;
            return `RMAN Backup started`;
          }
          if (alert.alert_type === "database_start" || finalType === "database_start") {
            const st = (alert.status || "").toLowerCase();
            return st === "failed" ? `Database Start Failed: ${alert.db}` : `Database Started: ${alert.db}`;
          }
          if (alert.alert_type === "database_stop" || finalType === "database_stop") {
            const st = (alert.status || "").toLowerCase();
            return st === "failed" ? `Database Stop Failed: ${alert.db}` : `Database Stopped: ${alert.db}`;
          }
          if (alert.alert_type === "listener_start" || finalType === "listener_start") {
            const st = (alert.status || "").toLowerCase();
            return st === "failed" ? `Listener Start Failed: ${alert.db}` : `Listener Started: ${alert.db}`;
          }
          if (alert.alert_type === "listener_stop" || finalType === "listener_stop") {
            const st = (alert.status || "").toLowerCase();
            return st === "failed" ? `Listener Stop Failed: ${alert.db}` : `Listener Stopped: ${alert.db}`;
          }
          return `Alert ${sev}: ${alert.db}`;
        })(),
        message: alert.message,
        timestamp: alert.created_at,
        targetPath: isPendingReq
          ? "/admin-panel/pending-approvals"
          : alertTypeToTargetPath(alert.alert_type, alert.source, alert.id, alert.message),
        read: alert.read ?? false,
        readBy: alert.readBy,
        readAt: alert.readAt,
        targetRole: isPendingReq ? "app_admin" : targetRole,
        targetUserId: isPendingReq ? undefined : targetUserId,
        targetUsername: isPendingReq ? undefined : targetUsername
      };

      // Filter replay items per user context:
      // 1. Pending approval request notifications are strictly for app_admin ONLY
      if (isPendingReq && userRole !== "app_admin") {
        continue;
      }
      // 2. Decision / execution alerts for dba_admin: check target user match
      if (userRole === "dba_admin") {
        if (itemPayload.targetUserId !== undefined && userId !== undefined && itemPayload.targetUserId !== userId) {
          continue;
        }
        if (itemPayload.targetUsername && username && itemPayload.targetUsername.toLowerCase() !== username.toLowerCase()) {
          continue;
        }
      }

      replayMap.set(alert.id, itemPayload);
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
    const approvalItems = await listRecentApprovalNotifications(30, { userRole, userId, username });
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
  let userId: number | undefined;
  let username: string | undefined;
  try {
    const session = await requireAuthenticatedSession();
    userRole = session?.user?.role;
    userId = session?.userId;
    username = session?.user?.username;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Fetch missed alerts before opening the stream to avoid race conditions
  const replayItems = await buildReplayItems(userRole, userId, username);

  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = addGlobalNotificationListener(controller, replayItems, userRole, userId, username);

      // Guard against connection already being aborted before start runs
      if (request.signal.aborted) {
        unsubscribe();
        return;
      }
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
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
