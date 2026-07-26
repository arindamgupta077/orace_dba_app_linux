import { NextResponse } from "next/server";
import { getAlertNotification, listNotificationHistory, markAllNotificationsReadInDb, markNotificationReadInDb } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { alertTypeToTargetPath, emitGlobalNotification, resolveNotificationType } from "@/lib/server/notification-events";
import type { NotificationPayload } from "@/types/dba";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let actor = "system";
  try {
    const session = await requireAuthenticatedSession();
    actor = session?.user?.username || "user";
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { id, category, all } = body as { id?: string; category?: "db" | "console" | "all"; all?: boolean };

    const nowIso = new Date().toISOString();

    if (id) {
      await markNotificationReadInDb(id, actor);

      // Fetch actual item details from database history or getAlertNotification
      try {
        let itemPayload: NotificationPayload | null = null;

        const alertItem = await getAlertNotification(id).catch(() => null);
        if (alertItem) {
          const sev = alertItem.severity.toUpperCase();
          let title = `Alert ${sev}: ${alertItem.db}`;
          if (alertItem.alert_type === "tablespace") title = `Tablespace ${sev}: ${alertItem.tablespace || alertItem.db}`;
          else if (alertItem.alert_type === "filesystem_drive") title = `Filesystem ${sev}: ${alertItem.object_name || alertItem.db}`;
          else if (alertItem.alert_type === "dba_shift") title = `DBA Console Event`;
          else if (alertItem.alert_type === "approval_workflow") title = "Approval Workflow";
          else if (alertItem.alert_type === "db_monitoring") title = alertItem.status === "completed" ? `Database Online: ${alertItem.db}` : `DB Monitoring Incident: ${alertItem.db}`;
          else if (alertItem.alert_type === "alert_log") title = `Alert Log Error: ${alertItem.db}`;

          itemPayload = {
            id: alertItem.id,
            type: resolveNotificationType(alertItem.alert_type),
            severity: alertItem.severity,
            db: alertItem.db,
            title,
            message: alertItem.message,
            timestamp: alertItem.created_at,
            targetPath: alertTypeToTargetPath(alertItem.alert_type),
            read: true,
            readBy: alertItem.readBy || actor,
            readAt: alertItem.readAt || nowIso
          };
        } else {
          const historyRes = await listNotificationHistory({ search: id, pageSize: 10 }).catch(() => null);
          const found = historyRes?.items?.find((i) => i.id === id);
          if (found) {
            itemPayload = {
              id: found.id,
              type: resolveNotificationType(found.type),
              severity: found.severity,
              db: found.db || "",
              title: found.title,
              message: found.message,
              timestamp: found.timestamp,
              targetPath: found.targetPath || "",
              read: true,
              readBy: found.readBy || actor,
              readAt: found.readAt || nowIso
            };
          }
        }

        if (itemPayload) {
          emitGlobalNotification(itemPayload);
        }
      } catch {
        // Ignore broadcast lookup failure
      }

      return NextResponse.json({ success: true, id, read: true, readBy: actor, readAt: nowIso });
    }

    if (all || category) {
      await markAllNotificationsReadInDb(category || "all", actor);

      // Broadcast category mark-all-read event over SSE so all users sync instantly
      emitGlobalNotification({
        id: "ALL_READ_EVENT",
        type: category === "console" ? "dba_shift" : "tablespace",
        severity: "info",
        db: category || "all",
        title: "",
        message: "",
        timestamp: nowIso,
        targetPath: "",
        read: true,
        readBy: actor,
        readAt: nowIso
      });

      return NextResponse.json({ success: true, category: category || "all", read: true, readBy: actor, readAt: nowIso });
    }

    return NextResponse.json({ message: "Missing id or category parameter" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update notification read status in database";
    return NextResponse.json({ message }, { status: 500 });
  }
}
