import { addGlobalNotificationListener } from "@/lib/server/notification-events";
import { listActiveMonitoringIncidents, listAlertNotifications } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { alertTypeToTargetPath, resolveNotificationType } from "@/lib/server/notification-events";
import type { NotificationPayload } from "@/types/dba";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Build replay items from recent pending / unresolved alerts and active
 * database monitoring incidents so the bell icon is populated immediately
 * when the browser reconnects after being closed.
 */
async function buildReplayItems(userRole?: string): Promise<NotificationPayload[]> {
  const replayItems: NotificationPayload[] = [];

  try {
    const result = await listAlertNotifications({
      status: "pending_approval",
      limit: 30,
      offset: 0
    });

    const items = result.items;

    for (const alert of items) {
      replayItems.push({
        id: alert.id,
        type: resolveNotificationType(alert.alert_type),
        severity: alert.severity,
        db: alert.db,
        title: (() => {
          const sev = alert.severity.toUpperCase();
          if (alert.alert_type === "tablespace") return `Tablespace ${sev}: ${alert.tablespace || alert.db}`;
          if (alert.alert_type === "filesystem_drive") return `Filesystem ${sev}: ${alert.object_name || alert.db}`;
          return `Alert ${sev}: ${alert.db}`;
        })(),
        message: alert.message,
        timestamp: alert.created_at,
        targetPath: alertTypeToTargetPath(alert.alert_type)
      });
    }
  } catch {
    // Ignore alert notification replay errors
  }

  try {
    const activeIncidents = await listActiveMonitoringIncidents();
    for (const incident of activeIncidents) {
      replayItems.push({
        id: `MON-${incident.db_name}-${incident.incident_id}`,
        type: "db_monitoring",
        severity: incident.status === "DOWN" ? "critical" : "warning",
        db: incident.db_name,
        title: `Database ${incident.status}: ${incident.db_name}`,
        message: `Monitoring Agent reports database ${incident.db_name} is ${incident.status.toLowerCase()} (reported ${incident.report_count}x).`,
        timestamp: incident.last_reported || incident.created_at,
        targetPath: "/general-admin"
      });
    }
  } catch {
    // Ignore monitoring incident replay errors
  }

  return replayItems;
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
  const replayItems = await buildReplayItems(userRole);

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
