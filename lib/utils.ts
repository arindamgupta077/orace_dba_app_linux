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
