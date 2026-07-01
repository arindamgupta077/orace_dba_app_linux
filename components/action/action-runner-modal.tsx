"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart2, CheckCircle2, Loader2, Play, RotateCcw, ShieldCheck, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalTimeline } from "@/components/visual/approval-timeline";
import { AIInsightPanel } from "@/components/visual/ai-insight-panel";
import { FilesystemDriveResult } from "@/components/visual/filesystem-drive-result";
import { StatusBadge } from "@/components/visual/status-badge";
import { TablespaceChartContent } from "@/components/visual/tablespace-chart";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { useDbaAction } from "@/hooks/use-dba-action";
import { cn } from "@/lib/utils";
import { fetchTablespaceRuns } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { DbaActionDefinition, DbaParameterField, DbaResponse, TablespaceRow } from "@/types/dba";

interface ActionRunnerModalProps {
  definition: DbaActionDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (response: DbaResponse) => void;
  initialParams?: Record<string, unknown>;
}

function defaultParams(fields: DbaParameterField[], initialParams?: Record<string, unknown>) {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    acc[field.name] = initialParams?.[field.name] ?? field.defaultValue ?? (field.type === "checkbox" ? false : "");
    return acc;
  }, {});
}

/* ------------------------------------------------------------------ */
/* Tablespace-specific result view                                       */
/* ------------------------------------------------------------------ */

