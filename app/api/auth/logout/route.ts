import { NextResponse } from "next/server";

import { insertAuditLog, revokeSession } from "@/lib/server/repository";
import { clearSessionCookie, invalidateSessionCache, requireAuthenticatedSession } from "@/lib/server/session";

export async function POST() {
  try {
    const session = await requireAuthenticatedSession();
    if (session) {
      await revokeSession(session.token);
      invalidateSessionCache(session.token);
      await insertAuditLog({
        actor: session.user.username,
        action: "logout",
        status: "success",
        detail: "User logged out."
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
