import { NextResponse } from "next/server";

import { insertAuditLog, revokeSession } from "@/lib/server/repository";
import { clearSessionCookie, invalidateSessionCache, requireAuthenticatedSession } from "@/lib/server/session";

export async function POST(request: Request) {
  try {
    // Accept an optional reason for the audit trail (e.g. "session_expired", "session_inactive").
    let reason = "manual";
    try {
      const body = await request.json();
      if (body?.reason && typeof body.reason === "string") {
        reason = body.reason;
      }
    } catch {
      // No body or invalid JSON — default to manual logout.
    }

    const reasonLabels: Record<string, string> = {
      manual: "User logged out.",
      session_expired: "Session expired (absolute 24-hour limit reached).",
      session_inactive: "Session expired due to inactivity."
    };

    const session = await requireAuthenticatedSession();
    if (session) {
      await revokeSession(session.token);
      invalidateSessionCache(session.token);
      await insertAuditLog({
        actor: session.user.username,
        action: "logout",
        status: "success",
        detail: reasonLabels[reason] || `User logged out (${reason}).`
      });
    }

    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected logout error.";
    const response = NextResponse.json({ message }, { status: 500 });
    clearSessionCookie(response);
    return response;
  }
}
