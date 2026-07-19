"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  Search,
  XCircle
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDbaAction } from "@/hooks/use-dba-action";

interface InvalidObjectRow {
  owner: string;
  object_type: string;
  object_name: string;
  status: string;
  last_modified: string;
}

const PAGE_SIZE = 15;

function safeStr(v: unknown, fallback = ""): string {
  return v != null ? String(v) : fallback;
}

function field<T = unknown>(row: Record<string, unknown>, key: string): T {
  return (row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]) as T;
}

function parseRows(rawData: unknown): InvalidObjectRow[] {
  if (!rawData || typeof rawData !== "object") return [];

  const data = rawData as Record<string, unknown>;
  let rows: unknown[] = [];

  if (Array.isArray(data.rows)) rows = data.rows;
  else if (Array.isArray(data.data)) rows = data.data;
  else if (Array.isArray(data.items)) rows = data.items;
  else if (Array.isArray(rawData)) rows = rawData as unknown[];

  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      owner: safeStr(field(r, "owner")),
      object_type: safeStr(field(r, "object_type")),
      object_name: safeStr(field(r, "object_name")),
      status: safeStr(field(r, "status")),
      last_modified: safeStr(field(r, "last_modified"))
    }))
    .filter((r) => r.object_name); // filter phantom rows
}

function objectTypeBadgeColor(type: string): string {
  const t = type.toUpperCase();
  if (t.includes("PACKAGE")) return "border-violet-400/30 bg-violet-400/10 text-violet-300";
  if (t.includes("TRIGGER")) return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  if (t === "VIEW") return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
  if (t.includes("PROCEDURE") || t.includes("FUNCTION")) return "border-blue-400/30 bg-blue-400/10 text-blue-300";
  if (t === "SYNONYM") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  return "border-slate-400/20 bg-slate-400/10 text-slate-300";
}

export function InvalidObjectsModal({
  open,
  onClose,
  selectedDb
}: {
  open: boolean;
  onClose: () => void;
  selectedDb: string;
}) {
  const { runAction } = useDbaAction();
  const [allRows, setAllRows] = useState<InvalidObjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(1);
    setSearch("");
    try {
      const result = await runAction("invalid_obejcts", {}, selectedDb);
      if (result) {
        let parsed = parseRows(result.raw_data);
        if (parsed.length === 0 && result.raw_output) {
          try {
            parsed = parseRows(JSON.parse(result.raw_output));
          } catch {
            // raw_output is not JSON
          }
        }
        setAllRows(parsed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch invalid objects.");
    } finally {
      setLoading(false);
    }
  }, [runAction, selectedDb]);

  useEffect(() => {
    if (open) {
      fetchData();
    } else {
      setAllRows([]);
      setError(null);
      setPage(1);
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Filter rows by search term
  const filteredRows = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter(
      (r) =>
        r.owner.toLowerCase().includes(q) ||
        r.object_type.toLowerCase().includes(q) ||
        r.object_name.toLowerCase().includes(q)
    );
  }, [allRows, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(startIdx, startIdx + PAGE_SIZE);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  // Group counts by type for summary
  const typeSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allRows) {
      const key = r.object_type || "UNKNOWN";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [allRows]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="rounded-lg border border-violet-400/20 bg-violet-400/10 p-1.5">
              <Layers className="h-4 w-4 text-violet-300" />
            </div>
            Invalid Objects
          </DialogTitle>
          <DialogDescription>
            All invalid objects in <span className="font-semibold text-cyan-300">{selectedDb}</span> — ordered by owner, object type, and name.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            <p className="text-sm text-muted-foreground">Fetching invalid objects from n8n…</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
            <XCircle className="h-5 w-5 flex-shrink-0" />
            {error}
          </div>
        ) : allRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 p-3">
              <Layers className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-300">No invalid objects found</p>
            <p className="text-xs text-muted-foreground">All database objects are valid.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-400/20 bg-slate-400/10 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                Total: {allRows.length}
              </span>
              {typeSummary.map(([type, count]) => (
                <span
                  key={type}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${objectTypeBadgeColor(type)}`}
                >
                  {type}: {count}
                </span>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by owner, type, or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full min-w-[600px] text-xs">
                <thead>
                  <tr className="border-b border-border/50 bg-secondary/30">
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Owner</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Object Type</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Object Name</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Last Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr
                      key={`${row.owner}-${row.object_type}-${row.object_name}-${startIdx + i}`}
                      className="border-b border-border/30 last:border-0 transition-colors hover:bg-secondary/20"
                    >
                      <td className="px-3 py-2 font-mono text-muted-foreground">{startIdx + i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-200">{row.owner}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${objectTypeBadgeColor(row.object_type)}`}>
                          {row.object_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-cyan-300">{row.object_name}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.last_modified || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                {search && ` (filtered from ${allRows.length})`}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-xs font-medium text-muted-foreground">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