function TablespaceCheckResult({ rows, loading }: { rows: TablespaceRow[]; loading: boolean }) {
  const sorted = [...rows].sort((a, b) => b.pct_used - a.pct_used);
  const aboveThreshold = sorted.filter((t) => t.pct_used >= 80);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading tablespace data…
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground">
        No tablespace data found. Ensure n8n writes results to app_run_tablespaces.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Threshold alert / all-clear */}
      {aboveThreshold.length > 0 ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {aboveThreshold.length} tablespace{aboveThreshold.length > 1 ? "s" : ""} at or above 80% utilization
          </div>
          <div className="space-y-2">
            {aboveThreshold.map((ts) => (
              <div key={ts.name} className="flex flex-wrap items-center gap-2.5 text-sm">
                <StatusBadge status={ts.status} />
                <span className="font-semibold">{ts.name}</span>
                <span className="text-muted-foreground">
                  {ts.pct_used.toFixed(1)}% used &bull; {ts.used_gb.toFixed(1)} GB used &bull; {ts.free_gb.toFixed(1)} GB free
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All tablespaces are below the 80% warning threshold.
        </div>
      )}

      {/* Table / Chart */}
      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table" className="gap-1.5">
            <Table2 className="h-3.5 w-3.5" />
            Table View
          </TabsTrigger>
          <TabsTrigger value="chart" className="gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" />
            Chart View
          </TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-4">
          <TablespaceResultTable rows={sorted} />
        </TabsContent>

        <TabsContent value="chart" className="mt-4">
          <TablespaceChartContent rows={sorted} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TablespaceResultTable({ rows }: { rows: TablespaceRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-secondary/40">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tablespace</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Used&nbsp;GB</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Free&nbsp;GB</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Utilization</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.name}-${i}`}
              className={cn(
                "border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/20",
                row.pct_used >= 80 && "bg-amber-500/5"
              )}
            >
              <td className="px-4 py-3 font-medium">
                <span className="flex items-center gap-2">
                  {row.pct_used >= 80 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                  {row.name}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.used_gb.toFixed(1)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.free_gb.toFixed(1)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Progress value={row.pct_used} className="h-1.5 flex-1" />
                  <span className="w-12 text-right tabular-nums text-xs text-muted-foreground">
                    {row.pct_used.toFixed(1)}%
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-center">
                  <StatusBadge status={row.status} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                           */
/* ------------------------------------------------------------------ */

export function ActionRunnerModal({ definition, open, onOpenChange, onComplete, initialParams }: ActionRunnerModalProps) {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const databases = useAppStore((state) => state.databases);
  const user = useAppStore((state) => state.user);
  const canExecute = useAppStore((state) => state.canExecute);
  const triggerTablespaceRefresh = useAppStore((state) => state.triggerTablespaceRefresh);
  const { runAction, status, response, error, setResponse } = useDbaAction();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [confirmed, setConfirmed] = useState(false);

  // Tablespace-specific: rows fetched from app_run_tablespaces after run
  const [dbRows, setDbRows] = useState<TablespaceRow[]>([]);
  const [fetchingDb, setFetchingDb] = useState(false);

  useEffect(() => {
    if (definition && open) {
      setParams(defaultParams(definition.params, initialParams));
      setConfirmed(false);
      setResponse(null);
      setDbRows([]);
    }
  }, [definition, initialParams, open, setResponse]);

  const payloadPreview = useMemo(() => {
    if (!definition) return "";
    const dbTarget = databases.find((db) => db.name === selectedDb);
    return JSON.stringify(
      {
        action: definition.action,
        db: selectedDb,
        params,
        requested_by: user?.username || "arindam",
        user_id: user?.userId,
        environment: dbTarget?.env_label,
        os: dbTarget?.os,
        db_type: dbTarget?.db_type
      },
      null,
      2
    );
  }, [databases, definition, params, selectedDb, user?.username, user?.userId]);

  if (!definition) return null;

  const isTablespaceCheck = definition.action === "tablespace_check";
  const isDiskUtilization = definition.action === "disk_utilization";
  // Swap to result layout once the webhook call finishes (even while DB is still loading)
  const showTablespaceResult = isTablespaceCheck && response !== null && status !== "loading";
  const showDiskUtilizationResult = isDiskUtilization && response !== null && status !== "loading";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (definition.destructive && !confirmed) return;

    const result = await runAction(definition.action, params, selectedDb);
    onComplete?.(result);

    // For tablespace_check: n8n writes results to app_run_tablespaces.
    // Read from there — the webhook response body may not include raw_data.tablespaces.
    if (isTablespaceCheck) {
      setDbRows([]);
      setFetchingDb(true);
      try {
        const runs = await fetchTablespaceRuns();
        setDbRows(runs.rows);
      } catch {
        // fall back to response payload rows if the DB read fails
        const fallback = Array.isArray(result?.raw_data?.tablespaces)
          ? (result.raw_data.tablespaces as TablespaceRow[])
          : [];
        setDbRows(fallback);
      } finally {
        setFetchingDb(false);
        triggerTablespaceRefresh();
      }
    }
  };

  const renderField = (field: DbaParameterField) => {
    const value = params[field.name];
    const setValue = (next: unknown) => setParams((current) => ({ ...current, [field.name]: next }));

    if (field.type === "select") {
      return (
        <Select value={String(value ?? "")} onValueChange={setValue}>
          <SelectTrigger>
            <SelectValue placeholder={field.placeholder || field.label} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (field.type === "textarea") {
      return <Textarea value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} placeholder={field.placeholder} required={field.required} />;
    }
    if (field.type === "checkbox") {
      return (
        <label className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 p-3 text-sm">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => setValue(e.target.checked)} className="h-4 w-4 accent-red-500" />
          {field.label}
        </label>
      );
    }
    return (
      <Input
        type={field.type}
        value={String(value ?? "")}
        onChange={(e) => setValue(field.type === "number" ? Number(e.target.value) : e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{definition.title}</DialogTitle>
            {definition.destructive ? <StatusBadge status="critical">Approval Required</StatusBadge> : null}
          </div>
          <DialogDescription>{definition.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {/* ── Tablespace result replaces the form after execution ── */}
          {showTablespaceResult ? (
            <TablespaceCheckResult rows={dbRows} loading={fetchingDb} />
          ) : (
            /* ── Standard params + JSON preview layout ── */
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                {definition.params.length ? (
                  definition.params.map((field) => (
                    <div key={field.name} className="space-y-2">
                      {field.type !== "checkbox" ? (
                        <Label>
                          {field.label}
                          {field.required ? <span className="text-red-300"> *</span> : null}
                        </Label>
                      ) : null}
                      {renderField(field)}
                      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
                    No parameters required.
                  </div>
                )}

                {definition.destructive ? (
                  <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="h-5 w-5 text-red-300" />
                      <div>
                        <p className="font-medium text-red-100">Controlled execution</p>
                        <p className="mt-1 text-sm text-red-100/75">
                          This operation will be submitted for Slack approval and tracked through n8n before execution.
                        </p>
                      </div>
                    </div>
                    <label className="mt-4 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-red-500" />
                      I confirm this request is approved for submission.
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Generated JSON Request</Label>
                  <StatusBadge status={canExecute(definition.action) ? "healthy" : "critical"}>
                    {canExecute(definition.action) ? "Allowed" : "RBAC Denied"}
                  </StatusBadge>
                </div>
                <pre className="keep-dark max-h-80 overflow-auto rounded-md border border-border/70 bg-black/40 p-4 text-xs text-cyan-100">
                  {payloadPreview}
                </pre>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error ? (
            <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
          ) : null}

          {showDiskUtilizationResult ? (
            <>
              <Separator />
              <FilesystemDriveResult response={response} threshold={Number(params.threshold_pct || 90)} />
            </>
          ) : null}

          {/* Non-tablespace post-run result */}
          {!isTablespaceCheck && response ? (
            <>
              {!showDiskUtilizationResult ? <Separator /> : null}
              {response.status === "pending_approval" && response.approval ? (
                <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
                  <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-4">
                    <div className="mb-4 flex items-center gap-2 text-cyan-100">
                      <ShieldCheck className="h-5 w-5" />
                      Slack approval pending
                    </div>
                    <p className="mb-4 text-sm text-cyan-100/75">
                      Channel {response.approval.channel} / approver {response.approval.approver}
                    </p>
                    <ApprovalTimeline steps={response.approval.steps} />
                  </div>
                  <AIInsightPanel summary={response.ai_summary} status={response.db_status} findings={response.findings} recommendations={response.recommendations} />
                </div>
              ) : (
                <AIInsightPanel summary={response.ai_summary} status={response.db_status} findings={response.findings} recommendations={response.recommendations} />
              )}
              <TerminalViewer output={response.raw_output} />
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={status === "loading" || !canExecute(definition.action) || (definition.destructive && !confirmed)}
              className="min-w-36"
            >
              {status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : showTablespaceResult ? (
                <RotateCcw className="h-4 w-4" />
              ) : definition.destructive ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {status === "loading" ? "Running…" : showTablespaceResult ? "Re-run Check" : definition.destructive ? "Submit" : "Execute"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
