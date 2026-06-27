"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookTemplate,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  FileOutput,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Server,
  Terminal,
  Trash2,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { SchemaPicker } from "@/components/datapump/schema-picker";
import { executeDBAAction } from "@/services/api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { DbaResponse, ExpdpParams, ExpdpTemplate } from "@/types/dba";

/* ------------------------------------------------------------------ */
/* Constants                                                             */
/* ------------------------------------------------------------------ */

const TRANSFER_SERVERS = ["DMPSERVER01", "DMPSERVER02", "DMPSERVER03"];

const OPTIONAL_PARAMS = [
  "TABLES", "TABLESPACES", "COMPRESSION", "EXCLUDE", "INCLUDE",
  "PARALLEL", "FLASHBACK_TIME", "FILESIZE", "CONTENT",
  "ESTIMATE_ONLY", "METRICS"
] as const;

const PARAM_OPTIONS: Record<string, string[] | null> = {
  FULL: ["Y", "N"],
  EXCLUDE: ["TABLE","INDEX","VIEW","SEQUENCE","SYNONYM","TRIGGER","PROCEDURE","FUNCTION","PACKAGE","PACKAGE_BODY","TYPE","MATERIALIZED_VIEW","CONSTRAINT","GRANT","ROLE_GRANT","STATISTICS","USER","DB_LINK","DIRECTORY"],
  INCLUDE: ["TABLE","INDEX","VIEW","SEQUENCE","SYNONYM","TRIGGER","PROCEDURE","FUNCTION","PACKAGE","PACKAGE_BODY","TYPE","MATERIALIZED_VIEW","CONSTRAINT","GRANT","ROLE_GRANT","STATISTICS","USER","DB_LINK","DIRECTORY"],
  COMPRESSION: ["ALL", "DATA_ONLY", "METADATA_ONLY", "NONE"],
  FLASHBACK_TIME: ["SYSTIMESTAMP"],
  CONTENT: ["ALL", "DATA_ONLY", "METADATA_ONLY"],
  ESTIMATE_ONLY: ["Y", "N"],
  METRICS: ["Y", "N"],
  TABLES: null,
  TABLESPACES: null,
  PARALLEL: null,
  FILESIZE: null
};

const DEFAULT_PARAMS: ExpdpParams = {
  DIRECTORY: "DP_DIR",
  DUMPFILE: "exp_%U.dmp",
  LOGFILE: "exp.log",
  SCHEMAS: [],
  FULL: "Y"
};

/* ------------------------------------------------------------------ */
/* Props                                                                 */
/* ------------------------------------------------------------------ */

interface ExpdpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                        */
/* ------------------------------------------------------------------ */

