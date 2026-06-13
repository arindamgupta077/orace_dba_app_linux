"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookTemplate,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Edit3,
  FileInput,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Terminal,
  Trash2,
  UserX,
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
import { findDatabaseTarget } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { DbaResponse, ImpdpParams, ImpdpTemplate } from "@/types/dba";

/* ------------------------------------------------------------------ */
/* Constants                                                             */
/* ------------------------------------------------------------------ */

const OPTIONAL_PARAMS = [
  "TABLES", "TABLESPACES", "TABLE_EXISTS_ACTION", "CONTENT", "PARALLEL",
  "REMAP_TABLESPACE", "TRANSFORM", "METRICS"
] as const;

const PARAM_OPTIONS: Record<string, string[] | null> = {
  FULL: ["Y", "N"],
  CONTENT: ["ALL", "DATA_ONLY", "METADATA_ONLY"],
  TABLE_EXISTS_ACTION: ["SKIP", "APPEND", "TRUNCATE", "REPLACE"],
  EXCLUDE: ["TABLE","INDEX","VIEW","SEQUENCE","SYNONYM","TRIGGER","PROCEDURE","FUNCTION","PACKAGE","PACKAGE_BODY","TYPE","MATERIALIZED_VIEW","CONSTRAINT","GRANT","ROLE_GRANT","STATISTICS","USER","DB_LINK","DIRECTORY"],
  INCLUDE: ["TABLE","INDEX","VIEW","SEQUENCE","SYNONYM","TRIGGER","PROCEDURE","FUNCTION","PACKAGE","PACKAGE_BODY","TYPE","MATERIALIZED_VIEW","CONSTRAINT","GRANT","ROLE_GRANT","STATISTICS","USER","DB_LINK","DIRECTORY"],
  METRICS: ["Y", "N"],
  TABLES: null,
  TABLESPACES: null,
  REMAP_SCHEMA: null,
  REMAP_TABLESPACE: null,
  TRANSFORM: null,
  PARALLEL: null
};

const DEFAULT_PARAMS: ImpdpParams = {
  DIRECTORY: "DP_DIR",
  DUMPFILE: "",
  LOGFILE: "imp.log",
  SCHEMAS: [],
  FULL: "N",
  EXCLUDE: "",
  INCLUDE: "",
  REMAP_SCHEMA: "",
  drop_user: "yes"
};

type WizardStep = "dumpfile" | "configure";

interface ImpdpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------ */
/* ParamRow sub-component                                               */
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
      <span className="w-40 shrink-0 rounded border border-violet-400/20 bg-violet-400/5 px-2 py-1 font-mono text-[11px] text-violet-300">
        {paramKey}
      </span>
      {opts ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 flex-1 font-mono text-xs"
          placeholder={paramKey === "REMAP_SCHEMA" ? "HR:HR_DEV" : paramKey === "REMAP_TABLESPACE" ? "OLD_TS:NEW_TS" : ""}
        />
      )}
      <button type="button" onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RemapSchemaInput sub-component                                     */
/* ------------------------------------------------------------------ */

