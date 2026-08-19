"use client";

/**
 * Storage helpers for General Admin page.
 * Uses sessionStorage (with localStorage backup) to ensure execution results,
 * animations, queries, and tab states survive page navigation and full page reloads.
 */

export function saveSessionData<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(data);
    sessionStorage.setItem(key, serialized);
    try {
      localStorage.setItem(key, serialized);
    } catch {
      // Ignore localStorage quotas/issues
    }
  } catch (err) {
    console.warn(`[GeneralAdmin] Failed to save session data for key "${key}":`, err);
  }
}

export function loadSessionData<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const sessionVal = sessionStorage.getItem(key);
    if (sessionVal !== null) {
      return JSON.parse(sessionVal) as T;
    }
    const localVal = localStorage.getItem(key);
    if (localVal !== null) {
      return JSON.parse(localVal) as T;
    }
  } catch (err) {
    console.warn(`[GeneralAdmin] Failed to load session data for key "${key}":`, err);
  }
  return fallback;
}

export function removeSessionData(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}
