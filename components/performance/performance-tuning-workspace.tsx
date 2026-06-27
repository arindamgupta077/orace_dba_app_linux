"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { ChevronDown, ChevronUp, Download, Loader2, Play, RefreshCcw, ShieldAlert, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/visual/status-badge";
import { getActionDefinition } from "@/lib/action-catalog";
import { cn, downloadText, toCsv } from "@/lib/utils";
import { useDbaAction } from "@/hooks/use-dba-action";
import { useAppStore } from "@/store/use-app-store";
import { fetchPerformanceAuditLogs, fetchPerformanceRunAllHistory, type PerformanceRunAllHistoryResponse } from "@/services/api";
import type { AuditLogItem, DbaAction, DbaActionDefinition, DbaParameterField, DbaResponse } from "@/types/dba";

interface ResultColumn {
  label: string;
  keys: string[];
  className?: string;
  mono?: boolean;
}

interface PerformanceActionConfig {
  action: DbaAction;
  resultKeys: string[];
  columns: ResultColumn[];
  csvName: string;
}

/**
 * Represents the latest RUN ALL result loaded from performance_run_all_hist.
 * All fields are taken directly from the DB row returned by /api/performance/history.
 */
interface RunAllSource {
  /** Raw response-shaped object reconstructed from metrics_payload + ai_summary */
  response: DbaResponse;
  createdAt?: string | null;
  requestedBy?: string | null;
  db?: string;
}

/**
 * Convert a performance_run_all_hist DB row into the RunAllSource shape the
 * existing RunAllResult / RunAllTables components understand.
 */
function historyRowToRunAllSource(
  row: PerformanceRunAllHistoryResponse,
  requestId: string
): RunAllSource {
  const raw = (row.metrics_payload ?? {}) as Record<string, unknown>;
  return {
    response: {
      request_id: requestId,
      action: "check_performance",
      db_status: "healthy",
      status: "success",
      ai_summary: row.ai_summary ?? "",
      raw_output: "",
      raw_data: raw,
      findings: [],
      recommendations: []
    },
    createdAt: row.created_at ?? null,
    requestedBy: row.refreshed_by ?? null,
    db: row.db_name
  };
}

