"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookTemplate,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileOutput,
  HardDrive,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Server,
  Table,
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
import { createExpdpTemplateApi, deleteExpdpTemplateApi, executeDBAAction, fetchDatabases, fetchExpdpTemplatesApi, recordDataPumpJobApi } from "@/services/api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { DataPumpJob, DatabaseInventoryItem, DbaResponse, ExpdpParams, ExpdpTemplate } from "@/types/dba";

/* ------------------------------------------------------------------ */
/* Constants                                                             */
/* ------------------------------------------------------------------ */

type DataPumpMode = "FULL" | "SCHEMAS" | "TABLES" | "TABLESPACES";

const OPTIONAL_PARAMS = [
  "COMPRESSION", "EXCLUDE", "INCLUDE",
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
  PARALLEL: null,
  FILESIZE: null
};

const DEFAULT_PARAMS: ExpdpParams = {
  DIRECTORY: "DP_DIR",
  DUMPFILE: "exp_%U.dmp",
  LOGFILE: "exp.log",
  SCHEMAS: [],
  TABLES: "",
  TABLESPACES: "",
  FULL: "Y"
};

/* ------------------------------------------------------------------ */
/* Props & Sub-components                                               */
/* ------------------------------------------------------------------ */

interface ExpdpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
/* Main Modal Component                                                  */
/* ------------------------------------------------------------------ */

