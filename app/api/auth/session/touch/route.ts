import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import {
  clearSessionCookie,
  readSessionTokenFromCookie,
  requireAuthenticatedSession,
  touchSession
} from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session/touch
 *
 * Called by the client when genuine user activity is detected.
 * Resets the inactivity timer (last_activity_at) but NEVER extends the
 * absolute session timeout (absolute_expires_at).
 *
 * Rate-limited to at most once every 30 seconds per session — additional
 * requests within that window return a cached response without touching
 * the database.
 */

// Simple in-memory rate limiter (per-token, 30-second window).
const touchTimestamps = new Map<string, number>();
const TOUCH_RATE_LIMIT_MS = 30 * 1000;

// Prune old entries every 5 minutes to avoid unbounded growth.
let lastPrune = Date.now();
function pruneTouchTimestamps() {
  const now = Date.now();
  if (now - lastPrune < 5 * 60 * 1000) return;
  lastPrune = now;
  for (const [key, ts] of touchTimestamps) {
    if (now - ts > TOUCH_RATE_LIMIT_MS * 2) touchTimestamps.delete(key);
  }
}

export async function POST() {
  try {
    const token = await readSessionTokenFromCookie();
    if (!token) {
      const res = NextResponse.json({ message: "Not authenticated." }, { status: 401 });
      clearSessionCookie(res);
      return res;
    }

    // Rate-limit: skip DB write if touched recently.
    pruneTouchTimestamps();
    const now = Date.now();
    const lastTouch = touchTimestamps.get(token);
    if (lastTouch && now - lastTouch < TOUCH_RATE_LIMIT_MS) {
      // Still within the rate window — return the existing timeout info
      // without hitting the database.
      const session = await requireAuthenticatedSession();
      if (!session) {
        const res = NextResponse.json({ message: "Session expired." }, { status: 401 });
        clearSessionCookie(res);
        return res;
      }

      const env = getServerEnv();
      const inactivityMs = env.sessionInactivityTimeoutMinutes * 60 * 1000;
      const lastActivityEpoch = new Date(session.lastActivityAt).getTime();

      return NextResponse.json({
        ok: true,
        absoluteExpiresAt: session.absoluteExpiresAt,
        inactivityExpiresAt: new Date(lastActivityEpoch + inactivityMs).toISOString(),
        rateLimited: true
      });
    }

    // Touch the DB.
    const ok = await touchSession(token);
    if (!ok) {
      const res = NextResponse.json({ message: "Session expired or revoked." }, { status: 401 });
      clearSessionCookie(res);
      return res;
    }

    touchTimestamps.set(token, now);

    // Re-read the updated session to return fresh timeout info.
    const session = await requireAuthenticatedSession();
    if (!session) {
      const res = NextResponse.json({ message: "Session expired." }, { status: 401 });
      clearSessionCookie(res);
      return res;
    }

    const env = getServerEnv();
    const inactivityMs = env.sessionInactivityTimeoutMinutes * 60 * 1000;

    return NextResponse.json({
      ok: true,
      absoluteExpiresAt: session.absoluteExpiresAt,
      inactivityExpiresAt: new Date(now + inactivityMs).toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected session touch error.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