const PERFORMANCE_ACTIONS: PerformanceActionConfig[] = [
  {
    action: "top_sql",
    resultKeys: ["top_sql", "sql", "rows"],
    csvName: "top-sql.csv",
    columns: [
      { label: "SQL ID", keys: ["sql_id"], mono: true },
      { label: "Executions", keys: ["executions"], className: "text-right" },
      { label: "Elapsed Sec", keys: ["elapsed_sec"], className: "text-right" },
      { label: "CPU Sec", keys: ["cpu_sec"], className: "text-right" },
      { label: "Buffer Gets", keys: ["buffer_gets"], className: "text-right" },
      { label: "Disk Reads", keys: ["disk_reads"], className: "text-right" },
      { label: "SQL Text", keys: ["sql_text"], mono: true, className: "min-w-80" }
    ]
  },
  {
    action: "cpu_usage",
    resultKeys: ["cpu_usage", "rows"],
    csvName: "cpu-usage.csv",
    columns: [
      { label: "CPUs", keys: ["num_cpus"], className: "text-right" },
      { label: "Total CPU %", keys: ["current_total_cpu_util"], className: "text-right" },
      { label: "User CPU %", keys: ["user_cpu_util"], className: "text-right" },
      { label: "System CPU %", keys: ["system_cpu_util"], className: "text-right" }
    ]
  },
  {
    action: "wait_events",
    resultKeys: ["wait_events", "rows"],
    csvName: "wait-events.csv",
    columns: [
      { label: "Event", keys: ["event"], className: "min-w-72" },
      { label: "Wait Class", keys: ["wait_class"] },
      { label: "Total Waits", keys: ["total_waits"], className: "text-right" },
      { label: "Waited Sec", keys: ["time_waited_sec"], className: "text-right" },
      { label: "Avg Wait CS", keys: ["avg_wait_cs"], className: "text-right" }
    ]
  },
  {
    action: "SESSION_LONGOPS",
    resultKeys: ["session_longops", "SESSION_LONGOPS", "rows"],
    csvName: "session-longops.csv",
    columns: [
      { label: "SID", keys: ["sid"], className: "text-right" },
      { label: "Serial#", keys: ["serial#", "serial"], className: "text-right" },
      { label: "Username", keys: ["username"] },
      { label: "SQL ID", keys: ["sql_id"], mono: true },
      { label: "Operation", keys: ["operation"], className: "min-w-56" },
      { label: "% Done", keys: ["pct_done"], className: "text-right" },
      { label: "Elapsed Min", keys: ["elapsed_min"], className: "text-right" },
      { label: "ETA Min", keys: ["eta_min"], className: "text-right" }
    ]
  },
  {
    action: "invalid_obejcts",
    resultKeys: ["invalid_obejcts", "invalid_objects", "rows"],
    csvName: "invalid-objects.csv",
    columns: [
      { label: "Owner", keys: ["owner"] },
      { label: "Type", keys: ["object_type"] },
      { label: "Object Name", keys: ["object_name"], mono: true, className: "min-w-64" },
      { label: "Status", keys: ["status"] },
      { label: "Last Modified", keys: ["last_modified", "last_ddl_time"] }
    ]
  },
  {
    action: "session_list",
    resultKeys: ["sessions", "session_list", "rows"],
    csvName: "sessions.csv",
    columns: [
      { label: "SID", keys: ["sid"], className: "text-right" },
      { label: "Serial#", keys: ["serial#", "serial"], className: "text-right" },
      { label: "Username", keys: ["username"] },
      { label: "OS User", keys: ["osuser"] },
      { label: "SQL ID", keys: ["sql_id"], mono: true },
      { label: "Event", keys: ["event", "wait_event"], className: "min-w-64" },
      { label: "State", keys: ["state", "status"] },
      { label: "Wait Sec", keys: ["seconds_in_wait"], className: "text-right" },
      { label: "Last Call", keys: ["last_call_et"], className: "text-right" }
    ]
  },
  {
    action: "lock_check",
    resultKeys: ["locks", "lock_check", "rows"],
    csvName: "blocking-sessions.csv",
    columns: [
      { label: "Waiter SID", keys: ["waiter_sid"], className: "text-right" },
      { label: "Waiter Serial", keys: ["waiter_serial"], className: "text-right" },
      { label: "Waiter User", keys: ["waiter_user"] },
      { label: "Waiter SQL", keys: ["waiter_sql_id"], mono: true },
      { label: "Blocker SID", keys: ["blocker_sid"], className: "text-right" },
      { label: "Blocker Serial", keys: ["blocker_serial"], className: "text-right" },
      { label: "Blocker User", keys: ["blocker_user"] },
      { label: "Blocker SQL", keys: ["blocker_sql_id"], mono: true },
      { label: "Waiting Min", keys: ["waiting_min"], className: "text-right" },
      { label: "Event", keys: ["event"], className: "min-w-64" }
    ]
  },
  {
    action: "long_queries",
    resultKeys: ["long_queries", "rows"],
    csvName: "long-running-queries.csv",
    columns: [
      { label: "SID", keys: ["sid"], className: "text-right" },
      { label: "Serial#", keys: ["serial#", "serial"], className: "text-right" },
      { label: "Username", keys: ["username"] },
      { label: "Machine", keys: ["machine"], className: "min-w-48" },
      { label: "Running Sec", keys: ["running_seconds", "last_call_et"], className: "text-right" },
      { label: "SQL ID", keys: ["sql_id"], mono: true },
      { label: "SQL Text", keys: ["sql_text"], mono: true, className: "min-w-96" }
    ]
  }
];

