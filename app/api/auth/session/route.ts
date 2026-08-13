import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { clearSessionCookie, requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      const response = NextResponse.json({ message: "Not authenticated." }, { status: 401 });
      clearSessionCookie(response);
      return response;
    }

    const env = getServerEnv();

    return NextResponse.json({
      user: session.user,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      // Provide timeout configuration so the client can set its timers
      // from server-authoritative values rather than hard-coded defaults.
      sessionConfig: {
        inactivityTimeoutMs: env.sessionInactivityTimeoutMinutes * 60 * 1000,
        absoluteTimeoutMs: env.sessionAbsoluteTimeoutHours * 60 * 60 * 1000,
        warningBeforeMs: env.sessionWarningBeforeMinutes * 60 * 1000
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected session error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
