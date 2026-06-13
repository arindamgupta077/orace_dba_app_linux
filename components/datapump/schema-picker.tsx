"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckSquare, ChevronDown, Loader2, RefreshCw, Search, Square, Tags } from "lucide-react";
import { executeDBAAction } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";

interface SchemaPickerProps {
  selected: string[];
  onChange: (schemas: string[]) => void;
  className?: string;
}

export function SchemaPicker({ selected, onChange, className }: SchemaPickerProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [open, setOpen] = useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchSchemas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await executeDBAAction("schema_list", selectedDb, {});

      // Prefer raw_data.schemas (string[]) if n8n populates it directly
      const rawSchemas = result?.raw_data?.schemas as string[] | undefined;
      if (rawSchemas && rawSchemas.length > 0) {
        setSchemas(rawSchemas);
        return;
      }

      // Fallback: n8n returns rows as [{USERNAME: "HR"}, ...] inside raw_data.rows
      const rawRows = result?.raw_data?.rows as Array<Record<string, unknown>> | undefined;
      if (rawRows && rawRows.length > 0) {
        const names = rawRows
          .map((r) => (r["USERNAME"] ?? r["username"] ?? r["SCHEMA_NAME"] ?? r["schema_name"]) as string | undefined)
          .filter((s): s is string => typeof s === "string" && s.length > 0);
        setSchemas(names);
        return;
      }

      setSchemas([]);
    } catch {
      setError("Failed to load schemas. Check n8n connection.");
    } finally {
      setLoading(false);
    }
  }, [selectedDb]);

  useEffect(() => {
    if (open && schemas.length === 0 && !loading) {
      fetchSchemas();
    }
  }, [open, schemas.length, loading, fetchSchemas]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = schemas.filter((s) => s.toLowerCase().includes(search.toLowerCase()));

  const toggle = (schema: string) => {
    if (selected.includes(schema)) {
      onChange(selected.filter((s) => s !== schema));
    } else {
      onChange([...selected, schema]);
    }
  };

  const selectAll = () => onChange(filtered);
  const clearAll = () => onChange([]);

  return (
    <div className={cn("relative", className)} ref={popoverRef}>
      {/* Trigger button */}
      <button
        type="button"
        id="schema-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border bg-background/40 px-3 py-2 text-sm transition-colors",
          open ? "border-violet-400/50 ring-1 ring-violet-400/30" : "border-border/60 hover:border-border"
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">Select schemas…</span>
          ) : (
            selected.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[11px] font-mono font-medium text-violet-300"
              >
                {s}
              </span>
            ))
          )}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-hidden rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur-xl">
          {/* Header */}
          <div className="border-b border-border/50 p-2">
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                placeholder="Search schemas…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                onClick={fetchSchemas}
                disabled={loading}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
                Refresh
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={selectAll} className="text-violet-400 hover:text-violet-300">
                  Select all
                </button>
                <span className="text-border">|</span>
                <button type="button" onClick={clearAll} className="text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* List */}
          <div className="max-h-44 overflow-y-auto p-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching schemas from database…
              </div>
            ) : error ? (
              <div className="py-4 text-center text-xs text-red-400">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {search ? "No schemas match your search" : "No schemas returned"}
              </div>
            ) : (
              filtered.map((schema) => {
                const active = selected.includes(schema);
                return (
                  <button
                    key={schema}
                    type="button"
                    onClick={() => toggle(schema)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-xs transition-colors hover:bg-secondary/50",
                      active && "bg-violet-400/8"
                    )}
                  >
                    {active ? (
                      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                    ) : (
                      <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className={cn("font-mono", active ? "text-violet-200" : "text-foreground")}>{schema}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {selected.length > 0 && (
            <div className="border-t border-border/50 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-violet-300">
                <Tags className="h-3 w-3" />
                {selected.length} schema{selected.length !== 1 ? "s" : ""} selected
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
