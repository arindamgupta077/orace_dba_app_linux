"use client";

import { SESSION_BROADCAST_CHANNEL } from "@/lib/session-config";

export type SessionExpiredReason = "session_expired" | "session_inactive" | "manual";

/**
 * Clear server session cookie, wipe cached client user, broadcast logout
 * to other tabs, and redirect to the login page.
 *
 * @param reason  – optional reason code appended as a query parameter so
 *                  the login page can display an appropriate message.
 */
export async function clearAuthAndRedirect(reason?: SessionExpiredReason): Promise<void> {
  if (typeof window === "undefined") return;

  // Best-effort server-side session revocation.
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason || "manual" })
    });
  } catch {
    // Best-effort cookie clear.
  }

  // Clear Zustand user state and selected DB.
  try {
    const { useAppStore } = await import("@/store/use-app-store");
    useAppStore.getState().setUser(undefined);
    useAppStore.getState().setSelectedDb("");
  } catch {
    // Ignore — store may not be initialised yet.
  }

  try {
    sessionStorage.removeItem("dba_fresh_login_autoselect");
  } catch {
    // Ignore if sessionStorage unavailable.
  }

  // Broadcast logout to all other tabs so they redirect too.
  try {
    const bc = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    bc.postMessage({ type: "logout", reason: reason || "manual" });
    bc.close();
  } catch {
    // BroadcastChannel not supported — tabs won't sync, but logout still works.
  }

  // Redirect to login with reason.
  const loginUrl = reason && reason !== "manual"
    ? `/login?reason=${encodeURIComponent(reason)}`
    : "/login";

  if (!window.location.pathname.startsWith("/login")) {
    window.location.replace(loginUrl);
  }
}
