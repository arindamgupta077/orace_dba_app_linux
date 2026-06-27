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
import { StatusBadge } from "@/components/visual/status-badge";
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
  SUCCESS: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  FAILED:  "text-red-300   border-red-400/30   bg-red-500/10",
  RUNNING: "text-amber-300 border-amber-400/30 bg-amber-400/10"
};

function BackupStatusTable({ rows }: { rows: ExtendedBackupRow[] }) {
  const failed  = rows.filter((r) => r.status === "FAILED").length;
  const running = rows.filter((r) => r.status === "RUNNING").length;
  const success = rows.filter((r) => r.status === "SUCCESS").length;

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          {success} Successful
        </span>
        {running > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            {running} Running
          </span>
        )}
        {failed > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-red-300">
            <XCircle className="h-3 w-3" />
            {failed} Failed
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-secondary/40">
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Start Time</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Duration</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Compression</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Output Size</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`${row.id}-${i}`}
                className={cn(
                  "border-b border-border/30 last:border-0 transition-colors hover:bg-secondary/20",
                  row.status === "FAILED" && "bg-red-500/4"
                )}
              >
                <td className="px-3 py-2.5 font-mono font-medium">{row.type}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      STATUS_STYLE[row.status] || "text-slate-300 border-slate-400/25 bg-slate-400/10"
                    )}
                  >
                    {row.status === "FAILED" && <XCircle className="mr-1 h-2.5 w-2.5" />}
                    {row.status === "SUCCESS" && <CheckCircle2 className="mr-1 h-2.5 w-2.5" />}
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row.started_at}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.duration_min > 0 ? `${row.duration_min} min` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.compression_ratio > 0 ? `${row.compression_ratio.toFixed(2)}x` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.output_bytes || "—"}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.device_type || "DISK"}</td>
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
        await runAction("backup_status", resolvedParams, selectedDb);
        return;
      } catch {
        setJsonError("Invalid JSON — cannot submit.");
        return;
      }
    }
    await runAction("backup_status", { date_from: dateFrom, date_to: dateTo }, selectedDb);
  };

  const isLoading = status === "loading";
  const isDone    = response !== null && !isLoading;
  const backupRows: ExtendedBackupRow[] = (response?.raw_data?.backups as ExtendedBackupRow[] | undefined) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-2">
              <Search className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">RMAN Backup Status</DialogTitle>
              <DialogDescription>
                Query <code className="font-mono text-cyan-300">V$RMAN_BACKUP_JOB_DETAILS</code> for a date range to review all backup jobs.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Post-run result view ── */}
        {isDone ? (
          <div className="space-y-4">
            {/* Status banner */}
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4",
                response?.status === "success"
                  ? "border-cyan-400/30 bg-cyan-400/8 text-cyan-100"
                  : "border-red-400/30 bg-red-500/8 text-red-100"
              )}
            >
              {response?.status === "success" ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              )}
              <div>
                <p className="font-semibold">
                  {response?.status === "success" ? "Backup Status Retrieved" : "Query Failed"}
                </p>
                <p className="mt-1 text-sm opacity-80">{response?.ai_summary}</p>
              </div>
            </div>

            {/* Results table */}
            {backupRows.length > 0 ? (
              <BackupStatusTable rows={backupRows} />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
                No backup jobs found for the selected date range.
              </div>
            )}

            {/* Failed job findings */}
            {(response?.findings ?? []).length > 0 && (
              <div className="space-y-2 rounded-xl border border-red-400/25 bg-red-500/8 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-300">Failed Jobs</p>
                {response!.findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-red-100">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <div>
                      <p className="font-medium">{f.title}</p>
                      <p className="text-xs text-red-100/70">{f.detail}</p>
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
            <TabsContent value="form" className="mt-4">
              <div className="grid gap-5 md:grid-cols-2">
                {/* Left: Date range inputs */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Query Parameters
                  </p>

                  <div className="space-y-1.5">
                    <Label htmlFor="rman-status-date-from">Date From</Label>
                    <Input
                      id="rman-status-date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="rman-status-date-to">Date To</Label>
                    <Input
                      id="rman-status-date-to"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="font-mono"
                    />
                  </div>

                  {/* Quick range helpers */}
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Quick ranges:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "Last 7 days",  from: -7  },
                        { label: "Last 30 days", from: -30 },
                        { label: "Last 60 days", from: -60 },
                        { label: "Last 90 days", from: -90 }
                      ].map(({ label, from }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            setDateFrom(toLocalDateString(from));
                            setDateTo(toLocalDateString(0));
                          }}
                          className="rounded-full border border-border/50 bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-300"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-2.5 text-xs text-muted-foreground">
                    <p className="font-medium text-cyan-300/80 mb-1">Query target:</p>
                    <code className="font-mono text-cyan-200/60">V$RMAN_BACKUP_JOB_DETAILS</code>
                    <br />
                    <code className="font-mono text-cyan-200/60">WHERE START_TIME BETWEEN :date_from AND :date_to</code>
                  </div>
                </div>

                {/* Right: JSON Preview */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Live JSON Preview
                    </p>
                    <StatusBadge status="info">→ n8n Webhook</StatusBadge>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-border/60 bg-black/50 p-4 text-[11px] leading-5 text-cyan-100 font-mono">
                    {JSON.stringify(fullPayload, null, 2)}
                  </pre>
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
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
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
                  "h-72 w-full resize-none rounded-xl border bg-black/50 p-4 font-mono text-[11px] leading-5 text-cyan-100 outline-none transition-colors focus:ring-1",
                  jsonError
                    ? "border-red-400/40 focus:ring-red-400/30"
                    : "border-border/60 focus:ring-cyan-400/30"
                )}
              />
              {jsonError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {jsonError}
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* Error banner */}
        {error && !isDone && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
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
              className="min-w-44 gap-2 bg-cyan-600/80 text-white hover:bg-cyan-600"
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
