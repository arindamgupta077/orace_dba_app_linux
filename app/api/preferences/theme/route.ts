import { NextResponse } from "next/server";

import { getUserThemePreference, upsertUserThemePreference } from "@/lib/server/repository";
import { invalidateSessionCacheForUser, requireAuthenticatedSession } from "@/lib/server/session";
import type { ThemePreference } from "@/types/dba";

export const dynamic = "force-dynamic";

function isValidTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark";
}

/**
 * GET /api/preferences/theme
 * Returns the authenticated user's persisted colour theme preference.
 * Falls back to "dark" when no row exists yet or the preferences table
 * has not been migrated.
 */
export async function GET() {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    // Prefer the value already attached to the session (loaded via the
    // app_user_preferences JOIN in getSessionByToken).  Fall back to a
    // dedicated read for safety.
    const theme: ThemePreference =
      session.user.themePreference && isValidTheme(session.user.themePreference)
        ? session.user.themePreference
        : await getUserThemePreference(session.userId);

    return NextResponse.json({ theme });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load theme preference.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

/**
 * PUT /api/preferences/theme
 * Body: { theme: "light" | "dark" }
 * Persists the authenticated user's colour theme preference in
 * app_user_preferences (idempotent MERGE).
 */
export async function PUT(request: Request) {
  try {
    const session = await requireAuthenticatedSession();
    if (!session) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { theme?: unknown };
    if (!isValidTheme(body.theme)) {
      return NextResponse.json(
        { message: "Invalid theme. Expected 'light' or 'dark'." },
        { status: 400 }
      );
    }

    await upsertUserThemePreference(session.userId, body.theme);
    // Invalidate the in-memory session cache for this user so the next
    // session read picks up the new theme_preference (otherwise a reload
    // within the cache TTL would serve the stale value and flip the UI
    // back to the previous theme).
    invalidateSessionCacheForUser(session.userId);

    return NextResponse.json({ theme: body.theme, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save theme preference.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