function RemapSchemaInput({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const pairs = value ? value.split(",").map(p => {
    const [s, t] = p.split(":");
    return { src: s || "", tgt: t || "" };
  }) : [];

  const updatePairs = (newPairs: {src: string, tgt: string}[]) => {
    onChange(newPairs.map(p => `${p.src}:${p.tgt}`).join(","));
  };

  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-secondary/5 p-3">
      {pairs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No schema mappings added.</p>
      ) : (
        <div className="space-y-2">
          {pairs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input 
                placeholder="Source Schema" 
                value={p.src} 
                onChange={e => {
                  const arr = [...pairs];
                  arr[i].src = e.target.value.toUpperCase();
                  updatePairs(arr);
                }} 
                className="h-8 font-mono text-xs uppercase" 
              />
              <span className="text-muted-foreground font-mono text-xs">:</span>
              <Input 
                placeholder="Target Schema" 
                value={p.tgt} 
                onChange={e => {
                  const arr = [...pairs];
                  arr[i].tgt = e.target.value.toUpperCase();
                  updatePairs(arr);
                }} 
                className="h-8 font-mono text-xs uppercase" 
              />
              <button type="button" onClick={() => updatePairs(pairs.filter((_, idx) => idx !== i))} className="shrink-0 text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={() => updatePairs([...pairs, { src: "", tgt: "" }])} 
        className="h-7 text-xs border-dashed border-violet-400/30 text-violet-400/70 hover:border-violet-400/60 hover:text-violet-400 bg-transparent w-full"
      >
        <Plus className="h-3 w-3 mr-1" /> Add Mapping
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                            */
/* ------------------------------------------------------------------ */

export function ImpdpModal({ open, onOpenChange }: ImpdpModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const user = useAppStore((s) => s.user);
  const upsertDataPumpJob = useAppStore((s) => s.upsertDataPumpJob);
  const impdpTemplates = useAppStore((s) => s.impdpTemplates);
  const addImpdpTemplate = useAppStore((s) => s.addImpdpTemplate);
  const deleteImpdpTemplate = useAppStore((s) => s.deleteImpdpTemplate);
  const dbTarget = findDatabaseTarget(selectedDb);

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>("dumpfile");
  const [dumpfileFetching, setDumpfileFetching] = useState(false);
  const [dumpfileError, setDumpfileError] = useState<string | null>(null);
  const [editedDumpfile, setEditedDumpfile] = useState("");

  // Form state
  const [params, setParams] = useState<ImpdpParams>({ ...DEFAULT_PARAMS });
  const [extraParams, setExtraParams] = useState<Array<{ key: string; value: string }>>([]);
  const [dropUser, setDropUser] = useState(true);

  // UI state
  const [tab, setTab] = useState<"form" | "json" | "templates">("form");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [response, setResponse] = useState<DbaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addParamOpen, setAddParamOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  /* ── Fetch latest dumpfile on open ── */
  useEffect(() => {
    if (!open) return;
    // Reset
    setWizardStep("dumpfile");
    setParams({ ...DEFAULT_PARAMS });
    setExtraParams([]);
    setDropUser(true);
    setTab("form");
    setStatus("idle");
    setResponse(null);
    setError(null);
    setDumpfileError(null);
    setTemplateName("");

    // Trigger n8n to fetch latest dumpfile
    setDumpfileFetching(true);
    executeDBAAction("fetch_dump", selectedDb, {})
      .then((result) => {
        const latest =
          (result?.raw_data as Record<string, unknown>)?.latest_dump_file as string
          || result?.raw_output
          || "";
        setEditedDumpfile(latest.trim());
      })
      .catch((e) => {
        setDumpfileError(e instanceof Error ? e.message : "Failed to fetch latest dumpfile");
      })
      .finally(() => setDumpfileFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ── Full payload ── */
  const fullPayload = useMemo(() => {
    const allParams: Record<string, unknown> = {
      DIRECTORY: params.DIRECTORY,
      DUMPFILE: params.DUMPFILE || editedDumpfile,
      LOGFILE: params.LOGFILE,
      drop_user: dropUser ? "yes" : "no",
      ...(params.SCHEMAS && params.SCHEMAS.length > 0 ? { SCHEMAS: params.SCHEMAS } : {})
    };
    if (params.FULL && params.FULL !== "N") allParams.FULL = params.FULL;
    if (params.EXCLUDE) allParams.EXCLUDE = params.EXCLUDE;
    if (params.INCLUDE) allParams.INCLUDE = params.INCLUDE;
    if (params.REMAP_SCHEMA) {
      const validMappings = params.REMAP_SCHEMA.split(",")
        .filter(p => {
           const [s, t] = p.split(":");
           return s?.trim() && t?.trim();
        })
        .join(",");
      if (validMappings) allParams.REMAP_SCHEMA = validMappings;
    }
    for (const { key, value } of extraParams) {
      if (key && value) allParams[key] = value;
    }
    return {
      action: "impdp" as const,
      db: selectedDb,
      params: allParams,
      requested_by: user?.username?.toUpperCase() || "ARINDAM",
      user_id: user?.userId ?? 1,
      environment: dbTarget?.env_label ?? "PROD",
      os: dbTarget?.os ?? "Windows",
      db_type: dbTarget?.db_type ?? "Standalone"
    };
  }, [params, extraParams, dropUser, editedDumpfile, selectedDb, user, dbTarget]);

  /* ── Confirm dumpfile and move to step 2 ── */
  const confirmDumpfile = () => {
    if (!editedDumpfile.trim()) {
      toast.error("Please enter a dump file name");
      return;
    }
    setParams((p) => ({ ...p, DUMPFILE: editedDumpfile.trim() }));
    setWizardStep("configure");
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    setStatus("loading");
    setError(null);
    const jobId = `IMPDP-${Date.now()}`;

    upsertDataPumpJob({
      id: jobId,
      operation: "impdp",
      db: selectedDb,
      status: "running",
      started_at: new Date().toISOString(),
      params: fullPayload.params
    });

    try {
      const result = await executeDBAAction("impdp", selectedDb, fullPayload.params);
      setStatus("success");
      setResponse(result);
      upsertDataPumpJob({
        id: jobId,
        operation: "impdp",
        db: selectedDb,
        status: result.status === "success" ? "success" : "error",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        message: result.ai_summary || "Import completed",
        dump_file: fullPayload.params.DUMPFILE as string,
        params: fullPayload.params
      });
      toast.success("IMPDP completed", { description: result.ai_summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import request failed";
      setStatus("error");
      setError(msg);
      upsertDataPumpJob({
        id: jobId,
        operation: "impdp",
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
    if (!templateName.trim()) { toast.error("Enter a template name"); return; }
    const tpl: ImpdpTemplate = {
      id: `IMPTPL-${Date.now()}`,
      name: templateName.trim(),
      db: selectedDb,
      created_at: new Date().toISOString(),
      params: {
        ...params,
        drop_user: dropUser ? "yes" : "no"
      }
    };
    for (const { key, value } of extraParams) {
      if (key && value) (tpl.params as Record<string, unknown>)[key] = value;
    }
    addImpdpTemplate(tpl);
    toast.success(`Template "${tpl.name}" saved`);
    setTemplateName("");
  };

  /* ── Load template ── */
  const handleLoadTemplate = (tpl: ImpdpTemplate) => {
    const { DIRECTORY, DUMPFILE, LOGFILE, SCHEMAS, FULL, EXCLUDE, INCLUDE, REMAP_SCHEMA, drop_user, ...rest } = tpl.params;
    setParams({
      DIRECTORY: DIRECTORY || "DP_DIR",
      DUMPFILE: DUMPFILE || editedDumpfile,
      LOGFILE: LOGFILE || "imp.log",
      SCHEMAS: SCHEMAS || [],
      FULL: FULL || "N",
      EXCLUDE: EXCLUDE || "",
      INCLUDE: INCLUDE || "",
      REMAP_SCHEMA: REMAP_SCHEMA || ""
    });
    setDropUser(drop_user !== "no");
    const extras: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null) extras.push({ key: k, value: String(v) });
    }
    setExtraParams(extras);
    setTab("form");
    toast.info(`Template "${tpl.name}" loaded`);
  };

  const addableParams = OPTIONAL_PARAMS.filter((p) => !extraParams.some((e) => e.key === p));
  const isLoading = status === "loading";
  const isDone = response !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-violet-400/30 bg-violet-400/10 p-2">
              <FileInput className="h-5 w-5 text-violet-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">Oracle Data Pump Import (IMPDP)</DialogTitle>
              <DialogDescription>
                {wizardStep === "dumpfile"
                  ? "Step 1 of 2 — Confirm the dump file to import from"
                  : "Step 2 of 2 — Configure import parameters"}
              </DialogDescription>
            </div>
          </div>

          {/* Step indicator */}
          <div className="mt-3 flex items-center gap-3">
            {(["dumpfile", "configure"] as WizardStep[]).map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold",
                  wizardStep === step
                    ? "border-violet-400 bg-violet-400/20 text-violet-300"
                    : wizardStep === "configure" && step === "dumpfile"
                      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
                      : "border-border/50 text-muted-foreground"
                )}>
                  {wizardStep === "configure" && step === "dumpfile" ? "✓" : i + 1}
                </div>
                <span className={cn(
                  "text-xs",
                  wizardStep === step ? "text-violet-300 font-medium" : "text-muted-foreground"
                )}>
                  {step === "dumpfile" ? "Confirm Dump File" : "Configure Import"}
                </span>
                {i < 1 && <div className="h-px w-8 bg-border/50" />}
              </div>
            ))}
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
                  {response?.status === "success" ? "Import Completed Successfully" : "Import Failed"}
                </p>
                <p className="mt-1 text-sm opacity-80">{response?.ai_summary}</p>
              </div>
            </div>
            {response?.raw_output && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Terminal className="h-3 w-3" /> IMPDP Output
                </p>
                <TerminalViewer output={response.raw_output} title="IMPDP Output" />
              </div>
            )}
          </div>

        ) : wizardStep === "dumpfile" ? (
          /* ── Step 1: Confirm dumpfile ── */
          <div className="space-y-5">
            <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 px-4 py-3">
              <p className="text-xs font-semibold text-violet-300">
                n8n will fetch the latest dump file from the Oracle server via SSH
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The file name will be auto-populated below. You can edit it if needed.
              </p>
            </div>

            {dumpfileFetching ? (
              <div className="flex items-center justify-center gap-3 rounded-xl border border-border/50 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                Fetching latest dump file from server…
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="impdp-dumpfile" className="flex items-center gap-1.5 text-sm font-medium">
                  <Edit3 className="h-3.5 w-3.5 text-violet-400" />
                  Dump File Name
                </Label>
                <Input
                  id="impdp-dumpfile"
                  value={editedDumpfile}
                  onChange={(e) => setEditedDumpfile(e.target.value)}
                  className="font-mono"
                  placeholder="e.g. exp_HR_20260608.dmp"
                />
                {dumpfileError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    {dumpfileError} — you can still type the filename manually
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Edit if you want to import a specific dump file instead of the latest one
                </p>
              </div>
            )}
          </div>

        ) : (
          /* ── Step 2: Configure import ── */
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
                  {impdpTemplates.length > 0 && (
                    <span className="ml-1 rounded-full bg-violet-400/20 px-1.5 text-[10px] text-violet-300">{impdpTemplates.length}</span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Form ── */}
              <TabsContent value="form" className="mt-4 space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  {/* Left */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-violet-400/70">Required Parameters</p>

                    {/* DIRECTORY */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">DIRECTORY</Label>
                      <Input value={params.DIRECTORY} onChange={(e) => setParams((p) => ({ ...p, DIRECTORY: e.target.value }))} className="font-mono text-xs" placeholder="DP_DIR" />
                    </div>

                    {/* DUMPFILE (readonly, set in step 1) */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">DUMPFILE (from Step 1)</Label>
                      <div className="flex items-center gap-2">
                        <Input value={params.DUMPFILE || editedDumpfile} readOnly className="font-mono text-xs text-muted-foreground bg-secondary/20" />
                        <Button size="sm" variant="ghost" onClick={() => setWizardStep("dumpfile")} className="shrink-0 gap-1 text-xs">
                          <Edit3 className="h-3 w-3" /> Edit
                        </Button>
                      </div>
                    </div>

                    {/* LOGFILE */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">LOGFILE</Label>
                      <Input value={params.LOGFILE} onChange={(e) => setParams((p) => ({ ...p, LOGFILE: e.target.value }))} className="font-mono text-xs" placeholder="imp.log" />
                    </div>

                    {/* SCHEMAS */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">SCHEMAS</Label>
                      <SchemaPicker
                        selected={params.SCHEMAS || []}
                        onChange={(s) => setParams((p) => ({ ...p, SCHEMAS: s }))}
                      />
                    </div>

                    {/* FULL */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">FULL</Label>
                      <Select value={params.FULL || "N"} onValueChange={(v) => setParams((p) => ({ ...p, FULL: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Y", "N"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Right */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-violet-400/70">Optional Parameters</p>

                    {/* EXCLUDE */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">EXCLUDE</Label>
                      <Select value={params.EXCLUDE || "none"} onValueChange={(v) => setParams((p) => ({ ...p, EXCLUDE: v === "none" ? "" : v }))}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {PARAM_OPTIONS.EXCLUDE?.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* INCLUDE */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">INCLUDE</Label>
                      <Select value={params.INCLUDE || "none"} onValueChange={(v) => setParams((p) => ({ ...p, INCLUDE: v === "none" ? "" : v }))}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {PARAM_OPTIONS.INCLUDE?.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* REMAP_SCHEMA */}
                    <div className="space-y-1.5">
                      <Label className="font-mono text-xs text-violet-300/80">REMAP_SCHEMA</Label>
                      <RemapSchemaInput value={params.REMAP_SCHEMA || ""} onChange={(v) => setParams((p) => ({ ...p, REMAP_SCHEMA: v }))} />
                    </div>

                    {extraParams.map((ep, idx) => (
                      <ParamRow
                        key={`${ep.key}-${idx}`}
                        paramKey={ep.key}
                        value={ep.value}
                        onChange={(v) => setExtraParams((prev) => prev.map((x, i) => i === idx ? { ...x, value: v } : x))}
                        onRemove={() => setExtraParams((prev) => prev.filter((_, i) => i !== idx))}
                      />
                    ))}

                    <div className="relative">
                      <button
                        type="button"
                        id="btn-add-impdp-param"
                        onClick={() => setAddParamOpen((v) => !v)}
                        disabled={addableParams.length === 0}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-violet-400/30 px-3 py-2 text-xs text-violet-400/70 transition-colors hover:border-violet-400/60 hover:text-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add parameter
                        {addParamOpen ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                      </button>
                      {addParamOpen && (
                        <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-border/70 bg-background/95 shadow-xl backdrop-blur">
                          {addableParams.map((p) => (
                            <button key={p} type="button"
                              onClick={() => {
                                setExtraParams((prev) => [...prev, { key: p, value: PARAM_OPTIONS[p]?.[0] ?? "" }]);
                                setAddParamOpen(false);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary/50 first:rounded-t-xl last:rounded-b-xl"
                            >
                              <span className="font-mono text-violet-300">{p}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <Separator />

                    {/* Drop User checkbox */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-violet-400/70">Pre-Import: Drop User</p>
                      <label htmlFor="impdp-drop-user" className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-background/50",
                        dropUser ? "border-red-400/30 bg-red-500/5" : "border-border/60 bg-background/30"
                      )}>
                        <input
                          id="impdp-drop-user"
                          type="checkbox"
                          checked={dropUser}
                          onChange={(e) => setDropUser(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-red-500"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <UserX className={cn("h-4 w-4", dropUser ? "text-red-400" : "text-muted-foreground")} />
                            <span className="text-sm font-medium">Drop schema users before import</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {dropUser
                              ? "⚠️ n8n will DROP USER CASCADE for all SCHEMAS before importing"
                              : "Import will run directly without dropping existing users"}
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Save template */}
                <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                  <Input
                    placeholder="Template name (e.g. HR_IMPORT_UAT)"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="flex-1 h-8 text-xs"
                  />
                  <Button size="sm" variant="outline" onClick={handleSaveTemplate} disabled={!templateName.trim()} className="gap-1.5 shrink-0">
                    <Save className="h-3.5 w-3.5" /> Save Template
                  </Button>
                </div>
              </TabsContent>

              {/* ── JSON Preview ── */}
              <TabsContent value="json" className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Payload → n8n Webhook</p>
                <pre className="max-h-96 overflow-auto rounded-xl border border-border/60 bg-black/50 p-4 text-[11px] leading-5 text-cyan-100 font-mono">
                  {JSON.stringify(fullPayload, null, 2)}
                </pre>
              </TabsContent>

              {/* ── Templates ── */}
              <TabsContent value="templates" className="mt-4">
                {impdpTemplates.length === 0 ? (
                  <div className="rounded-xl border border-border/40 bg-secondary/10 py-12 text-center">
                    <BookTemplate className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">No import templates saved yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {impdpTemplates.map((tpl) => (
                      <div key={tpl.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/10 px-4 py-3 hover:bg-secondary/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{tpl.name}</p>
                            {tpl.db === selectedDb && (
                              <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">Current DB</span>
                            )}
                            {tpl.params.drop_user === "yes" && (
                              <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-300">DROP USER</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            DB: {tpl.db} · Schemas: {tpl.params.SCHEMAS?.join(", ") || "None"} · {new Date(tpl.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => handleLoadTemplate(tpl)} className="h-7 gap-1 text-xs">
                            <Play className="h-3 w-3" /> Load
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteImpdpTemplate(tpl.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400">
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

        {/* Error */}
        {error && !isDone && (
          <div className="flex items-start gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p>{error}</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-violet-400/20 bg-violet-400/5 p-4 text-sm text-violet-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-400" />
            <div>
              <p className="font-medium">Import in progress…</p>
              <p className="text-xs text-muted-foreground">You can close this modal — status will update in the Active Jobs banner.</p>
            </div>
          </div>
        )}

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isLoading ? "Running in background…" : "Close"}
          </Button>
          {isDone ? (
            <Button variant="outline" onClick={() => { setResponse(null); setStatus("idle"); setWizardStep("dumpfile"); }} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Run Again
            </Button>
          ) : wizardStep === "dumpfile" ? (
            <Button
              id="btn-confirm-dumpfile"
              onClick={confirmDumpfile}
              disabled={dumpfileFetching || !editedDumpfile.trim()}
              className="min-w-44 gap-2 bg-violet-500/80 text-white hover:bg-violet-500"
            >
              {dumpfileFetching ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Fetching…</>
              ) : (
                <>Confirm Dump File →</>
              )}
            </Button>
          ) : (
            <Button
              id="btn-execute-impdp"
              onClick={handleSubmit}
              disabled={isLoading}
              className="min-w-48 gap-2 bg-violet-500/80 text-white hover:bg-violet-500"
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
              ) : (
                <><Play className="h-4 w-4" /> Run Import (IMPDP)</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
