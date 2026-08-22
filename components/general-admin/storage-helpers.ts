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

export interface StorageStats {
  generalAdminSessionKeys: number;
  generalAdminLocalKeys: number;
  totalSessionKeys: number;
  totalLocalKeys: number;
  generalAdminEstimatedSizeKb: number;
  totalEstimatedSizeKb: number;
}

/**
 * Calculates current storage metrics for General Admin and the entire browser storage.
 */
export function getStorageStats(): StorageStats {
  if (typeof window === "undefined") {
    return {
      generalAdminSessionKeys: 0,
      generalAdminLocalKeys: 0,
      totalSessionKeys: 0,
      totalLocalKeys: 0,
      generalAdminEstimatedSizeKb: 0,
      totalEstimatedSizeKb: 0
    };
  }

  let generalAdminSessionKeys = 0;
  let generalAdminLocalKeys = 0;
  let generalAdminBytes = 0;
  let totalBytes = 0;

  try {
    // SessionStorage inspection
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k) {
        const val = sessionStorage.getItem(k) || "";
        const itemBytes = (k.length + val.length) * 2;
        totalBytes += itemBytes;
        if (k.startsWith("general_admin_")) {
          generalAdminSessionKeys++;
          generalAdminBytes += itemBytes;
        }
      }
    }

    // LocalStorage inspection
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        const val = localStorage.getItem(k) || "";
        const itemBytes = (k.length + val.length) * 2;
        totalBytes += itemBytes;
        if (k.startsWith("general_admin_")) {
          generalAdminLocalKeys++;
          generalAdminBytes += itemBytes;
        }
      }
    }
  } catch (err) {
    console.warn("[GeneralAdmin] Failed to compute storage stats:", err);
  }

  return {
    generalAdminSessionKeys,
    generalAdminLocalKeys,
    totalSessionKeys: typeof sessionStorage !== "undefined" ? sessionStorage.length : 0,
    totalLocalKeys: typeof localStorage !== "undefined" ? localStorage.length : 0,
    generalAdminEstimatedSizeKb: Math.round((generalAdminBytes / 1024) * 10) / 10,
    totalEstimatedSizeKb: Math.round((totalBytes / 1024) * 10) / 10
  };
}

/**
 * Clears only General Administration items from sessionStorage and localStorage.
 * Broadcasts a 'general-admin-storage-cleared' custom event so mounted components
 * immediately reset their UI/state.
 */
export function clearGeneralAdminStorage(): { clearedKeysCount: number } {
  if (typeof window === "undefined") return { clearedKeysCount: 0 };
  let count = 0;

  try {
    // 1. Session Storage keys
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("general_admin_")) {
        sessionKeysToRemove.push(key);
      }
    }
    for (const key of sessionKeysToRemove) {
      sessionStorage.removeItem(key);
      count++;
    }

    // 2. Local Storage keys
    const localKeysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("general_admin_")) {
        localKeysToRemove.push(key);
      }
    }
    for (const key of localKeysToRemove) {
      localStorage.removeItem(key);
      count++;
    }

    // 3. Dispatch storage-cleared custom event
    window.dispatchEvent(
      new CustomEvent("general-admin-storage-cleared", {
        detail: { scope: "general-admin", clearedKeysCount: count }
      })
    );
  } catch (err) {
    console.warn("[GeneralAdmin] Error clearing general admin storage:", err);
  }

  return { clearedKeysCount: count };
}

export interface ClearAllOptions {
  preserveTheme?: boolean;
  preserveAuth?: boolean;
}

/**
 * Clears all sessionStorage and localStorage across the application.
 * Options allow preserving UI theme and auth tokens if desired.
 */
export function clearAllBrowserStorage(options: ClearAllOptions = { preserveTheme: true, preserveAuth: true }): { clearedKeysCount: number } {
  if (typeof window === "undefined") return { clearedKeysCount: 0 };
  let count = 0;

  try {
    // 1. Count and clear sessionStorage
    count += sessionStorage.length;
    sessionStorage.clear();

    // 2. LocalStorage with preservation logic
    const themeVal = options.preserveTheme !== false ? localStorage.getItem("dba-theme") : null;
    const authVal = options.preserveAuth !== false ? localStorage.getItem("oracle_dba_auth") : null;

    count += localStorage.length;
    localStorage.clear();

    if (themeVal) {
      localStorage.setItem("dba-theme", themeVal);
    }
    if (authVal) {
      localStorage.setItem("oracle_dba_auth", authVal);
    }

    // 3. Dispatch events to notify all listening components
    window.dispatchEvent(
      new CustomEvent("general-admin-storage-cleared", {
        detail: { scope: "all", clearedKeysCount: count }
      })
    );
    window.dispatchEvent(
      new CustomEvent("dba-storage-cleared", {
        detail: { scope: "all", clearedKeysCount: count }
      })
    );
  } catch (err) {
    console.warn("[GeneralAdmin] Error clearing all browser storage:", err);
  }

  return { clearedKeysCount: count };
}
