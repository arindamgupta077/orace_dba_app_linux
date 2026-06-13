import { NextResponse } from "next/server";

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

    return NextResponse.json({
      user: session.user,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected session error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
