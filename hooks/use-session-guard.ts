"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clearAuthAndRedirect } from "@/lib/auth-client";
import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_ACTIVITY_THROTTLE_MS,
  SESSION_BROADCAST_CHANNEL,
  SESSION_INACTIVITY_TIMEOUT_MS,
  SESSION_TOUCH_THROTTLE_MS,
  SESSION_WARNING_BEFORE_MS
} from "@/lib/session-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionGuardConfig {
  /** Absolute session expiry (epoch ms) — set at login, never changes. */
  absoluteExpiresAt: number;
  /** Server-provided inactivity timeout in ms (default: 60 min). */
  inactivityTimeoutMs?: number;
  /** Server-provided warning lead time in ms (default: 5 min). */
  warningBeforeMs?: number;
}

export interface SessionGuardState {
  /** True when the inactivity warning modal should be shown. */
  showWarning: boolean;
  /** Seconds remaining until auto-logout (counts down when warning is shown). */
  warningSecondsLeft: number;
  /** Call to dismiss the warning and reset the inactivity timer. */
  dismissWarning: () => void;
}

// ---------------------------------------------------------------------------
// BroadcastChannel message types
// ---------------------------------------------------------------------------

interface BroadcastActivity {
  type: "activity";
  timestamp: number;
}

interface BroadcastLogout {
  type: "logout";
  reason?: string;
}

interface BroadcastWarningDismissed {
  type: "warning_dismissed";
  timestamp: number;
}

type BroadcastMessage = BroadcastActivity | BroadcastLogout | BroadcastWarningDismissed;

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * useSessionGuard — Client-side session lifecycle management.
 *
 * Tracks user activity, enforces inactivity and absolute session timeouts,
 * shows a warning modal before inactivity logout, and synchronises session
 * state across browser tabs via BroadcastChannel.
 *
 * Mount this hook ONCE in the authenticated shell (AppShell).
 */
