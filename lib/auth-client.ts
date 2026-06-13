"use client";

/** Clear server session cookie, wipe cached client user, and send to login. */
export async function clearAuthAndRedirect(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Best-effort cookie clear.
  }

  const { useAppStore } = await import("@/store/use-app-store");
  useAppStore.getState().setUser(undefined);

  if (!window.location.pathname.startsWith("/login")) {
    window.location.replace("/login");
  }
}
