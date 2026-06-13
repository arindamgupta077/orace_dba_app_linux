"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { executeDBAAction } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { DbaAction, DbaResponse } from "@/types/dba";

/** Extract a flat string list from an n8n response (schemas, tablespace names, etc.) */
function extractStringList(res: DbaResponse, columnHint?: string): string[] {
  const schemas = res.raw_data?.schemas;
  if (Array.isArray(schemas) && schemas.length > 0) return schemas as string[];

  const rows = res.raw_data?.rows;
  if (Array.isArray(rows) && rows.length > 0) {
    return rows
      .map((row) => {
        if (columnHint && columnHint in row) return String(row[columnHint]);
        const values = Object.values(row as Record<string, unknown>);
        return values.length > 0 ? String(values[0] ?? "") : "";
      })
      .filter(Boolean);
  }

  const raw = res.raw_output;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (typeof item === "string") return item;
          const vals = Object.values(item as Record<string, unknown>);
          return String(vals[0] ?? "");
        }).filter(Boolean);
      }
    } catch {
      // Not JSON — not useful for dropdown
    }
  }

  return [];
}

export function useUserMgmt() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<DbaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Execute a user management DDL action and persist result. */
  const execute = useCallback(
    async (action: DbaAction, params: Record<string, unknown> = {}): Promise<DbaResponse> => {
      setExecuting(true);
      setError(null);
      setResult(null);
      try {
        const res = await executeDBAAction(action, selectedDb, params);
        setResult(res);
        if (res.status === "error") {
          toast.error("Action failed", { description: res.ai_summary || "n8n reported an error." });
        } else {
          toast.success("Action completed", { description: res.ai_summary || "Operation succeeded." });
        }
        return res;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unexpected failure";
        setError(message);
        toast.error("Webhook request failed", { description: message });
        throw e;
      } finally {
        setExecuting(false);
      }
    },
    [selectedDb]
  );

  /** Load a list of values from n8n for dropdown population (fire-and-forget, no global state change). */
  const loadDropdown = useCallback(
    async (
      action: DbaAction,
      params: Record<string, unknown> = {},
      columnHint?: string
    ): Promise<string[]> => {
      try {
        const res = await executeDBAAction(action, selectedDb, params);
        return extractStringList(res, columnHint);
      } catch {
        return [];
      }
    },
    [selectedDb]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    execute,
    loadDropdown,
    executing,
    result,
    error,
    reset,
    selectedDb
  };
}
