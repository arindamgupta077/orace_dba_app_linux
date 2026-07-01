"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "dba-theme";
const DARK_CLASS = "dark";

interface ThemeContextValue {
  theme: Theme;
  /** Whether the theme has been hydrated from persistence (avoids SSR mismatch flicker). */
  hydrated: boolean;
  setTheme: (theme: Theme, options?: { persistRemote?: boolean; skipLocal?: boolean }) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add(DARK_CLASS);
  else root.classList.remove(DARK_CLASS);
  root.style.colorScheme = theme;
}

function readLocalTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return "dark";
}

function writeLocalTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/first-login-reset"];

function isAuthPage(): boolean {
  if (typeof window === "undefined") return false;
  return AUTH_PATHS.includes(window.location.pathname);
}

interface ThemeProviderProps {
  children: ReactNode;
  /** Theme to render before hydration resolves (must match the no-flash inline script). */
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = "dark" }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [hydrated, setHydrated] = useState(false);
  // Tracks the most recent theme pushed to the remote API so we don't
  // fire duplicate PUTs for the same value (e.g. when the session load
  // echoes back the value we just stored locally).
  const lastRemoteRef = useRef<Theme | null>(null);

  // Hydrate from localStorage on first client render.
  // Auth pages (login, forgot-password, etc.) are always dark — skip
  // the localStorage read so there's no flash when the login page
  // effect forces dark mode.  This matches the no-flash inline script
  // in layout.tsx which also forces dark on auth pages.
  useEffect(() => {
    const local = isAuthPage() ? "dark" : readLocalTheme();
    setThemeState(local);
    applyThemeClass(local);
    setHydrated(true);
  }, []);

  const persistRemote = useCallback(async (next: Theme) => {
    if (lastRemoteRef.current === next) return;
    lastRemoteRef.current = next;
    try {
      await fetch("/api/preferences/theme", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next })
      });
    } catch {
      // Network/DB errors are non-fatal — local preference still wins.
      lastRemoteRef.current = null;
    }
  }, []);

  const setTheme = useCallback<ThemeContextValue["setTheme"]>(
    (next, options) => {
      setThemeState(next);
      applyThemeClass(next);
      if (!options?.skipLocal) {
        writeLocalTheme(next);
      }
      if (options?.persistRemote !== false) {
        void persistRemote(next);
      }
    },
    [persistRemote]
  );

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyThemeClass(next);
      writeLocalTheme(next);
      void persistRemote(next);
      return next;
    });
  }, [persistRemote]);

  // Server-side preference restoration is handled by AppShell after the
  // session is fetched (so it runs on every post-login navigation, not
  // just once on first hydration).  This avoids the login page
  // accidentally overriding the user's saved preference.

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, hydrated, setTheme, toggleTheme }),
    [theme, hydrated, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