export function useSessionGuard(
  config: SessionGuardConfig | null
): SessionGuardState {
  // --------------- defaults ------------------------------------------------
  const inactivityTimeoutMs = config?.inactivityTimeoutMs ?? SESSION_INACTIVITY_TIMEOUT_MS;
  const warningBeforeMs = config?.warningBeforeMs ?? SESSION_WARNING_BEFORE_MS;
  const absoluteExpiresAt = config?.absoluteExpiresAt ?? (Date.now() + SESSION_ABSOLUTE_TIMEOUT_MS);

  // --------------- state ---------------------------------------------------
  const [showWarning, setShowWarning] = useState(false);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(
    Math.ceil(warningBeforeMs / 1000)
  );

  // Refs survive re-renders and are used by the timer callbacks.
  const lastActivityRef = useRef(Date.now());
  const lastTouchRef = useRef(0);
  const warningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const loggingOutRef = useRef(false);
  const configRef = useRef({ inactivityTimeoutMs, warningBeforeMs, absoluteExpiresAt });
  configRef.current = { inactivityTimeoutMs, warningBeforeMs, absoluteExpiresAt };

  // --------------- helpers -------------------------------------------------

  /** Call the touch API to reset last_activity_at server-side (throttled). */
  const touchServer = useCallback(() => {
    const now = Date.now();
    if (now - lastTouchRef.current < SESSION_TOUCH_THROTTLE_MS) return;
    lastTouchRef.current = now;

    fetch("/api/auth/session/touch", {
      method: "POST",
      credentials: "include"
    }).catch(() => {
      // Best-effort — if the server rejects, the next check tick will handle it.
    });
  }, []);

  /** Record user activity (called from DOM event listeners). */
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();

    // Broadcast activity to other tabs.
    try {
      broadcastRef.current?.postMessage({
        type: "activity",
        timestamp: lastActivityRef.current
      } satisfies BroadcastActivity);
    } catch {
      // Channel may be closed.
    }

    // Touch the server (throttled).
    touchServer();
  }, [touchServer]);

  /** Perform logout due to session expiration. */
  const performLogout = useCallback(
    (reason: "session_expired" | "session_inactive") => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      void clearAuthAndRedirect(reason);
    },
    []
  );

  /** Dismiss the warning modal and reset the inactivity timer. */
  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    lastActivityRef.current = Date.now();
    touchServer();

    // Broadcast to other tabs.
    try {
      broadcastRef.current?.postMessage({
        type: "warning_dismissed",
        timestamp: Date.now()
      } satisfies BroadcastWarningDismissed);
    } catch {
      // Channel may be closed.
    }
  }, [touchServer]);

  // --------------- main check loop -----------------------------------------

  useEffect(() => {
    if (!config) return;

    // ---- BroadcastChannel setup ----
    try {
      broadcastRef.current = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
      broadcastRef.current.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;

        switch (msg.type) {
          case "activity":
            // Another tab had user activity — update our last-activity timestamp
            // so we don't show a warning while the user is active elsewhere.
            if (msg.timestamp > lastActivityRef.current) {
              lastActivityRef.current = msg.timestamp;
              if (showWarning) setShowWarning(false);
            }
            break;

          case "logout":
            // Another tab logged out — follow suit.
            performLogout(
              (msg.reason as "session_expired" | "session_inactive") || "session_expired"
            );
            break;

          case "warning_dismissed":
            // Another tab dismissed the warning — hide it here too.
            if (msg.timestamp > lastActivityRef.current) {
              lastActivityRef.current = msg.timestamp;
            }
            setShowWarning(false);
            break;
        }
      };
    } catch {
      // BroadcastChannel not available — single-tab mode.
    }

    // ---- DOM activity listeners ----
    let activityRafId: number | null = null;
    let lastDomEvent = 0;

    function onDomActivity() {
      const now = Date.now();
      if (now - lastDomEvent < SESSION_ACTIVITY_THROTTLE_MS) return;
      lastDomEvent = now;

      // Use rAF to avoid blocking the main thread.
      if (activityRafId !== null) cancelAnimationFrame(activityRafId);
      activityRafId = requestAnimationFrame(() => {
        recordActivity();
        activityRafId = null;
      });
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    for (const evt of events) {
      window.addEventListener(evt, onDomActivity, { passive: true });
    }

    // ---- Periodic check timer (every 10 seconds) ----
    function checkTimeouts() {
      const now = Date.now();
      const cfg = configRef.current;

      // 1. Absolute timeout — hard cap, cannot be extended.
      if (now >= cfg.absoluteExpiresAt) {
        performLogout("session_expired");
        return;
      }

      // 2. Inactivity timeout.
      const idleMs = now - lastActivityRef.current;
      const timeUntilInactivityExpiry = cfg.inactivityTimeoutMs - idleMs;

      if (timeUntilInactivityExpiry <= 0) {
        performLogout("session_inactive");
        return;
      }

      // 3. Warning threshold — show modal when within warningBeforeMs of expiry.
      //    Also check absolute expiry for the warning.
      const timeUntilAbsoluteExpiry = cfg.absoluteExpiresAt - now;
      const minTimeUntilExpiry = Math.min(timeUntilInactivityExpiry, timeUntilAbsoluteExpiry);

      if (minTimeUntilExpiry <= cfg.warningBeforeMs && minTimeUntilExpiry > 0) {
        setShowWarning(true);
        setWarningSecondsLeft(Math.ceil(minTimeUntilExpiry / 1000));
      } else {
        setShowWarning(false);
      }
    }

    checkTimerRef.current = setInterval(checkTimeouts, 10_000);
    // Run immediately on mount.
    checkTimeouts();

    // ---- Cleanup ----
    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, onDomActivity);
      }
      if (activityRafId !== null) cancelAnimationFrame(activityRafId);
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
      if (warningTimerRef.current) clearInterval(warningTimerRef.current);
      try {
        broadcastRef.current?.close();
      } catch {
        // Ignore.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.absoluteExpiresAt, config?.inactivityTimeoutMs, config?.warningBeforeMs]);

  // --------------- warning countdown timer ---------------------------------

  useEffect(() => {
    if (!showWarning) {
      if (warningTimerRef.current) {
        clearInterval(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      return;
    }

    // Tick every second to update the countdown.
    warningTimerRef.current = setInterval(() => {
      const now = Date.now();
      const cfg = configRef.current;

      const idleMs = now - lastActivityRef.current;
      const timeUntilInactivityExpiry = cfg.inactivityTimeoutMs - idleMs;
      const timeUntilAbsoluteExpiry = cfg.absoluteExpiresAt - now;
      const minRemaining = Math.min(timeUntilInactivityExpiry, timeUntilAbsoluteExpiry);

      if (minRemaining <= 0) {
        performLogout(
          timeUntilAbsoluteExpiry <= 0 ? "session_expired" : "session_inactive"
        );
        return;
      }

      setWarningSecondsLeft(Math.ceil(minRemaining / 1000));
    }, 1000);

    return () => {
      if (warningTimerRef.current) {
        clearInterval(warningTimerRef.current);
        warningTimerRef.current = null;
      }
    };
  }, [showWarning, performLogout]);

  return { showWarning, warningSecondsLeft, dismissWarning };
}