function defaultParams(fields: DbaParameterField[]) {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    acc[field.name] = field.defaultValue ?? (field.type === "checkbox" ? false : "");
    return acc;
  }, {});
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getRecordValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in row) return row[key];
  }

  const normalized = new Map(Object.keys(row).map((key) => [normalizeKey(key), key]));
  for (const key of keys) {
    const match = normalized.get(normalizeKey(key));
    if (match) return row[match];
  }

  return undefined;
}

function formatCell(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getRows(response: DbaResponse | null, config?: PerformanceActionConfig) {
  if (!response || !config) return [];
  for (const key of config.resultKeys) {
    const value = response.raw_data[key];
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.rows)) return record.rows as Array<Record<string, unknown>>;
      if (Array.isArray(record.data)) return record.data as Array<Record<string, unknown>>;
      if (Array.isArray(record.items)) return record.items as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function getRawResultValue(response: DbaResponse | null, config: PerformanceActionConfig) {
  if (!response) return undefined;
  for (const key of config.resultKeys) {
    const value = response.raw_data[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function getPerformanceResultLabel(response: DbaResponse, action: DbaAction) {
  const rawResults = response.raw_data.performance_results;
  if (!Array.isArray(rawResults)) return undefined;

  const match = rawResults.find((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return String(getRecordValue(row, ["action", "check", "name"]) || "") === action;
  });

  if (!match || typeof match !== "object") return undefined;
  const result = getRecordValue(match as Record<string, unknown>, ["result", "summary", "status", "row_count", "rows"]);
  return result == null ? undefined : String(result);
}

function summarizeResult(response: DbaResponse, config: PerformanceActionConfig) {
  const explicitLabel = getPerformanceResultLabel(response, config.action);
  if (explicitLabel) return explicitLabel;

  const rawValue = getRawResultValue(response, config);
  if (Array.isArray(rawValue)) {
    return `${rawValue.length.toLocaleString("en-US")} row${rawValue.length === 1 ? "" : "s"}`;
  }
  if (rawValue != null) return "Result returned";
  return response.ai_summary || "Completed";
}

function formatRunTime(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatIstTimestamp(value?: unknown) {
  if (!value) return "-";
  let rawValue = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(rawValue)) {
    rawValue = rawValue.replace(/\s+/, "T");
  }
  rawValue = rawValue.replace(/(\.\d{3})\d+/, "$1");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawValue) && !/(Z|[+-]\d{2}:?\d{2})$/.test(rawValue)) {
    rawValue = `${rawValue}+05:30`;
  }

  const date = value instanceof Date ? value : new Date(rawValue);
  if (Number.isNaN(date.valueOf())) return String(value);

  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(date)} IST`;
}

function getSchemas(response: DbaResponse | null) {
  if (!response) return [];
  const rawSchemas = response.raw_data.schemas;
  if (Array.isArray(rawSchemas)) {
    return rawSchemas
      .map((schema) => (typeof schema === "string" ? schema : ""))
      .filter(Boolean)
      .sort();
  }

  const rows = Array.isArray(response.raw_data.rows) ? response.raw_data.rows : [];
  return rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      return String(getRecordValue(record, ["username", "schema_name", "owner"]) || "");
    })
    .filter(Boolean)
    .sort();
}

function responseMessage(response: DbaResponse | null) {
  if (!response) return "";
  return response.raw_output || response.ai_summary || `Request ${response.request_id} completed.`;
}

function normalizeMarkdownText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
}

function normalizeEmoji(value: string) {
  return value.replace(/\ufe0f/g, "");
}

function splitMarkdownCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line?: string) {
  return Boolean(line && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line));
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}])/gu).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold text-amber-100">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("__") && part.endsWith("__")) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold text-amber-100">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return (
        <em key={`${part}-${index}`} className="text-cyan-100">
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${part}-${index}`} className="rounded border border-border/60 bg-black/30 px-1.5 py-0.5 font-mono text-xs text-cyan-100">
          {part.slice(1, -1)}
        </code>
      );
    }

    if (/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(normalizeEmoji(part))) {
      return (
        <span key={`${part}-${index}`} className="mx-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/15 px-1 text-sm">
          {part}
        </span>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function PerformanceTuningWorkspace() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const databases = useAppStore((state) => state.databases);
  const user = useAppStore((state) => state.user);
  const canExecute = useAppStore((state) => state.canExecute);
  const runAll = useDbaAction();
  const mainRun = useDbaAction();
  const schemaRun = useDbaAction();
  const secondaryRun = useDbaAction();
  const [activeDefinition, setActiveDefinition] = useState<DbaActionDefinition | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [killInactiveConfirmed, setKillInactiveConfirmed] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState("");
  const [secondaryTitle, setSecondaryTitle] = useState("");

  // ── Latest RUN ALL result from performance_run_all_hist ──────────
  // Loaded from the DB on mount and after each successful RUN ALL.
  const [latestRunAll, setLatestRunAll] = useState<RunAllSource | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Audit-log based card metadata ──────────────────────────────
  // Keyed by action name; fetched from APP_AUDIT_LOGS via the performance audit API.
  const [auditByAction, setAuditByAction] = useState<Record<string, AuditLogItem>>({});

  const loadAuditMeta = useCallback(async () => {
    if (!selectedDb) return;
    try {
      const data = await fetchPerformanceAuditLogs(selectedDb);
      if (data?.items) setAuditByAction(data.items);
    } catch {
      // Non-critical — cards simply show "Never" when audit data is unavailable.
    }
  }, [selectedDb]);

  /**
   * Fetch the latest check_performance run from performance_run_all_hist
   * and convert it into the RunAllSource shape used by the result panel.
   */
  const loadHistoryFromDb = useCallback(async () => {
    if (!selectedDb) return;
    setHistoryLoading(true);
    try {
      const row = await fetchPerformanceRunAllHistory(selectedDb);
      if (row.has_data) {
        setLatestRunAll(
          historyRowToRunAllSource(row, `HIST-${row.run_id ?? 0}`)
        );
      } else {
        setLatestRunAll(null);
      }
    } catch {
      // Non-critical — panel stays empty if fetch fails.
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedDb]);

  // Load persisted RUN ALL history whenever the selected database changes.
  useEffect(() => {
    void loadAuditMeta();
    void loadHistoryFromDb();
  }, [loadAuditMeta, loadHistoryFromDb]);

  const actions = useMemo(
    () =>
      PERFORMANCE_ACTIONS.map((config) => ({
        config,
        definition: getActionDefinition(config.action)
      })).filter((item): item is { config: PerformanceActionConfig; definition: DbaActionDefinition } => Boolean(item.definition)),
    []
  );

  const activeConfig = useMemo(
    () => PERFORMANCE_ACTIONS.find((config) => config.action === activeDefinition?.action),
    [activeDefinition?.action]
  );

  const rows = getRows(mainRun.response, activeConfig);
  const schemas = getSchemas(schemaRun.response);

  const payloadPreview = useMemo(() => {
    if (!activeDefinition) return "";
    const dbTarget = databases.find((db) => db.name === selectedDb);
    return JSON.stringify(
      {
        action: activeDefinition.action,
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
  }, [activeDefinition, databases, params, selectedDb, user?.userId, user?.username]);

  const openAction = (definition: DbaActionDefinition) => {
    mainRun.reset();
    schemaRun.reset();
    secondaryRun.reset();
    setActiveDefinition(definition);
    setParams(defaultParams(definition.params));
    setKillInactiveConfirmed(false);
    setSelectedSchema("");
    setSecondaryTitle("");
    setModalOpen(true);
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

    if (field.type === "checkbox") {
      return (
        <label className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 p-3 text-sm">
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} className="h-4 w-4 accent-red-500" />
          {field.label}
        </label>
      );
    }

    return (
      <Input
        type={field.type}
        value={String(value ?? "")}
        onChange={(event) => setValue(field.type === "number" ? Number(event.target.value) : event.target.value)}
        placeholder={field.placeholder}
        required={field.required}
      />
    );
  };

  const executeMainAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeDefinition) return;
    try {
      await mainRun.runAction(activeDefinition.action, params, selectedDb);
      // Refresh audit card metadata after a successful run so the card updates immediately.
      void loadAuditMeta();
    } catch {
      // The hook owns the user-facing error state and toast.
    }
  };

  const executeRunAll = async () => {
    setLatestRunAll(null);
    try {
      // Trigger the n8n check_performance workflow via webhook.
      // n8n will run all 8 queries, call the LLM node, and INSERT a row
      // into performance_run_all_hist before responding.
      await runAll.runAction("check_performance", {}, selectedDb);
      // Re-fetch the persisted row so the panel displays data from the DB.
      await loadHistoryFromDb();
      void loadAuditMeta();
    } catch {
      // The hook owns the user-facing error state and toast.
    }
  };

  const loadSchemas = async () => {
    try {
      await schemaRun.runAction("schema_list", {}, selectedDb);
    } catch {
      // The hook owns the user-facing error state and toast.
    }
  };

  const killInactiveSessions = async () => {
    if (!killInactiveConfirmed) return;
    setSecondaryTitle("Kill inactive sessions");
    try {
      await secondaryRun.runAction("kill_session", {}, selectedDb);
    } catch {
      // The hook owns the user-facing error state and toast.
    }
  };

  const recompileInvalidObjects = async () => {
    if (!selectedSchema) return;
    setSecondaryTitle(`Recompile ${selectedSchema}`);
    try {
      await secondaryRun.runAction("recompile_invalid", { schema_name: selectedSchema }, selectedDb);
    } catch {
      // The hook owns the user-facing error state and toast.
    }
  };

  return (
    <div>
      <PageHeader
        title="Performance Tuning"
        description="Run focused Oracle performance checks through n8n and review the returned rows in-place."
        icon={TrendingUp}
        actionLabel={runAll.status === "loading" ? "RUNNING..." : "RUN ALL"}
        actionDisabled={runAll.status === "loading" || !canExecute("check_performance")}
        onAction={executeRunAll}
      />

      {runAll.status === "loading" ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          <Loader2 className="h-4 w-4 animate-spin" />
          Running all performance checks through n8n — results will be saved to database.
        </div>
      ) : historyLoading ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border/40 bg-background/20 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading last RUN ALL result from database…
        </div>
      ) : null}

      {runAll.error ? <div className="mb-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{runAll.error}</div> : null}

      {latestRunAll ? <RunAllResult source={latestRunAll} configs={PERFORMANCE_ACTIONS} /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {actions.map(({ definition }) => {
          const Icon = (Icons[definition.icon as keyof typeof Icons] || Icons.Activity) as Icons.LucideIcon;
          const auditLog = auditByAction[definition.action] || null;
          return (
            <Card key={definition.action} className="h-full">
              <CardContent className="flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 p-2 text-cyan-200">
                    <Icon className="h-5 w-5" />
                  </span>
                  {definition.action === "invalid_obejcts" || definition.action === "session_list" ? (
                    <StatusBadge status="info">Tools</StatusBadge>
                  ) : null}
                </div>
                <div className="mt-4 flex-1">
                  <p className="font-medium">{definition.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{definition.description}</p>
                </div>
                <PerformanceRunMeta auditLog={auditLog} />
                <Button className="mt-4 w-full" variant="outline" onClick={() => openAction(definition)}>
                  <Play className="h-4 w-4" />
                  Execute
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activeDefinition?.title}</DialogTitle>
            <DialogDescription>{activeDefinition?.description}</DialogDescription>
          </DialogHeader>

          {activeDefinition ? (
            <form onSubmit={executeMainAction} className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4 rounded-lg border border-border/70 bg-background/35 p-4">
                  {activeDefinition.params.length ? (
                    activeDefinition.params.map((field) => (
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
                    <div className="rounded-md border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No parameters required.</div>
                  )}

                  {activeDefinition.action === "session_list" ? (
                    <div className="space-y-3 rounded-md border border-red-400/25 bg-red-500/10 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-red-100">
                        <Trash2 className="h-4 w-4" />
                        Inactive session cleanup
                      </div>
                      <label className="flex items-start gap-2 text-sm text-red-100/85">
                        <input
                          type="checkbox"
                          checked={killInactiveConfirmed}
                          onChange={(event) => setKillInactiveConfirmed(event.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-red-500"
                        />
                        Kill inactive USER sessions idle for more than 30 minutes, excluding SYS and SYSTEM.
                      </label>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={!killInactiveConfirmed || secondaryRun.status === "loading" || !canExecute("kill_session")}
                        onClick={killInactiveSessions}
                      >
                        {secondaryRun.status === "loading" && secondaryTitle === "Kill inactive sessions" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                        Kill inactive sessions
                      </Button>
                    </div>
                  ) : null}

                  {activeDefinition.action === "invalid_obejcts" ? (
                    <div className="space-y-3 rounded-md border border-cyan-400/25 bg-cyan-400/10 p-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-56 flex-1 space-y-2">
                          <Label>Schema</Label>
                          <Select value={selectedSchema} onValueChange={setSelectedSchema} disabled={!schemas.length}>
                            <SelectTrigger>
                              <SelectValue placeholder={schemas.length ? "Select schema" : "Load schemas first"} />
                            </SelectTrigger>
                            <SelectContent>
                              {schemas.map((schema) => (
                                <SelectItem key={schema} value={schema}>
                                  {schema}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" variant="outline" onClick={loadSchemas} disabled={schemaRun.status === "loading" || !canExecute("schema_list")}>
                          {schemaRun.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                          Load schemas
                        </Button>
                        <Button type="button" variant="neon" onClick={recompileInvalidObjects} disabled={!selectedSchema || secondaryRun.status === "loading" || !canExecute("recompile_invalid")}>
                          {secondaryRun.status === "loading" && secondaryTitle.startsWith("Recompile") ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                          Recompile invalid
                        </Button>
                      </div>
                      {schemaRun.error ? <p className="text-sm text-red-200">{schemaRun.error}</p> : null}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Generated JSON Request</Label>
                    <StatusBadge status={canExecute(activeDefinition.action) ? "healthy" : "critical"}>
                      {canExecute(activeDefinition.action) ? "Allowed" : "RBAC Denied"}
                    </StatusBadge>
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-md border border-border/70 bg-black/40 p-4 text-xs text-cyan-100">{payloadPreview}</pre>
                </div>
              </div>

              {mainRun.error ? <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{mainRun.error}</div> : null}

              {mainRun.response && activeConfig ? <PerformanceResult response={mainRun.response} rows={rows} config={activeConfig} /> : null}

              {secondaryRun.response ? (
                <div className="rounded-lg border border-border/70 bg-background/35 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{secondaryTitle}</p>
                      <p className="text-xs text-muted-foreground">Request {secondaryRun.response.request_id}</p>
                    </div>
                    <StatusBadge status={secondaryRun.response.status}>{secondaryRun.response.status}</StatusBadge>
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-md border border-border/70 bg-black/40 p-4 text-xs text-slate-100">
                    {responseMessage(secondaryRun.response)}
                  </pre>
                </div>
              ) : null}

              {secondaryRun.error ? <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{secondaryRun.error}</div> : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Close
                </Button>
                <Button type="submit" disabled={mainRun.status === "loading" || !canExecute(activeDefinition.action)} className="min-w-36">
                  {mainRun.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {mainRun.status === "loading" ? "Running..." : "Execute"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PerformanceRunMeta({ auditLog }: { auditLog: AuditLogItem | null }) {
  return (
    <div className="mt-4 space-y-2 rounded-md border border-border/60 bg-black/20 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-muted-foreground">Last run</span>
        <span className="text-right text-slate-100">
          {auditLog ? formatRunTime(auditLog.timestamp) : "Never"}
        </span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-muted-foreground">Username</span>
        <span className="max-w-32 truncate text-right font-mono text-cyan-100">
          {auditLog?.actor || "-"}
        </span>
      </div>
      {auditLog?.detail ? (
        <div className="space-y-0.5">
          <span className="text-muted-foreground">Detail</span>
          <p className="mt-0.5 line-clamp-2 break-words text-slate-300">{auditLog.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

function RunAllResult({ source, configs }: { source: RunAllSource; configs: PerformanceActionConfig[] }) {
  const [summaryExpanded, setSummaryExpanded] = useState(true);

  return (
    <div className="mb-4 space-y-4 rounded-lg border border-border/70 bg-background/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Latest RUN ALL result</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last run {formatRunTime(source.createdAt)} by {source.requestedBy || "-"} - Request {source.response.request_id}
          </p>
        </div>
        <StatusBadge status={source.response.status}>{source.response.status}</StatusBadge>
      </div>

      <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-400/20 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 p-1.5 text-cyan-100">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-50">AI performance analysis</p>
              <p className="text-xs text-muted-foreground">Markdown, lists, tables, code, and emoji rendered for review.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setSummaryExpanded((current) => !current)}>
            {summaryExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {summaryExpanded ? "Collapse" : "Expand"}
          </Button>
        </div>
        {summaryExpanded ? (
          <div className="p-3">
            <MarkdownSummary text={source.response.ai_summary || "Performance analysis completed."} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {configs.map((config) => (
          <div key={config.action} className="rounded-md border border-border/60 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{getActionDefinition(config.action)?.title || config.action}</p>
            <p className="mt-2 text-sm font-medium text-slate-100">{summarizeResult(source.response, config)}</p>
          </div>
        ))}
      </div>

      {source.response.findings.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {source.response.findings.slice(0, 4).map((finding, index) => (
            <div key={finding.id || `${finding.title}-${index}`} className="rounded-md border border-border/60 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{finding.title}</p>
                <StatusBadge status={finding.severity}>{finding.severity}</StatusBadge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{finding.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      <RunAllTables response={source.response} configs={configs} createdAt={source.createdAt} />
    </div>
  );
}

function MarkdownSummary({ text }: { text: string }) {
  const lines = normalizeMarkdownText(text)
    .split("\n")
    .map((line) => line.trimEnd());
  const elements: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (line.includes("|") && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = splitMarkdownCells(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].includes("|")) {
        rows.push(splitMarkdownCells(lines[index]));
        index += 1;
      }

      elements.push(
        <div key={`table-${index}`} className="my-3 overflow-x-auto rounded-md border border-cyan-400/25 bg-slate-950/40">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header, headerIndex) => (
                  <TableHead key={`${header}-${headerIndex}`} className="whitespace-nowrap bg-cyan-400/10 text-cyan-100">
                    {renderInlineMarkdown(header)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {headers.map((_, cellIndex) => (
                    <TableCell key={cellIndex} className="whitespace-nowrap">
                      {renderInlineMarkdown(row[cellIndex] || "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const className =
        level <= 2
          ? "mt-4 rounded-md border-l-4 border-cyan-300 bg-cyan-300/10 px-3 py-2 text-base font-semibold text-slate-50"
          : "mt-3 rounded-md border-l-4 border-amber-300 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100";
      elements.push(
        <p key={`heading-${index}`} className={className}>
          {renderInlineMarkdown(heading[2])}
        </p>
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      elements.push(
        <ul key={`ul-${index}`} className="my-2 list-disc space-y-1 rounded-md border border-border/50 bg-slate-950/30 py-3 pl-8 pr-3 text-sm leading-6 text-slate-100 marker:text-cyan-300">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      elements.push(
        <ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 rounded-md border border-border/50 bg-slate-950/30 py-3 pl-8 pr-3 text-sm leading-6 text-slate-100 marker:font-semibold marker:text-amber-300">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    elements.push(
      <p key={`p-${index}`} className="rounded-md bg-slate-950/20 px-3 py-2 text-sm leading-7 text-slate-100">
        {renderInlineMarkdown(line)}
      </p>
    );
    index += 1;
  }

  return <div className="space-y-2 rounded-md border border-border/60 bg-black/20 p-4">{elements}</div>;
}

function RunAllTables({ response, configs, createdAt }: { response: DbaResponse; configs: PerformanceActionConfig[]; createdAt?: string | null }) {
  const tableConfigs = configs.map((config) => ({ config, rows: getRows(response, config) }));
  const defaultValue = tableConfigs[0]?.config.action;

  if (!defaultValue) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Detailed SQL outputs</p>
        <p className="mt-1 text-xs text-muted-foreground">Full row output returned by n8n for each performance check.</p>
      </div>
      <Tabs defaultValue={defaultValue}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-black/20">
          {tableConfigs.map(({ config, rows }) => (
            <TabsTrigger key={config.action} value={config.action} className="text-xs">
              {getActionDefinition(config.action)?.title || config.action}
              <span className="ml-1 text-muted-foreground">({rows.length})</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {tableConfigs.map(({ config, rows }) => (
          <TabsContent key={config.action} value={config.action} className="mt-3">
            <PerformanceRowsTable rows={rows} config={config} showDownload includeCreatedAt createdAtFallback={createdAt} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function PerformanceResult({ response, rows, config }: { response: DbaResponse; rows: Array<Record<string, unknown>>; config: PerformanceActionConfig }) {
  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-background/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Result</p>
          <p className="text-xs text-muted-foreground">Request {response.request_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={response.status}>{response.status}</StatusBadge>
          {rows.length ? (
            <Button type="button" variant="outline" size="sm" onClick={() => downloadText(config.csvName, toCsv(rows), "text/csv")}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
          ) : null}
        </div>
      </div>

      <PerformanceRowsTable rows={rows} config={config} />

      {response.raw_output ? <pre className="max-h-56 overflow-auto rounded-md border border-border/70 bg-black/40 p-4 text-xs text-slate-100">{response.raw_output}</pre> : null}
    </div>
  );
}

function PerformanceRowsTable({
  rows,
  config,
  showDownload = false,
  includeCreatedAt = false,
  createdAtFallback
}: {
  rows: Array<Record<string, unknown>>;
  config: PerformanceActionConfig;
  showDownload?: boolean;
  includeCreatedAt?: boolean;
  createdAtFallback?: string | null;
}) {
  if (!rows.length) {
    return <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">No rows returned.</div>;
  }

  return (
    <div className="rounded-lg border border-border/60">
      {showDownload ? (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 p-3">
          <p className="text-sm font-medium">
            {rows.length.toLocaleString("en-US")} row{rows.length === 1 ? "" : "s"}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => downloadText(config.csvName, toCsv(rows), "text/csv")}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      ) : null}
      <div className="max-h-[520px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {config.columns.map((column) => (
                <TableHead key={column.label} className={cn("sticky top-0 z-10 bg-card", column.className)}>
                  {column.label}
                </TableHead>
              ))}
              {includeCreatedAt ? <TableHead className="sticky top-0 z-10 min-w-52 bg-card">Created At (IST)</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {config.columns.map((column) => (
                  <TableCell key={column.label} className={cn(column.className, column.mono && "font-mono text-xs text-cyan-100")}>
                    {formatCell(getRecordValue(row, column.keys))}
                  </TableCell>
                ))}
                {includeCreatedAt ? (
                  <TableCell className="whitespace-nowrap font-mono text-xs text-amber-100">
                    {formatIstTimestamp(getRecordValue(row, ["created_at", "createdAt", "timestamp", "run_at", "run_time", "created_time"]) || createdAtFallback)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