export function ExpdpModal({ open, onOpenChange }: ExpdpModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const databases = useAppStore((s) => s.databases);
  const user = useAppStore((s) => s.user);
  const upsertDataPumpJob = useAppStore((s) => s.upsertDataPumpJob);
  const expdpTemplates = useAppStore((s) => s.expdpTemplates);
  const setExpdpTemplates = useAppStore((s) => s.setExpdpTemplates);
  const addExpdpTemplate = useAppStore((s) => s.addExpdpTemplate);
  const deleteExpdpTemplate = useAppStore((s) => s.deleteExpdpTemplate);
  const dbTarget = databases.find((db) => db.name === selectedDb);

  const [inventoryList, setInventoryList] = useState<DatabaseInventoryItem[]>([]);

  useEffect(() => {
    if (open) {
      fetchExpdpTemplatesApi()
        .then((res) => {
          if (Array.isArray(res.templates)) {
            setExpdpTemplates(res.templates);
          }
        })
        .catch(() => {
          // Silently retain existing templates on network error
        });

      fetchDatabases()
        .then((res) => {
          if (Array.isArray(res.databases)) {
            setInventoryList(res.databases);
          }
        })
        .catch(() => {
          // Silently retain existing databases on error
        });
    }
  }, [open, setExpdpTemplates]);

  // Mode & Form state
  const [mode, setMode] = useState<DataPumpMode>("FULL");
  const [params, setParams] = useState<ExpdpParams>({ ...DEFAULT_PARAMS });
  const [extraParams, setExtraParams] = useState<Array<{ key: string; value: string }>>([]);
  const [dumpTransfer, setDumpTransfer] = useState(false);
  const [transferServer, setTransferServer] = useState("");

  // Extract unique SERVER_IPs from database_inventory
  const serverIpOptions = useMemo(() => {
    const allItems = [...databases, ...inventoryList];
    const ipMap = new Map<string, { ip: string; label: string }>();

    for (const db of allItems) {
      if (db.server_ip && db.server_ip.trim()) {
        const ip = db.server_ip.trim();
        if (!ipMap.has(ip)) {
          const info = db.server_name?.trim() || db.name?.trim() || "";
          const label = info ? `${ip} (${info})` : ip;
          ipMap.set(ip, { ip, label });
        }
      }
    }

    if (transferServer && !ipMap.has(transferServer)) {
      ipMap.set(transferServer, { ip: transferServer, label: transferServer });
    }

    return Array.from(ipMap.values());
  }, [databases, inventoryList, transferServer]);

  // UI state
  const [tab, setTab] = useState<"form" | "templates">("form");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [response, setResponse] = useState<DbaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addParamOpen, setAddParamOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  /* ── Validation Engine ── */
  const validation = useMemo(() => {
    const isFullY = params.FULL === "Y" || mode === "FULL";
    const schemas = params.SCHEMAS || [];
    const hasSchemas = Array.isArray(schemas) && schemas.length > 0;

    const tablesVal = (params.TABLES || extraParams.find((e) => e.key === "TABLES")?.value || "").trim();
    const hasTables = Boolean(tablesVal);

    const tablespacesVal = (params.TABLESPACES || extraParams.find((e) => e.key === "TABLESPACES")?.value || "").trim();
    const hasTablespaces = Boolean(tablespacesVal);

    const activeSubModes: string[] = [];
    if (hasSchemas) activeSubModes.push("SCHEMAS");
    if (hasTables) activeSubModes.push("TABLES");
    if (hasTablespaces) activeSubModes.push("TABLESPACES");

    // Rule 1: FULL=Y cannot be combined with SCHEMAS, TABLES, or TABLESPACES
    if (isFullY && activeSubModes.length > 0) {
      return {
        isValid: false,
        error: `FULL=Y cannot be combined with ${activeSubModes.join(", ")}. Please remove object parameters or select non-FULL mode.`
      };
    }

    // Rule 2: When FULL is omitted or FULL=N, check for multiple conflicting sub-modes
    if (!isFullY && activeSubModes.length > 1) {
      return {
        isValid: false,
        error: `Conflicting Data Pump modes: ${activeSubModes.join(" and ")}. Exactly one mode must be specified when FULL=N.`
      };
    }

    return { isValid: true, error: null };
  }, [params, extraParams, mode]);

  /* ── Full payload ── */
  const fullPayload = useMemo(() => {
    const allParams: Record<string, unknown> = {
      DIRECTORY: params.DIRECTORY,
      DUMPFILE: params.DUMPFILE,
      LOGFILE: params.LOGFILE,
    };

    if (mode === "FULL" || params.FULL === "Y") {
      allParams.FULL = "Y";
    } else if (mode === "SCHEMAS" && params.SCHEMAS && params.SCHEMAS.length > 0) {
      allParams.FULL = "N";
      allParams.SCHEMAS = params.SCHEMAS;
    } else if (mode === "TABLES" && params.TABLES) {
      allParams.FULL = "N";
      allParams.TABLES = params.TABLES;
    } else if (mode === "TABLESPACES" && params.TABLESPACES) {
      allParams.FULL = "N";
      allParams.TABLESPACES = params.TABLESPACES;
    } else {
      if (params.FULL) allParams.FULL = params.FULL;
      if (params.SCHEMAS && params.SCHEMAS.length > 0) allParams.SCHEMAS = params.SCHEMAS;
      if (params.TABLES) allParams.TABLES = params.TABLES;
      if (params.TABLESPACES) allParams.TABLESPACES = params.TABLESPACES;
    }

    // Extra optional params
    for (const { key, value } of extraParams) {
      if (key && value && !["FULL", "SCHEMAS", "TABLES", "TABLESPACES"].includes(key)) {
        allParams[key] = value;
      }
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
  }, [params, extraParams, dumpTransfer, transferServer, selectedDb, user, dbTarget, mode]);

  /* ── Reset on open ── */
  useEffect(() => {
    if (open) {
      setMode("FULL");
      setParams({ ...DEFAULT_PARAMS });
      setExtraParams([]);
      setDumpTransfer(false);
      setTransferServer("");
      setTab("form");
      setStatus("idle");
      setResponse(null);
      setError(null);
      setTemplateName("");
    }
  }, [open]);

  useEffect(() => {
    if (open && (!transferServer || transferServer === "DMPSERVER01")) {
      if (serverIpOptions.length > 0) {
        setTransferServer(serverIpOptions[0].ip);
      }
    }
  }, [open, serverIpOptions, transferServer]);

  const recordJob = (job: DataPumpJob) => {
    const fullJob: DataPumpJob = {
      ...job,
      requested_by: user?.username || "dba"
    };
    upsertDataPumpJob(fullJob);
    recordDataPumpJobApi(fullJob).catch(() => {
      // Ignore API failure
    });
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!validation.isValid) {
      toast.error(validation.error || "Invalid Data Pump mode configuration");
      return;
    }

    if (mode === "SCHEMAS" && (!params.SCHEMAS || params.SCHEMAS.length === 0)) {
      toast.error("Please select at least one schema for export");
      return;
    }
    if (mode === "TABLES" && !params.TABLES?.trim()) {
      toast.error("Please specify table names (e.g. HR.EMPLOYEES)");
      return;
    }
    if (mode === "TABLESPACES" && !params.TABLESPACES?.trim()) {
      toast.error("Please specify tablespace names (e.g. USERS)");
      return;
    }

    setStatus("loading");
    setError(null);
    const jobId = `EXPDP-${Date.now()}`;
    const actionParams = { ...fullPayload.params, job_id: jobId };

    recordJob({
      id: jobId,
      operation: "expdp",
      db: selectedDb,
      status: "running",
      started_at: new Date().toISOString(),
      params: actionParams
    });

    try {
      const result = await executeDBAAction("expdp", selectedDb, actionParams);
      const isStillRunning = (result.raw_data as Record<string, unknown>)?.status === "running";

      setStatus("success");
      setResponse(result);

      recordJob({
        id: jobId,
        operation: "expdp",
        db: selectedDb,
        status: isStillRunning ? "running" : (result.status === "success" ? "success" : "error"),
        started_at: new Date().toISOString(),
        ...(isStillRunning ? {} : { completed_at: new Date().toISOString() }),
        message: result.ai_summary || (isStillRunning ? "Export running on server (waiting for agent callback...)" : "Export completed"),
        dump_file: (result.raw_data as Record<string, unknown>)?.dump_file as string | undefined,
        transfer_status: (result.raw_data as Record<string, unknown>)?.transfer_status as string | undefined,
        params: actionParams
      });

      if (isStillRunning) {
        toast.info("EXPDP export started", {
          description: "Export job is executing on the server. You can monitor progress in Active Jobs."
        });
      } else {
        toast.success("EXPDP completed", { description: result.ai_summary });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export request failed";
      const isAsyncOrTimeout =
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("fetch failed") ||
        msg.toLowerCase().includes("failed to fetch") ||
        msg.toLowerCase().includes("network") ||
        msg.toLowerCase().includes("abort") ||
        msg.toLowerCase().includes("connection") ||
        msg.toLowerCase().includes("socket") ||
        msg.toLowerCase().includes("504") ||
        msg.toLowerCase().includes("502") ||
        msg.toLowerCase().includes("500") ||
        msg.toLowerCase().includes("agent") ||
        msg.toLowerCase().includes("n8n");

      if (isAsyncOrTimeout) {
        setStatus("success");
        recordJob({
          id: jobId,
          operation: "expdp",
          db: selectedDb,
          status: "running",
          started_at: new Date().toISOString(),
          message: "In progress — waiting for agent callback…",
          params: actionParams
        });
        toast.info("EXPDP export running", {
          description: "Export job is executing on the database server. Status will update upon agent callback."
        });
      } else {
        setStatus("error");
        setError(msg);
        recordJob({
          id: jobId,
          operation: "expdp",
          db: selectedDb,
          status: "error",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          message: msg,
          params: actionParams
        });
      }
    }
  };

  /* ── Save template ── */
  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    setSavingTemplate(true);
    const tplParams: ExpdpParams = {
      ...params,
      ...(dumpTransfer ? { dump_transfer_required: "yes" as const, transfer_server: transferServer } : { dump_transfer_required: "no" as const })
    };
    for (const { key, value } of extraParams) {
      if (key && value) (tplParams as Record<string, unknown>)[key] = value;
    }

    try {
      const res = await createExpdpTemplateApi({
        name: templateName.trim(),
        db: selectedDb,
        params: tplParams
      });
      addExpdpTemplate(res.template);
      toast.success(`Template "${res.template.name}" saved to database`);
    } catch {
      const fallbackTpl: ExpdpTemplate = {
        id: `EXPTPL-${Date.now()}`,
        name: templateName.trim(),
        db: selectedDb,
        created_at: new Date().toISOString(),
        created_by: user?.username || "dba",
        params: tplParams
      };
      addExpdpTemplate(fallbackTpl);
      toast.success(`Template "${fallbackTpl.name}" saved locally`);
    } finally {
      setTemplateName("");
      setSavingTemplate(false);
    }
  };

  /* ── Delete template ── */
  const handleDeleteTemplate = async (tpl: ExpdpTemplate) => {
    try {
      await deleteExpdpTemplateApi(tpl.id);
    } catch {
      // Ignore API error for offline/fallback templates
    }
    deleteExpdpTemplate(tpl.id);
    toast.info(`Template "${tpl.name}" deleted`);
  };

  /* ── Load template ── */
  const handleLoadTemplate = (tpl: ExpdpTemplate) => {
    const { DIRECTORY, DUMPFILE, LOGFILE, SCHEMAS, TABLES, TABLESPACES, FULL, dump_transfer_required, transfer_server, ...rest } = tpl.params;

    let detectedMode: DataPumpMode = "FULL";
    if (FULL === "Y") {
      detectedMode = "FULL";
    } else if (TABLES && String(TABLES).trim()) {
      detectedMode = "TABLES";
    } else if (TABLESPACES && String(TABLESPACES).trim()) {
      detectedMode = "TABLESPACES";
    } else if (Array.isArray(SCHEMAS) && SCHEMAS.length > 0) {
      detectedMode = "SCHEMAS";
    }

    setMode(detectedMode);
    setParams({
      DIRECTORY: DIRECTORY || "DP_DIR",
      DUMPFILE: DUMPFILE || "exp_%U.dmp",
      LOGFILE: LOGFILE || "exp.log",
      SCHEMAS: SCHEMAS || [],
      TABLES: (TABLES as string) || "",
      TABLESPACES: (TABLESPACES as string) || "",
      FULL: FULL || (detectedMode === "FULL" ? "Y" : "N")
    });

    const extras: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null && !["FULL", "SCHEMAS", "TABLES", "TABLESPACES"].includes(k)) {
        extras.push({ key: k, value: String(v) });
      }
    }
    setExtraParams(extras);
    setDumpTransfer(dump_transfer_required === "yes");
    if (transfer_server) setTransferServer(transfer_server);
    setTab("form");
    toast.info(`Template "${tpl.name}" loaded (${detectedMode} mode)`);
  };

  const addableParams = OPTIONAL_PARAMS.filter((p) => !extraParams.some((e) => e.key === p));
  const isLoading = status === "loading";
  const isDone = response !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader className="space-y-3">
          {/* Header Banner with Database Display */}
          <div className="flex flex-col gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 shrink-0">
                <FileOutput className="h-5 w-5 text-amber-300" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">Oracle Data Pump Export (EXPDP)</DialogTitle>
                <DialogDescription className="text-xs">
                  Configure export parameters — agent builds and executes the expdp command on the Oracle server.
                </DialogDescription>
              </div>
            </div>

            {/* Target Database Badge */}
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 shrink-0">
              <Database className="h-4 w-4 text-amber-400" />
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-amber-200">{selectedDb || "No DB Selected"}</span>
                  {dbTarget?.env_label && (
                    <span className="rounded bg-amber-400/20 px-1.5 py-0.2 text-[10px] font-semibold text-amber-300">
                      {dbTarget.env_label}
                    </span>
                  )}
                </div>
                {dbTarget?.server_ip && (
                  <p className="font-mono text-[10px] text-muted-foreground">{dbTarget.server_ip} {dbTarget?.db_type ? `(${dbTarget.db_type})` : ""}</p>
                )}
              </div>
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
            <Tabs value={tab} onValueChange={(v) => setTab(v as "form" | "templates")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="form" className="gap-1.5">
                  <Layers className="h-3.5 w-3.5" /> Form
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

                {/* ── Structured Mode Selector ── */}
                <div className="space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">
                      Export Mode Selection
                    </Label>
                    <span className="text-[11px] text-muted-foreground">
                      Target Database: <strong className="font-mono text-amber-300">{selectedDb}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {/* Card 1: FULL */}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("FULL");
                        setParams((p) => ({ ...p, FULL: "Y", SCHEMAS: [], TABLES: "", TABLESPACES: "" }));
                      }}
                      className={cn(
                        "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all",
                        mode === "FULL"
                          ? "border-amber-400 bg-amber-400/15 text-amber-200 shadow-sm"
                          : "border-border/60 bg-background/40 hover:border-amber-400/40 hover:bg-background/70"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-xs">
                        <Database className="h-3.5 w-3.5 text-amber-400" />
                        FULL Database
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        FULL=Y complete DB export
                      </span>
                    </button>

                    {/* Card 2: SCHEMAS */}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("SCHEMAS");
                        setParams((p) => ({ ...p, FULL: "N", TABLES: "", TABLESPACES: "" }));
                      }}
                      className={cn(
                        "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all",
                        mode === "SCHEMAS"
                          ? "border-amber-400 bg-amber-400/15 text-amber-200 shadow-sm"
                          : "border-border/60 bg-background/40 hover:border-amber-400/40 hover:bg-background/70"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-xs">
                        <Layers className="h-3.5 w-3.5 text-amber-400" />
                        Schemas
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        SCHEMAS=schema1,schema2
                      </span>
                    </button>

                    {/* Card 3: TABLES */}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("TABLES");
                        setParams((p) => ({ ...p, FULL: "N", SCHEMAS: [], TABLESPACES: "" }));
                      }}
                      className={cn(
                        "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all",
                        mode === "TABLES"
                          ? "border-amber-400 bg-amber-400/15 text-amber-200 shadow-sm"
                          : "border-border/60 bg-background/40 hover:border-amber-400/40 hover:bg-background/70"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-xs">
                        <Table className="h-3.5 w-3.5 text-amber-400" />
                        Tables
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        TABLES=schema.t1,schema.t2
                      </span>
                    </button>

                    {/* Card 4: TABLESPACES */}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("TABLESPACES");
                        setParams((p) => ({ ...p, FULL: "N", SCHEMAS: [], TABLES: "" }));
                      }}
                      className={cn(
                        "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all",
                        mode === "TABLESPACES"
                          ? "border-amber-400 bg-amber-400/15 text-amber-200 shadow-sm"
                          : "border-border/60 bg-background/40 hover:border-amber-400/40 hover:bg-background/70"
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-xs">
                        <HardDrive className="h-3.5 w-3.5 text-amber-400" />
                        Tablespaces
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        TABLESPACES=tbs1,tbs2
                      </span>
                    </button>
                  </div>

                  {/* Mode Active Dynamic Input */}
                  <div className="mt-3 pt-2.5 border-t border-amber-400/15">
                    {mode === "FULL" && (
                      <p className="text-xs text-muted-foreground">
                        ℹ️ <strong>FULL=Y</strong> — Performs a complete database export, including all user schemas, objects, and database metadata (subject to user privileges).
                      </p>
                    )}

                    {mode === "SCHEMAS" && (
                      <div className="space-y-1.5">
                        <Label className="font-mono text-xs text-amber-300/80">SCHEMAS (Select schemas from database)</Label>
                        <SchemaPicker
                          selected={params.SCHEMAS || []}
                          onChange={(s) => setParams((p) => ({ ...p, SCHEMAS: s }))}
                        />
                        <p className="text-[11px] text-muted-foreground">SCHEMAS=schema1,schema2 — Processes specified schemas and all objects belonging to them.</p>
                      </div>
                    )}

                    {mode === "TABLES" && (
                      <div className="space-y-1.5">
                        <Label className="font-mono text-xs text-amber-300/80">TABLES (Comma-separated schema.table)</Label>
                        <Input
                          value={params.TABLES || ""}
                          onChange={(e) => setParams((p) => ({ ...p, TABLES: e.target.value }))}
                          className="font-mono text-xs"
                          placeholder="e.g. HR.EMPLOYEES, SCOTT.EMP"
                        />
                        <p className="text-[11px] text-muted-foreground">TABLES=schema.table1,schema.table2 — Export only specified tables.</p>
                      </div>
                    )}

                    {mode === "TABLESPACES" && (
                      <div className="space-y-1.5">
                        <Label className="font-mono text-xs text-amber-300/80">TABLESPACES (Comma-separated tablespaces)</Label>
                        <Input
                          value={params.TABLESPACES || ""}
                          onChange={(e) => setParams((p) => ({ ...p, TABLESPACES: e.target.value }))}
                          className="font-mono text-xs"
                          placeholder="e.g. USERS, DATA_TBS"
                        />
                        <p className="text-[11px] text-muted-foreground">TABLESPACES=tbs1,tbs2 — Export all objects in specified tablespaces.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Validation Error Banner */}
                {!validation.isValid && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-400/40 bg-red-500/10 p-3.5 text-xs text-red-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    <div>
                      <p className="font-semibold text-red-300">Data Pump Mode Parameter Conflict</p>
                      <p className="mt-0.5 text-red-200/90">{validation.error}</p>
                    </div>
                  </div>
                )}

                <div className="grid gap-5 md:grid-cols-2">
                  {/* Left — Required file parameters */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">File Parameters</p>

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
                            Destination Server IP
                          </Label>
                          <Select value={transferServer} onValueChange={setTransferServer}>
                            <SelectTrigger id="expdp-transfer-server">
                              <SelectValue placeholder="Select Destination Server IP" />
                            </SelectTrigger>
                            <SelectContent>
                              {serverIpOptions.length > 0 ? (
                                serverIpOptions.map((opt) => (
                                  <SelectItem key={opt.ip} value={opt.ip}>
                                    {opt.label}
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="none" disabled>
                                  No SERVER_IP found in database_inventory
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info banner */}
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-300">ℹ️ Agent execution flow:</p>
                  <p className="mt-1 text-xs text-muted-foreground font-mono leading-5">
                    Build EXPDP command → SSH to DB server ({selectedDb}) → Execute expdp
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
                              DB: {tpl.db || "Default"} · Mode: {tpl.params.FULL === "Y" ? "FULL" : tpl.params.TABLES ? "TABLES" : tpl.params.TABLESPACES ? "TABLESPACES" : "SCHEMAS"} · Schemas: {tpl.params.SCHEMAS?.join(", ") || "None"}{tpl.created_by ? ` · By: ${tpl.created_by}` : ""} · {new Date(tpl.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => handleLoadTemplate(tpl)} className="h-7 gap-1 text-xs">
                              <Play className="h-3 w-3" />
                              Load
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDeleteTemplate(tpl)} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400">
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
              disabled={isLoading || !validation.isValid}
              className="min-w-48 gap-2 bg-amber-500/80 text-white hover:bg-amber-500 disabled:opacity-50"
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
