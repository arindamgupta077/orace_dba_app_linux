"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Layers,
  Loader2,
  Search,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const failed  = rows.filter((r) => r.status === "FAILED").length;
  const running = rows.filter((r) => r.status === "RUNNING").length;
  const success = rows.filter((r) => r.status === "SUCCESS").length;

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {success} Successful
        </span>
        {running > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-medium text-amber-700 dark:text-amber-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" />
            {running} Running
          </span>
        )}
        {failed > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 font-medium text-red-700 dark:text-red-300">
            <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            {failed} Failed
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1 text-muted-foreground">
          Total: {rows.length} jobs
        </span>
      </div>

      {/* Table */}
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
            {rows.map((row, i) => (
              <tr
                key={`${row.id}-${i}`}
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
  const databases = useAppStore((s) => s.databases);
  const user = useAppStore((s) => s.user);
  const { runAction, status, response, error, setResponse } = useDbaAction();

  const [dateFrom, setDateFrom] = useState(toLocalDateString(-30));
  const [dateTo,   setDateTo]   = useState(toLocalDateString(0));
  const [tab,      setTab]      = useState<"form" | "json">("form");
  const [rawJson,  setRawJson]  = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const dbTarget = useMemo(() => databases.find((db) => db.name === selectedDb), [databases, selectedDb]);

  const fullPayload = useMemo(
    () => ({
      action: "backup_status",
      db: selectedDb,
      params: { date_from: dateFrom, date_to: dateTo },
      requested_by: user?.username?.toUpperCase() || "ARINDAM",
      user_id: user?.userId ?? 1,
      environment: dbTarget?.env_label ?? "PROD",
      os: dbTarget?.os ?? "Linux",
      db_type: dbTarget?.db_type ?? "Standalone"
    }),
    [dateFrom, dateTo, selectedDb, user, dbTarget]
  );

  /* ── Sync rawJson when form changes ── */
  useEffect(() => {
    if (tab === "json") {
      setRawJson(JSON.stringify(fullPayload, null, 2));
    }
  }, [fullPayload, tab]);

  /* ── Reset on open ── */
  useEffect(() => {
    if (open) {
      setDateFrom(toLocalDateString(-30));
      setDateTo(toLocalDateString(0));
      setTab("form");
      setJsonError(null);
      setResponse(null);
    }
  }, [open, setResponse]);

  const handleTabChange = (value: string) => {
    const next = value as "form" | "json";
    setTab(next);
    if (next === "json") {
      setRawJson(JSON.stringify(fullPayload, null, 2));
      setJsonError(null);
    }
  };

  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(rawJson) as typeof fullPayload;
      if (parsed.params) {
        setDateFrom(String(parsed.params.date_from ?? dateFrom));
        setDateTo(String(parsed.params.date_to ?? dateTo));
      }
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON — please fix syntax errors before switching tabs.");
    }
  };

  const handleSubmit = async () => {
    if (tab === "json") {
      try {
        const parsed = JSON.parse(rawJson) as typeof fullPayload;
        const resolvedParams = { date_from: String(parsed.params?.date_from ?? dateFrom), date_to: String(parsed.params?.date_to ?? dateTo) };
        const res = await runAction("backup_status", resolvedParams, selectedDb);
        if (res?.status === "success") {
          useAppStore.getState().completeRmanJobForDb(selectedDb);
        }
        return;
      } catch {
        setJsonError("Invalid JSON — cannot submit.");
        return;
      }
    }
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
                  {response?.status === "success" ? "Backup Status Retrieved" : "Query Failed"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{response?.ai_summary}</p>
              </div>
            </div>

            {/* Results table */}
            {backupRows.length > 0 ? (
              <BackupStatusTable rows={backupRows} />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
                No backup found in the selected time period.
              </div>
            )}

            {/* Failed job findings */}
            {(response?.findings ?? []).length > 0 && (
              <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">Failed Jobs</p>
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
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="form" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Form Editor
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                Raw JSON
              </TabsTrigger>
            </TabsList>

            {/* ── Form tab ── */}
            <TabsContent value="form" className="mt-4 space-y-5">
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
            </TabsContent>

            {/* ── Raw JSON tab ── */}
            <TabsContent value="json" className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Edit Payload JSON Directly
                </p>
                <button
                  type="button"
                  onClick={applyRawJson}
                  className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 transition-colors"
                >
                  ↩ Apply to Form
                </button>
              </div>
              <textarea
                id="rman-status-raw-json"
                value={rawJson}
                onChange={(e) => {
                  setRawJson(e.target.value);
                  setJsonError(null);
                }}
                spellCheck={false}
                className={cn(
                  "h-72 w-full resize-none rounded-xl border bg-secondary/30 dark:bg-black/50 p-4 font-mono text-[11px] leading-5 text-foreground dark:text-cyan-100 outline-none transition-colors focus:ring-1",
                  jsonError
                    ? "border-red-500/40 focus:ring-red-500/30"
                    : "border-border/60 focus:ring-cyan-500/30"
                )}
              />
              {jsonError && (
                <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {jsonError}
                </p>
              )}
            </TabsContent>
          </Tabs>
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
              disabled={isLoading || (tab === "json" && !!jsonError) || !dateFrom || !dateTo}
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


