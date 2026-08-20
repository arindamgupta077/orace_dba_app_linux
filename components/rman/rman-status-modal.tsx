"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  FilterX,
  Loader2,
  Search,
  X,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useDbaAction } from "@/hooks/use-dba-action";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { BackupRow } from "@/types/dba";

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */

function toLocalDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Extended backup row (status query returns extra fields from n8n)     */
/* ------------------------------------------------------------------ */

interface ExtendedBackupRow extends BackupRow {
  output_bytes?: string;
  input_bytes?: string;
  device_type?: string;
}

/* ------------------------------------------------------------------ */
/* Backup status results table                                           */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-400/10",
  FAILED:  "text-red-700 dark:text-red-300 border-red-500/30 bg-red-500/10",
  RUNNING: "text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10"
};

function BackupStatusTable({ rows }: { rows: ExtendedBackupRow[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "SUCCESS" | "RUNNING" | "FAILED">("ALL");

  const failedCount  = useMemo(() => rows.filter((r) => r.status?.toUpperCase() === "FAILED").length, [rows]);
  const runningCount = useMemo(() => rows.filter((r) => r.status?.toUpperCase() === "RUNNING").length, [rows]);
  const successCount = useMemo(() => rows.filter((r) => r.status?.toUpperCase() === "SUCCESS").length, [rows]);

  // Reset to first page when search query, filter, page size, or rows change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, pageSize, rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const rowStatus = (row.status || "").toUpperCase();
      if (statusFilter !== "ALL" && rowStatus !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const typeMatch = (row.type || "").toLowerCase().includes(q);
        const statusMatch = (row.status || "").toLowerCase().includes(q);
        const startedMatch = (row.started_at || "").toLowerCase().includes(q);
        const deviceMatch = (row.device_type || "").toLowerCase().includes(q);
        const outputMatch = (row.output_bytes || "").toLowerCase().includes(q);
        if (!typeMatch && !statusMatch && !startedMatch && !deviceMatch && !outputMatch) {
          return false;
        }
      }
      return true;
    });
  }, [rows, statusFilter, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRows = filteredRows.slice(startIndex, startIndex + pageSize);

  const isFiltered = statusFilter !== "ALL" || searchQuery.trim().length > 0;

  return (
    <div className="space-y-3.5">
      {/* Filter & Summary Header */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Summary / Filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-all",
              statusFilter === "ALL"
                ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-sm"
                : "border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
            )}
          >
            All ({rows.length})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter((curr) => (curr === "SUCCESS" ? "ALL" : "SUCCESS"))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-all",
              statusFilter === "SUCCESS"
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shadow-sm ring-1 ring-emerald-500/30"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {successCount} Successful
          </button>

          {runningCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter((curr) => (curr === "RUNNING" ? "ALL" : "RUNNING"))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-all",
                statusFilter === "RUNNING"
                  ? "border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-300 shadow-sm ring-1 ring-amber-500/30"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
              )}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" />
              {runningCount} Running
            </button>
          )}

          {failedCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter((curr) => (curr === "FAILED" ? "ALL" : "FAILED"))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-all",
                statusFilter === "FAILED"
                  ? "border-red-500/50 bg-red-500/20 text-red-700 dark:text-red-300 shadow-sm ring-1 ring-red-500/30"
                  : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20"
              )}
            >
              <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              {failedCount} Failed
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search backups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 pr-8 text-xs bg-background/50 border-border/60"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table / Empty State */}
      {paginatedRows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-background/40 shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/50 font-medium text-muted-foreground">
                <th className="px-3.5 py-2.5 text-left font-semibold">Type</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Start Time</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Duration</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Compression</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Output Size</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Device</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row, i) => (
                <tr
                  key={`${row.id || row.started_at}-${i}`}
                  className={cn(
                    "border-b border-border/30 last:border-0 transition-colors hover:bg-secondary/30",
                    row.status === "FAILED" && "bg-red-500/10 dark:bg-red-500/5 hover:bg-red-500/15"
                  )}
                >
                  <td className="px-3.5 py-2.5 font-mono font-semibold text-foreground">{row.type}</td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        STATUS_STYLE[row.status] || "text-slate-700 dark:text-slate-300 border-slate-400/25 bg-slate-400/10"
                      )}
                    >
                      {row.status === "FAILED" && <XCircle className="h-3 w-3" />}
                      {row.status === "SUCCESS" && <CheckCircle2 className="h-3 w-3" />}
                      {row.status === "RUNNING" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 tabular-nums text-muted-foreground">{row.started_at}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.duration_min > 0 ? `${row.duration_min} min` : "—"}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.compression_ratio > 0 ? `${row.compression_ratio.toFixed(2)}x` : "—"}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.output_bytes || "—"}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">{row.device_type || "DISK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-8 text-center bg-secondary/10">
          <FilterX className="h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-medium text-foreground">No matching backups found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Try adjusting your search query or status filter.
          </p>
          {isFiltered && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("ALL");
              }}
              className="mt-3 h-7 text-xs border-border/60"
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Pagination Footer */}
      {filteredRows.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-1 text-xs">
          {/* Item count summary */}
          <div className="text-muted-foreground">
            Showing{" "}
            <strong className="text-foreground">{startIndex + 1}</strong> to{" "}
            <strong className="text-foreground">
              {Math.min(startIndex + pageSize, filteredRows.length)}
            </strong>{" "}
            of <strong className="text-foreground">{filteredRows.length}</strong>{" "}
            {filteredRows.length !== rows.length ? (
              <span className="text-muted-foreground/80">({rows.length} total)</span>
            ) : (
              "backup jobs"
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground hidden sm:inline">Per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-7 w-[70px] text-xs bg-background border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1 || filteredRows.length === 0}
                className="h-7 w-7 border-border/60"
                title="First Page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1 || filteredRows.length === 0}
                className="h-7 w-7 border-border/60"
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              <span className="px-2 font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                Page {currentPage} of {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages || filteredRows.length === 0}
                className="h-7 w-7 border-border/60"
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || filteredRows.length === 0}
                className="h-7 w-7 border-border/60"
                title="Last Page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                            */
/* ------------------------------------------------------------------ */

interface RmanStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RmanStatusModal({ open, onOpenChange }: RmanStatusModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const { runAction, status, response, error, setResponse } = useDbaAction();

  const [dateFrom, setDateFrom] = useState(toLocalDateString(-30));
  const [dateTo,   setDateTo]   = useState(toLocalDateString(0));

  /* ── Reset on open ── */
  useEffect(() => {
    if (open) {
      setDateFrom(toLocalDateString(-30));
      setDateTo(toLocalDateString(0));
      setResponse(null);
    }
  }, [open, setResponse]);

  const handleSubmit = async () => {
    const res = await runAction("backup_status", { date_from: dateFrom, date_to: dateTo }, selectedDb);
    if (res?.status === "success") {
      useAppStore.getState().completeRmanJobForDb(selectedDb);
    }
  };

  const isLoading = status === "loading";
  const isDone    = response !== null && !isLoading;

  const readField = (r: Record<string, unknown>, key: string): unknown =>
    r[key] ?? r[key.toUpperCase()] ?? r[key.toLowerCase()];
  const backupRows: ExtendedBackupRow[] = (((response?.raw_data?.backups as unknown as ExtendedBackupRow[] | undefined) ?? [])
    .map((r) => r as unknown as Record<string, unknown>)
    .filter((r) => {
      const startedAt = readField(r, "started_at") || readField(r, "start_time");
      const type      = readField(r, "type") || readField(r, "input_type");
      return Boolean(startedAt) && Boolean(type);
    }) as unknown as ExtendedBackupRow[]);

  const showResult = isDone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto transition-all", showResult ? "max-w-4xl" : "max-w-2xl")}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2">
              <Search className="h-5 w-5 text-cyan-600 dark:text-cyan-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">RMAN Backup Status</DialogTitle>
              <DialogDescription>
                Query <code className="font-mono font-semibold text-cyan-700 dark:text-cyan-300">V$RMAN_BACKUP_JOB_DETAILS</code> for a date range to review all backup jobs.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Post-run result view ── */}
        {showResult ? (
          <div className="space-y-4">
            {/* Status banner */}
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4",
                response?.status === "success"
                  ? "border-cyan-500/30 bg-cyan-500/10 text-foreground"
                  : "border-red-500/30 bg-red-500/10 text-foreground"
              )}
            >
              {response?.status === "success" ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <div>
                <p className="font-semibold text-foreground">
                  {response?.status === "success" ? "Query Completed" : "Query Failed"}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{response?.ai_summary}</p>
              </div>
            </div>

            {/* Backups table */}
            <BackupStatusTable rows={backupRows} />

            {/* Findings list if any */}
            {Boolean(response?.findings?.length) && (
              <div className="space-y-2 rounded-xl border bg-secondary/30 dark:bg-black/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Findings</p>
                {response!.findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <div>
                      <p className="font-medium text-foreground">{f.title}</p>
                      <p className="text-xs text-muted-foreground">{f.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Configuration view ── */
          <div className="space-y-5 pt-1">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Query Parameters
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rman-status-date-from" className="text-xs font-medium">Date From</Label>
                  <Input
                    id="rman-status-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rman-status-date-to" className="text-xs font-medium">Date To</Label>
                  <Input
                    id="rman-status-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>

              {/* Quick range helpers */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-muted-foreground">Quick Date Ranges:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Last 7 days",  from: -7  },
                    { label: "Last 30 days", from: -30 },
                    { label: "Last 60 days", from: -60 },
                    { label: "Last 90 days", from: -90 }
                  ].map(({ label, from }) => {
                    const isSelected = dateFrom === toLocalDateString(from) && dateTo === toLocalDateString(0);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          setDateFrom(toLocalDateString(from));
                          setDateTo(toLocalDateString(0));
                        }}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                          isSelected
                            ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-sm"
                            : "border-border/60 bg-background/40 text-muted-foreground hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-700 dark:hover:text-cyan-300"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3.5 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                  Oracle View Query Target:
                </p>
                <div className="font-mono text-cyan-900 dark:text-cyan-200/80 bg-secondary/60 dark:bg-black/30 p-2.5 rounded-lg border border-cyan-500/20 dark:border-cyan-400/10 space-y-0.5">
                  <div>SELECT * FROM V$RMAN_BACKUP_JOB_DETAILS</div>
                  <div className="text-cyan-700 dark:text-cyan-400/80 font-medium">WHERE START_TIME BETWEEN :date_from AND :date_to</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && !isDone && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-100">
            {error}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-cyan-800 dark:text-cyan-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-600 dark:text-cyan-400" />
            <p>Querying backup history from Oracle…</p>
          </div>
        )}

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Close
          </Button>
          {isDone ? (
            <Button
              onClick={() => setResponse(null)}
              variant="outline"
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              New Query
            </Button>
          ) : (
            <Button
              id="btn-execute-rman-status"
              onClick={handleSubmit}
              disabled={isLoading || !dateFrom || !dateTo}
              className="min-w-44 gap-2 bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Querying…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Check Status
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
