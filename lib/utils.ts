import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { APP_LOCALE, APP_TIMEZONE } from "@/lib/constants";

// Hardcoded fallbacks — ensure IST is ALWAYS used even if the module import
// resolves to undefined due to Next.js module-cache ordering.
const LOCALE: string = APP_LOCALE ?? "en-IN";
const TIMEZONE: string = APP_TIMEZONE ?? "Asia/Kolkata";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits
  }).format(value);
}

/** Oracle TO_CHAR timestamps and other naive ISO strings are UTC wall time without offset. */
export function parseAppTimestamp(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);

  const trimmed = value.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return new Date(`${trimmed}Z`);
  }
  return new Date(trimmed);
}

export function formatDateTime(value: string | number | Date) {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIMEZONE
  }).format(parseAppTimestamp(value));
}

export function formatTime(value: string | number | Date) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeStyle: "short",
    timeZone: TIMEZONE
  }).format(parseAppTimestamp(value));
}

export function formatAppDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: TIMEZONE
    }).format(parseAppTimestamp(value));
  } catch {
    return String(value);
  }
}

export function formatIstIsoString(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "";
  try {
    const date = parseAppTimestamp(value);
    const offsetMs = 330 * 60 * 1000; // +5:30
    const istDate = new Date(date.getTime() + offsetMs);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())}T${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:${pad(istDate.getUTCSeconds())}+05:30`;
  } catch {
    return String(value);
  }
}


/**
 * Returns the IST calendar date (YYYY-MM-DD) for the given Date (or now).
 * Works on the client regardless of the browser's local timezone.
 */
export function toIstDateString(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const istMs = date.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/**
 * Returns the IST calendar date (YYYY-MM-DD) for `date` offset by `deltaDays`.
 */
export function toIstDateStringOffset(date: Date = new Date(), deltaDays: number): string {
  const shifted = new Date(date.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return toIstDateString(shifted);
}

/**
 * Auto-selects the daily-checklist shift number (1, 2 or 3) based on the
 * current IST time. Mirrors the login auto-select thresholds:
 *   - after 06:00  → Shift 1
 *   - after 12:00  → Shift 2
 *   - after 21:00  → Shift 3
 *   - 00:00–05:59  → Shift 3 (previous night shift, wraps midnight)
 * Works on the client regardless of the browser's local timezone.
 */
export function getDefaultShiftForTime(date: Date = new Date()): "1" | "2" | "3" {
  const istMs = date.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const minuteOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();

  if (minuteOfDay >= 7 * 60 && minuteOfDay < 14 * 60 + 30) return "1";
  if (minuteOfDay >= 14 * 60 + 30 && minuteOfDay < 22 * 60 + 30) return "2";
  return "3";
}

export function titleCase(value?: string | null) {
  const text = value || "unknown";
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function toCsv<T extends object>(rows: T[]) {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row as Record<string, unknown>).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape((row as Record<string, unknown>)[header])).join(","))].join("\n");
}

export function downloadText(filename: string, content: string, type = "text/plain") {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
