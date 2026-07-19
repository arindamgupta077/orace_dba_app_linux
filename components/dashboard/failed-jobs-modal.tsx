"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useDbaAction } from "@/hooks/use-dba-action";

interface FailedJobRow {
  owner: string;
  job_name: string;
  failed_count: number;
  last_failure: string;
}

function safeStr(v: unknown, fallback = ""): string {
  return v != null ? String(v) : fallback;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function field<T = unknown>(row: Record<string, unknown>, key: string): T {
  return (row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]) as T;
}

function parseRows(rawData: unknown): FailedJobRow[] {
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
      job_name: safeStr(field(r, "job_name")),
      failed_count: safeNum(field(r, "failed_count")),
      last_failure: safeStr(field(r, "last_failure"))
    }))
    .filter((r) => r.job_name); // filter phantom rows
}

function formatDateTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function FailedJobsModal({
  open,
  onClose,
  selectedDb
}: {
  open: boolean;
  onClose: () => void;
  selectedDb: string;
}) {
  const { runAction } = useDbaAction();
  const [rows, setRows] = useState<FailedJobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await runAction("fetch_failed_jobs", {}, selectedDb);
      if (result) {
        // Try raw_data first, then raw_output as JSON fallback
        let parsed = parseRows(result.raw_data);
        if (parsed.length === 0 && result.raw_output) {
          try {
            parsed = parseRows(JSON.parse(result.raw_output));
          } catch {
            // raw_output is not JSON
          }
        }
        setRows(parsed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch failed jobs.");
    } finally {
      setLoading(false);
    }
  }, [runAction, selectedDb]);

  useEffect(() => {
    if (open) {
      fetchData();
    } else {
      setRows([]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
            </div>
            Failed Scheduler Jobs
          </DialogTitle>
          <DialogDescription>
            Top 10 failed scheduler jobs for <span className="font-semibold text-cyan-300">{selectedDb}</span> — grouped by owner and job name, ordered by failure count.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            <p className="text-sm text-muted-foreground">Fetching failed jobs from n8n…</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
            <XCircle className="h-5 w-5 flex-shrink-0" />
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 p-3">
              <AlertTriangle className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-300">No failed jobs found</p>
            <p className="text-xs text-muted-foreground">All scheduler jobs are running successfully.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full min-w-[550px] text-xs">
              <thead>
                <tr className="border-b border-border/50 bg-secondary/30">
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">#</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Owner</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Job Name</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Failed Count</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Last Failure</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={`${row.owner}-${row.job_name}-${i}`}
                    className="border-b border-border/30 last:border-0 transition-colors hover:bg-secondary/20"
                  >
                    <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-200">{row.owner}</td>
                    <td className="px-3 py-2 font-mono text-cyan-300">{row.job_name}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${
                        row.failed_count >= 10
                          ? "border-red-400/30 bg-red-500/10 text-red-300"
                          : row.failed_count >= 5
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                            : "border-slate-400/20 bg-slate-400/10 text-slate-300"
                      }`}>
                        {row.failed_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(row.last_failure)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
