import { NextResponse } from "next/server";
import { markAllNotificationsReadInDb, markNotificationReadInDb } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { emitGlobalNotification } from "@/lib/server/notification-events";

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

      // Emit a lightweight read-status update via SSE for multi-tab/multi-user sync.
      // We intentionally skip the expensive DB lookups (getAlertNotification,
      // listNotificationHistory) that previously caused ~1.5s response times
      // and contributed to feedback loops.
      try {
        emitGlobalNotification({
          id,
          type: "generic",
          severity: "info",
          db: "",
          title: "",
          message: "",
          timestamp: "",
          targetPath: "",
          read: true,
          readBy: actor,
          readAt: nowIso
        });
      } catch {
        // Ignore broadcast failure
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
        timestamp: "",
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
