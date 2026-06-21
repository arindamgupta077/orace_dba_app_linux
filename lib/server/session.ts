import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { getSessionByToken } from "@/lib/server/repository";
import type { UserSession } from "@/types/dba";

export interface AuthenticatedSession {
  userId: number;
  token: string;
  user: UserSession;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// In-memory session cache
// Avoids a synchronous Oracle DB round-trip on every API call.  Each valid
// session token is cached for SESSION_CACHE_TTL_MS.  The cache is invalidated
// on logout and pruned lazily when it grows large.
// ---------------------------------------------------------------------------
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedEntry {
  result: AuthenticatedSession;
  cachedAt: number;
}

const sessionCache = new Map<string, CachedEntry>();

function pruneSessionCache(): void {
  const now = Date.now();
  for (const [key, entry] of sessionCache) {
    if (now - entry.cachedAt >= SESSION_CACHE_TTL_MS) {
      sessionCache.delete(key);
    }
  }
}

/** Remove a token from the cache immediately (call on logout / revoke). */
export function invalidateSessionCache(token: string): void {
  sessionCache.delete(token);
}

export async function readSessionTokenFromCookie() {
  const { sessionCookieName } = getServerEnv();
  const store = await cookies();
  return store.get(sessionCookieName)?.value;
}

export async function requireAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const token = await readSessionTokenFromCookie();
  if (!token) return null;

  const now = Date.now();

  // Return cached result if it is still fresh.
  const cached = sessionCache.get(token);
  if (cached && now - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    return cached.result;
  }

  // Cache miss — hit Oracle.
  const session = await getSessionByToken(token);
  if (!session) {
    sessionCache.delete(token);
    return null;
  }

  const result: AuthenticatedSession = {
    userId: session.userId,
    token,
    user: session.user,
    expiresAt: session.expiresAt
  };

  sessionCache.set(token, { result, cachedAt: now });

  // Prune stale entries once the cache grows beyond 200 tokens.
  if (sessionCache.size > 200) pruneSessionCache();

  return result;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAtIso: string) {
  const { sessionCookieName } = getServerEnv();
  // COOKIE_SECURE must be explicitly set to "true" when serving over HTTPS.
  // Do NOT use NODE_ENV === "production" here — the app can run in production
  // mode over plain HTTP (e.g. behind a reverse proxy that terminates TLS),
  // and setting Secure=true on an HTTP origin causes browsers (especially on
  // Linux) to silently drop the cookie, breaking authentication entirely.
  const secureCookie = process.env.COOKIE_SECURE === "true";
  response.cookies.set({
    name: sessionCookieName,
    value: token,
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAtIso)
  });
}

export function clearSessionCookie(response: NextResponse) {
  const { sessionCookieName } = getServerEnv();
  const secureCookie = process.env.COOKIE_SECURE === "true";
  response.cookies.set({
    name: sessionCookieName,
    value: "",
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    expires: new Date(0)
  });
}