function ParamRow({
  paramKey,
  value,
  onChange,
  onRemove
}: {
  paramKey: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const opts = PARAM_OPTIONS[paramKey];
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 shrink-0 rounded border border-amber-400/20 bg-amber-400/5 px-2 py-1 font-mono text-[11px] text-amber-300">
        {paramKey}
      </span>
      {opts ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 flex-1 font-mono text-xs"
          placeholder={paramKey === "PARALLEL" ? "e.g. 4" : paramKey === "FILESIZE" ? "e.g. 10G" : ""}
          type={paramKey === "PARALLEL" ? "number" : "text"}
        />
      )}
      <button type="button" onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                            */
/* ------------------------------------------------------------------ */

export function ExpdpModal({ open, onOpenChange }: ExpdpModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const databases = useAppStore((s) => s.databases);
  const user = useAppStore((s) => s.user);
  const upsertDataPumpJob = useAppStore((s) => s.upsertDataPumpJob);
  const expdpTemplates = useAppStore((s) => s.expdpTemplates);
  const addExpdpTemplate = useAppStore((s) => s.addExpdpTemplate);
  const deleteExpdpTemplate = useAppStore((s) => s.deleteExpdpTemplate);
  const dbTarget = databases.find((db) => db.name === selectedDb);

  // Form state
  const [params, setParams] = useState<ExpdpParams>({ ...DEFAULT_PARAMS });
  const [extraParams, setExtraParams] = useState<Array<{ key: string; value: string }>>([]);
  const [dumpTransfer, setDumpTransfer] = useState(false);
  const [transferServer, setTransferServer] = useState(TRANSFER_SERVERS[0]);

  // UI state
  const [tab, setTab] = useState<"form" | "json" | "templates">("form");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [response, setResponse] = useState<DbaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addParamOpen, setAddParamOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  /* ── Full payload ── */
  const fullPayload = useMemo(() => {
    const allParams: Record<string, unknown> = {
      DIRECTORY: params.DIRECTORY,
      DUMPFILE: params.DUMPFILE,
      LOGFILE: params.LOGFILE,
      ...(params.SCHEMAS && params.SCHEMAS.length > 0 ? { SCHEMAS: params.SCHEMAS } : {}),
      FULL: params.FULL,
    };
    // Extra optional params
    for (const { key, value } of extraParams) {
      if (key && value) allParams[key] = value;
    }
    if (dumpTransfer) {
      allParams.dump_transfer_required = "yes";
      allParams.transfer_server = transferServer;
    } else {
      allParams.dump_transfer_required = "no";
    }
    return {
      action: "expdp" as const,
      db: selectedDb,
      params: allParams,
      requested_by: user?.username?.toUpperCase() || "ARINDAM",
      user_id: user?.userId ?? 1,
      environment: dbTarget?.env_label ?? "PROD",
      os: dbTarget?.os ?? "Windows",
      db_type: dbTarget?.db_type ?? "Standalone"
    };
  }, [params, extraParams, dumpTransfer, transferServer, selectedDb, user, dbTarget]);

  /* ── Reset on open ── */
  useEffect(() => {
    if (open) {
      setParams({ ...DEFAULT_PARAMS });
      setExtraParams([]);
      setDumpTransfer(false);
      setTransferServer(TRANSFER_SERVERS[0]);
      setTab("form");
      setStatus("idle");
      setResponse(null);
      setError(null);
      setTemplateName("");
    }
  }, [open]);

  /* ── Submit ── */
  const handleSubmit = async () => {
    setStatus("loading");
    setError(null);
    const jobId = `EXPDP-${Date.now()}`;

    // Register job immediately in store (persists even if modal closes)
    upsertDataPumpJob({
      id: jobId,
      operation: "expdp",
      db: selectedDb,
      status: "running",
      started_at: new Date().toISOString(),
      params: fullPayload.params
    });

    try {
      const result = await executeDBAAction("expdp", selectedDb, fullPayload.params);
      setStatus("success");
      setResponse(result);
      // Update job with final status
      upsertDataPumpJob({
        id: jobId,
        operation: "expdp",
        db: selectedDb,
        status: result.status === "success" ? "success" : "error",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        message: result.ai_summary || "Export completed",
        dump_file: (result.raw_data as Record<string, unknown>)?.dump_file as string | undefined,
        transfer_status: (result.raw_data as Record<string, unknown>)?.transfer_status as string | undefined,
        params: fullPayload.params
      });
      toast.success("EXPDP completed", { description: result.ai_summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export request failed";
      setStatus("error");
      setError(msg);
      upsertDataPumpJob({
        id: jobId,
        operation: "expdp",
        db: selectedDb,
        status: "error",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        message: msg,
        params: fullPayload.params
      });
    }
  };

  /* ── Save template ── */
  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    setSavingTemplate(true);
    const tpl: ExpdpTemplate = {
      id: `EXPTPL-${Date.now()}`,
      name: templateName.trim(),
      db: selectedDb,
      created_at: new Date().toISOString(),
      params: {
        ...params,
        ...(dumpTransfer ? { dump_transfer_required: "yes" as const, transfer_server: transferServer } : { dump_transfer_required: "no" as const })
      }
    };
    // Build extra params back into tpl params
    for (const { key, value } of extraParams) {
      if (key && value) (tpl.params as Record<string, unknown>)[key] = value;
    }
    addExpdpTemplate(tpl);
    toast.success(`Template "${tpl.name}" saved`);
    setTemplateName("");
    setSavingTemplate(false);
  };

  /* ── Load template ── */
  const handleLoadTemplate = (tpl: ExpdpTemplate) => {
    const { DIRECTORY, DUMPFILE, LOGFILE, SCHEMAS, FULL, dump_transfer_required, transfer_server, ...rest } = tpl.params;
    setParams({ DIRECTORY: DIRECTORY || "DP_DIR", DUMPFILE: DUMPFILE || "exp_%U.dmp", LOGFILE: LOGFILE || "exp.log", SCHEMAS: SCHEMAS || [], FULL: FULL || "Y" });
    const extras: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null) extras.push({ key: k, value: String(v) });
    }
    setExtraParams(extras);
    setDumpTransfer(dump_transfer_required === "yes");
    if (transfer_server) setTransferServer(transfer_server);
    setTab("form");
    toast.info(`Template "${tpl.name}" loaded`);
  };

  /* ── Add optional param ── */
  const addableParams = OPTIONAL_PARAMS.filter((p) => !extraParams.some((e) => e.key === p));
  const isLoading = status === "loading";
  const isDone = response !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2">
              <FileOutput className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">Oracle Data Pump Export (EXPDP)</DialogTitle>
              <DialogDescription>
                Configure export parameters — n8n builds and executes the expdp command on the Oracle server.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Result view ── */}
        {isDone ? (
          <div className="space-y-4">
            <div className={cn(
              "flex items-start gap-3 rounded-xl border p-4",
              response?.status === "success"
                ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-100"
                : "border-red-400/30 bg-red-500/8 text-red-100"
            )}>
              {response?.status === "success"
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              }
              <div>
                <p className="font-semibold">
                  {response?.status === "success" ? "Export Completed Successfully" : "Export Failed"}
                </p>
                <p className="mt-1 text-sm opacity-80">{response?.ai_summary}</p>
              </div>
            </div>

            {/* Dump file info */}
            {Boolean((response?.raw_data as Record<string, unknown>)?.dump_file) && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm">
                <Download className="h-4 w-4 text-amber-400" />
                <span className="font-mono text-amber-200">{String((response?.raw_data as Record<string, unknown>)?.dump_file ?? "")}</span>
                {Boolean((response?.raw_data as Record<string, unknown>)?.transfer_status) && (
                  <span className="ml-2 text-muted-foreground">{String((response?.raw_data as Record<string, unknown>)?.transfer_status ?? "")}</span>
                )}
              </div>
            )}

            {/* Terminal output */}
            {response?.raw_output && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Terminal className="h-3 w-3" /> EXPDP Output
                </p>
                <TerminalViewer output={response.raw_output} title="EXPDP Output" />
              </div>
            )}
          </div>

        ) : (
          /* ── Config view ── */
          <div className="space-y-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "form" | "json" | "templates")}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="form" className="gap-1.5">
                  <Layers className="h-3.5 w-3.5" /> Form
                </TabsTrigger>
                <TabsTrigger value="json" className="gap-1.5">
                  <Code2 className="h-3.5 w-3.5" /> JSON Preview
                </TabsTrigger>
                <TabsTrigger value="templates" className="gap-1.5">
                  <BookTemplate className="h-3.5 w-3.5" /> Templates
                  {expdpTemplates.length > 0 && (
                    <span className="ml-1 rounded-full bg-amber-400/20 px-1.5 text-[10px] text-amber-300">
                      {expdpTemplates.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Form tab ── */}
              <TabsContent value="form" className="mt-4 space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  {/* Left — Required params */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">Required Parameters</p>

                    {(["DIRECTORY", "DUMPFILE", "LOGFILE"] as const).map((field) => (
                      <div key={field} className="space-y-1.5">
                        <Label htmlFor={`expdp-${field}`} className="font-mono text-xs text-amber-300/80">{field}</Label>
                        <Input
                          id={`expdp-${field}`}
                          value={params[field] as string}
                          onChange={(e) => setParams((p) => ({ ...p, [field]: e.target.value }))}
                          className="font-mono text-xs"
                          placeholder={field === "DIRECTORY" ? "DP_DIR" : field === "DUMPFILE" ? "exp_%U.dmp" : "exp.log"}
                        />
                      </div>
                    ))}

                    {/* Schemas */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-amber-300/80">SCHEMAS</Label>
                      <SchemaPicker
                        selected={params.SCHEMAS || []}
                        onChange={(s) => setParams((p) => ({ ...p, SCHEMAS: s }))}
                      />
                      <p className="text-[11px] text-muted-foreground">Triggers schema_list webhook to fetch live schema list</p>
                    </div>

                    {/* FULL */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-amber-300/80">FULL</Label>
                      <Select value={params.FULL || "Y"} onValueChange={(v) => setParams((p) => ({ ...p, FULL: v }))}>
                        <SelectTrigger id="expdp-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Y", "N"].map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Right — Optional params + transfer */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">Optional Parameters</p>

                    {extraParams.map((ep, idx) => (
                      <ParamRow
                        key={`${ep.key}-${idx}`}
                        paramKey={ep.key}
                        value={ep.value}
                        onChange={(v) => setExtraParams((prev) => prev.map((x, i) => i === idx ? { ...x, value: v } : x))}
                        onRemove={() => setExtraParams((prev) => prev.filter((_, i) => i !== idx))}
                      />
                    ))}

                    {/* Add parameter dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        id="btn-add-expdp-param"
                        onClick={() => setAddParamOpen((v) => !v)}
                        disabled={addableParams.length === 0}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-amber-400/30 px-3 py-2 text-xs text-amber-400/70 transition-colors hover:border-amber-400/60 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add parameter
                        {addParamOpen ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                      </button>
                      {addParamOpen && addableParams.length > 0 && (
                        <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur">
                          {addableParams.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                const defaultVal = PARAM_OPTIONS[p]?.[0] ?? "";
                                setExtraParams((prev) => [...prev, { key: p, value: defaultVal }]);
                                setAddParamOpen(false);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary/50 first:rounded-t-xl last:rounded-b-xl"
                            >
                              <span className="font-mono text-amber-300">{p}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <Separator className="my-2" />

                    {/* Dump Transfer */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">Dump Transfer</p>
                      <label htmlFor="expdp-dump-transfer" className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-background/30 px-3 py-2.5 transition-colors hover:bg-background/50">
                        <input
                          id="expdp-dump-transfer"
                          type="checkbox"
                          checked={dumpTransfer}
                          onChange={(e) => setDumpTransfer(e.target.checked)}
                          className="h-4 w-4 shrink-0 accent-amber-500"
                        />
                        <div>
                          <span className="text-sm font-medium">Transfer dump after export</span>
                          <p className="text-xs text-muted-foreground">Automatically SCP the dumpfile to a target server</p>
                        </div>
                      </label>

                      {dumpTransfer && (
                        <div className="space-y-1.5">
                          <Label htmlFor="expdp-transfer-server" className="flex items-center gap-1.5 text-xs">
                            <Server className="h-3.5 w-3.5 text-amber-400" />
                            Destination Server
                          </Label>
                          <Select value={transferServer} onValueChange={setTransferServer}>
                            <SelectTrigger id="expdp-transfer-server"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TRANSFER_SERVERS.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info banner */}
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-300">ℹ️ n8n execution flow:</p>
                  <p className="mt-1 text-xs text-muted-foreground font-mono leading-5">
                    Build EXPDP command → SSH to DB server → Execute expdp
                    {dumpTransfer ? ` → SCP dump to ${transferServer}` : ""} → Callback to app → Status update
                  </p>
                </div>

                {/* Save as template */}
                <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                  <Input
                    placeholder="Template name (e.g. HR_FULL_BACKUP)"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="flex-1 h-8 text-xs"
                  />
                  <Button size="sm" variant="outline" onClick={handleSaveTemplate} disabled={savingTemplate || !templateName.trim()} className="gap-1.5 shrink-0">
                    <Save className="h-3.5 w-3.5" />
                    Save Template
                  </Button>
                </div>
              </TabsContent>

              {/* ── JSON Preview tab ── */}
              <TabsContent value="json" className="mt-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Payload → n8n Webhook</p>
                  <pre className="max-h-96 overflow-auto rounded-xl border border-border/60 bg-black/50 p-4 text-[11px] leading-5 text-cyan-100 font-mono">
                    {JSON.stringify(fullPayload, null, 2)}
                  </pre>
                </div>
              </TabsContent>

              {/* ── Templates tab ── */}
              <TabsContent value="templates" className="mt-4">
                {expdpTemplates.length === 0 ? (
                  <div className="rounded-xl border border-border/40 bg-secondary/10 py-12 text-center">
                    <BookTemplate className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">No export templates saved yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">Fill the form and click &quot;Save Template&quot; to create one</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {expdpTemplates
                      .filter((t) => t.db === selectedDb)
                      .concat(expdpTemplates.filter((t) => t.db !== selectedDb))
                      .map((tpl) => (
                        <div
                          key={tpl.id}
                          className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/10 px-4 py-3 transition-colors hover:bg-secondary/20"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{tpl.name}</p>
                              {tpl.db === selectedDb && (
                                <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">Current DB</span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              DB: {tpl.db} · Schemas: {tpl.params.SCHEMAS?.join(", ") || "None"} · {new Date(tpl.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => handleLoadTemplate(tpl)} className="h-7 gap-1 text-xs">
                              <Play className="h-3 w-3" />
                              Load
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteExpdpTemplate(tpl.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Error banner */}
        {error && !isDone && (
          <div className="flex items-start gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p>{error}</p>
          </div>
        )}

        {/* Loading banner */}
        {isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" />
            <div>
              <p className="font-medium">Export in progress…</p>
              <p className="text-xs text-muted-foreground">
                You can close this modal — the job will continue and status will update in the Active Jobs banner.
              </p>
            </div>
          </div>
        )}

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={false}>
            {isLoading ? "Running in background…" : "Close"}
          </Button>
          {isDone ? (
            <Button variant="outline" onClick={() => { setResponse(null); setStatus("idle"); }} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Run Again
            </Button>
          ) : (
            <Button
              id="btn-execute-expdp"
              onClick={handleSubmit}
              disabled={isLoading}
              className="min-w-48 gap-2 bg-amber-500/80 text-white hover:bg-amber-500"
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Exporting…</>
              ) : (
                <><Play className="h-4 w-4" /> Run Export (EXPDP)</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
