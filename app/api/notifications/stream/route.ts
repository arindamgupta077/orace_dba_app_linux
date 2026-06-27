import { addGlobalNotificationListener } from "@/lib/server/notification-events";
import { listAlertNotifications } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { alertTypeToTargetPath, resolveNotificationType } from "@/lib/server/notification-events";
import type { NotificationPayload } from "@/types/dba";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Build replay items from recent pending / unresolved alerts so the bell
 * icon is populated immediately when the browser reconnects after being closed.
 */
async function buildReplayItems(): Promise<NotificationPayload[]> {
  try {
    const result = await listAlertNotifications({
      status: "pending_approval",
      limit: 30,
      offset: 0
    });

    return result.items.map((alert) => ({
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
    }));
  } catch {
    // Never break the SSE stream because of a DB lookup failure
    return [];
  }
}

export async function GET(request: Request) {
  try {
    await requireAuthenticatedSession();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Fetch missed alerts before opening the stream to avoid race conditions
  const replayItems = await buildReplayItems();

  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = addGlobalNotificationListener(controller, replayItems);
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
