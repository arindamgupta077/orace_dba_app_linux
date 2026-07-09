"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/use-app-store";
import {
  acknowledgeDbaAlert,
  analyzeAlertLog,
  fetchDbaAlertLog,
  resolveDbaAlert,
  triggerAlertByLines,
  triggerAlertByTime
} from "@/services/api";
import type {
  DbaAlertLogRow,
  DbaAlertLogStatus,
  DiagAlertExtRow
} from "@/types/dba";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtTs(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium"
    });
  } catch {
    return iso;
  }
}

function severityColor(s: string) {
  if (s === "P1") return "border-l-red-500 bg-red-500/5";
  if (s === "P2") return "border-l-yellow-400 bg-yellow-400/5";
  return "border-l-blue-400 bg-blue-400/5";
}

function severityBadge(s: string) {
  if (s === "P1")
    return (
      <Badge className="border-red-500/50 bg-red-500/20 text-red-400 text-xs font-bold px-2 py-0.5">
        P1 CRITICAL
      </Badge>
    );
  if (s === "P2")
    return (
      <Badge className="border-yellow-400/50 bg-yellow-400/20 text-yellow-300 text-xs font-bold px-2 py-0.5">
        P2 HIGH
      </Badge>
    );
  return (
    <Badge className="border-blue-400/50 bg-blue-400/20 text-blue-400 text-xs font-bold px-2 py-0.5">
      INFO
    </Badge>
  );
}

function statusBadge(s: DbaAlertLogStatus) {
  if (s === "OPEN")
    return (
      <Badge className="border-red-500/40 bg-red-500/15 text-red-400 text-[11px] px-2 py-0.5 animate-pulse">
        ● OPEN
      </Badge>
    );
  if (s === "ACKNOWLEDGED")
    return (
      <Badge className="border-orange-400/40 bg-orange-400/15 text-orange-300 text-[11px] px-2 py-0.5">
        ◐ ACKNOWLEDGED
      </Badge>
    );
  return (
    <Badge className="border-emerald-400/40 bg-emerald-400/15 text-emerald-400 text-[11px] px-2 py-0.5">
      ✓ RESOLVED
    </Badge>
  );
}

const ORA_CODE_PATTERN = /ORA-\d{4,5}/i;
const ORA_SPLIT_PATTERN = /(ORA-\d{4,5})/gi;

type UnknownRecord = Record<string, unknown>;

function containsOra(text?: string | null) {
  return ORA_CODE_PATTERN.test(text || "");
}

function highlightOra(text: string) {
  const parts = text.split(ORA_SPLIT_PATTERN);
  return parts.map((part, i) =>
    containsOra(part) ? (
      <span key={i} className="font-bold text-red-400">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapN8nJson(value: unknown) {
  if (isRecord(value) && "json" in value) return value.json;
  return value;
}

function readField(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }

  const entries = Object.entries(record);
  for (const key of keys) {
    const found = entries.find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (found) return found[1];
  }

  return undefined;
}


function collectRecordRows(value: unknown, output: UnknownRecord[] = []) {
  const unwrapped = unwrapN8nJson(value);

  if (Array.isArray(unwrapped)) {
    for (const item of unwrapped) collectRecordRows(item, output);
    return output;
  }

  if (!isRecord(unwrapped)) return output;

  const nestedRows = readField(unwrapped, ["rows", "data", "items"]);
  if (Array.isArray(nestedRows)) {
    collectRecordRows(nestedRows, output);
    return output;
  }

  output.push(unwrapped);
  return output;
}

function toDisplayString(value: unknown): string {
  if (value == null) return "";
  // Oracle Date/Timestamp objects from n8n
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Some Oracle drivers return { value: "...", type: "date" }
    const rec = value as UnknownRecord;
    if ("value" in rec && (typeof rec.value === "string" || rec.value instanceof Date)) {
      return toDisplayString(rec.value);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function normalizeDiagAlertRow(value: unknown): DiagAlertExtRow | null {
  const unwrapped = unwrapN8nJson(value);
  if (!isRecord(unwrapped)) return null;

  const messageLevel = readField(unwrapped, ["message_level", "level", "MESSAGE_LEVEL"]);

  // Timestamp: handle string OR Date object from Oracle JDBC
  const tsRaw = readField(unwrapped, [
    "originating_timestamp",
    "timestamp",
    "event_timestamp",
    "time",
    "ORIGINATING_TIMESTAMP",
    "TIMESTAMP"
  ]);
  const tsStr = toDisplayString(tsRaw);

  const row: DiagAlertExtRow = {
    originating_timestamp: tsStr,
    message_type: toDisplayString(readField(unwrapped, ["message_type", "type", "MESSAGE_TYPE"])) || undefined,
    message_level:
      typeof messageLevel === "number"
        ? messageLevel
        : messageLevel == null
          ? undefined
          : String(messageLevel),
    problem_key: toDisplayString(readField(unwrapped, ["problem_key", "problemKey", "PROBLEM_KEY"])) || undefined,
    message_text: toDisplayString(
      readField(unwrapped, ["message_text", "message", "text", "line", "log", "MESSAGE_TEXT"])
    )
  };

  // Accept the row as long as it has at least one non-empty field
  return Object.values(row).some((v) => v != null && v !== "") ? row : null;
}

function extractDiagAlertRows(response: unknown) {
  const candidates: unknown[] = [];
  const responseRecord = isRecord(response) ? response : undefined;
  const rawData = responseRecord && responseRecord.raw_data !== null && responseRecord.raw_data !== undefined
    ? responseRecord.raw_data
    : undefined;

  // 1. If the response itself is an array (n8n array passed through directly)
  if (Array.isArray(response)) candidates.push(response);

  // 2. Top-level rows/data/items on the DbaResponse envelope
  if (responseRecord) {
    candidates.push(readField(responseRecord, ["rows", "data", "items"]));
  }

  // 3. raw_data — scan every key that holds an array
  if (rawData) {
    if (Array.isArray(rawData)) {
      // raw_data itself is an array
      candidates.push(rawData);
    } else if (isRecord(rawData)) {
      // Named sub-fields: rows, data, items, alerts, and ANY other array-valued field
      const namedArrays = readField(rawData as Record<string, unknown>, ["rows", "data", "items", "alerts"]);
      if (namedArrays != null) candidates.push(namedArrays);

      // Also scan every field in raw_data for arrays (catches custom field names)
      for (const val of Object.values(rawData as Record<string, unknown>)) {
        if (Array.isArray(val) && val.length > 0 && isRecord(val[0])) {
          candidates.push(val);
        }
      }
    }
  }

  // 4. raw_output — try to parse as JSON (array or object with rows)
  const rawOutput =
    responseRecord && typeof responseRecord.raw_output === "string"
      ? responseRecord.raw_output.trim()
      : "";
  if (rawOutput && (rawOutput.startsWith("[") || rawOutput.startsWith("{"))) {
    try {
      candidates.push(JSON.parse(rawOutput));
    } catch {
      // not valid JSON — ignore
    }
  }

  const result = candidates
    .flatMap((candidate) => collectRecordRows(candidate))
    .map(normalizeDiagAlertRow)
    .filter((row): row is DiagAlertExtRow => Boolean(row));

  // De-duplicate by timestamp+message
  const seen = new Set<string>();
  return result.filter((row) => {
    const key = `${row.originating_timestamp}|${row.message_text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FallbackRawTable — renders raw_data.rows exactly as returned (any columns)
// Used when smart extraction yields 0 rows but n8n did return data.
// ─────────────────────────────────────────────────────────────────────────────

function FallbackRawTable({ rawRows }: { rawRows: Record<string, unknown>[] }) {
  if (!rawRows.length) return null;

  const allKeys = Array.from(
    rawRows.reduce((acc, row) => {
      Object.keys(row).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>())
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-amber-400/30 bg-amber-400/5">
      <div className="flex items-center gap-2 border-b border-amber-400/20 px-3 py-2">
        <span className="text-[11px] text-amber-300 font-semibold">
          ⚠ Column mapping not matched — showing {rawRows.length} raw row{rawRows.length > 1 ? "s" : ""} from n8n
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40 bg-secondary/30">
            {allKeys.map((k) => (
              <th key={k} className="px-3 py-2 text-left text-muted-foreground font-medium whitespace-nowrap text-[11px]">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rawRows.map((row, i) => (
            <tr key={i} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
              {allKeys.map((k) => (
                <td key={k} className="px-3 py-2 font-mono text-[11px] text-foreground/80 max-w-xs break-all">
                  {row[k] == null ? (
                    <span className="text-muted-foreground/40">—</span>
                  ) : (
                    String(row[k])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stringifyLinePayload(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";

  const unwrapped = unwrapN8nJson(value);

  if (typeof unwrapped === "string") {
    const trimmed = unwrapped.trim();
    if (
      depth < 3 &&
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      /"(raw_output|rawOutput|output|stdout|stderr|rows|data|lines|message|message_text|line)"/i.test(trimmed)
    ) {
      try {
        const fromJson = stringifyLinePayload(JSON.parse(trimmed), depth + 1);
        if (fromJson) return fromJson;
      } catch {
        // Keep the original string when it is not JSON from n8n.
      }
    }
    return unwrapped;
  }

  if (typeof unwrapped === "number" || typeof unwrapped === "boolean") return String(unwrapped);

  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map((item) => stringifyLinePayload(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }

  if (!isRecord(unwrapped)) return "";

  for (const key of [
    "raw_output",
    "rawOutput",
    "output",
    "stdout",
    "stderr",
    "text",
    "log",
    "logs",
    "line",
    "message",
    "message_text"
  ]) {
    const output = stringifyLinePayload(readField(unwrapped, [key]), depth + 1);
    if (output) return output;
  }

  for (const key of ["raw_data", "data", "rows", "items", "lines", "result", "body", "response"]) {
    const output = stringifyLinePayload(readField(unwrapped, [key]), depth + 1);
    if (output) return output;
  }

  return JSON.stringify(unwrapped, null, 2);
}

function extractLineOutput(response: unknown) {
  const responseRecord = isRecord(response) ? response : undefined;
  const rawData = responseRecord && isRecord(responseRecord.raw_data) ? responseRecord.raw_data : undefined;

  for (const candidate of [
    responseRecord && readField(responseRecord, ["output", "raw_output", "rawOutput", "stdout", "stderr", "data", "lines"]),
    rawData && readField(rawData, ["output", "raw_output", "rawOutput", "stdout", "stderr", "data", "rows", "lines"])
  ]) {
    const output = stringifyLinePayload(candidate);
    if (output) return output;
  }

  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// AiMarkdown — Markdown renderer tuned for the violet AI panel theme
// ─────────────────────────────────────────────────────────────────────────────

function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-markdown max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children }) {
            return (
              <h1 className="mb-3 mt-5 first:mt-0 text-base font-bold text-violet-200 border-b border-violet-500/25 pb-2">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="mb-2 mt-4 first:mt-0 text-sm font-semibold text-violet-300">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="mb-1.5 mt-3 first:mt-0 text-xs font-semibold text-violet-400/90 uppercase tracking-wide">
                {children}
              </h3>
            );
          },
          p({ children }) {
            return (
              <p className="mb-2 last:mb-0 text-foreground/85 leading-relaxed">
                {children}
              </p>
            );
          },
          ul({ children }) {
            return (
              <ul className="mb-3 ml-4 space-y-1 list-none">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="mb-3 ml-4 space-y-1 list-decimal text-foreground/85">
                {children}
              </ol>
            );
          },
          li({ children }) {
            return (
              <li className="flex items-start gap-2 text-foreground/80 text-sm leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/60" />
                <span>{children}</span>
              </li>
            );
          },
          strong({ children }) {
            const text = String(children);
            if (/🔴|critical|error|failed/i.test(text))
              return <strong className="font-semibold text-red-400">{children}</strong>;
            if (/🟠|warning|warn/i.test(text))
              return <strong className="font-semibold text-amber-400">{children}</strong>;
            if (/🟢|success|healthy|ok\b|resolved/i.test(text))
              return <strong className="font-semibold text-emerald-400">{children}</strong>;
            if (/🔵|info|note/i.test(text))
              return <strong className="font-semibold text-blue-400">{children}</strong>;
            return <strong className="font-semibold text-violet-200">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic text-violet-300/90">{children}</em>;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeStr = String(children).replace(/\n$/, "");
            if (match) {
              return (
                <pre className="keep-dark my-2 overflow-x-auto rounded-lg border border-violet-500/20 bg-slate-900/60 p-3">
                  <code className="text-[11px] font-mono text-violet-100 leading-relaxed">
                    {codeStr}
                  </code>
                </pre>
              );
            }
            return (
              <code
                className="rounded px-1.5 py-0.5 text-[11px] font-mono bg-violet-500/10 text-violet-200 border border-violet-500/20"
                {...props}
              >
                {children}
              </code>
            );
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto rounded-lg border border-violet-500/25">
                <table className="min-w-full divide-y divide-violet-500/20 text-xs">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-violet-500/15">{children}</thead>;
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-violet-500/10 bg-secondary/20">
                {children}
              </tbody>
            );
          },
          tr({ children }) {
            return (
              <tr className="transition-colors hover:bg-violet-500/10">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 text-foreground/80 text-[11px] font-mono">
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-2 border-l-2 border-violet-400/50 bg-violet-500/8 pl-3 py-1.5 text-violet-300/80 text-xs italic rounded-r-md">
                {children}
              </blockquote>
            );
          },
          hr() {
            return <hr className="my-4 border-violet-500/20" />;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                className="text-violet-400 underline underline-offset-2 hover:text-violet-300">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AiAnalysisPanel — shared component for rendering GenAI RCA output
// ─────────────────────────────────────────────────────────────────────────────

interface AiAnalysisPanelProps {
  loading: boolean;
  error: string | null;
  analysis: string | null;
}

function AiAnalysisPanel({ loading, error, analysis }: AiAnalysisPanelProps) {
  if (!loading && !error && !analysis) return null;

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-violet-500/20 bg-violet-500/10 px-4 py-2.5">
        <BrainCircuit className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-semibold text-violet-300">AI Root Cause Analysis</span>
        {loading && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-violet-400/70">
            <Loader2 className="h-3 w-3 animate-spin" />
            Analyzing with AI…
          </span>
        )}
        {analysis && !loading && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-violet-400/60">
            <Sparkles className="h-3 w-3" />
            Review recommendations carefully before acting
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        {loading && !analysis && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-violet-400" />
            <span className="text-sm">Processing alert log through AI — this may take a few seconds…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {analysis && <AiMarkdown content={analysis} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Alert Notification System
// ─────────────────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: DbaAlertLogRow;
  onAck: (id: number) => void;
  onResolve: (id: number) => void;
  actingId: number | null;
}

function AlertCard({ alert, onAck, onResolve, actingId }: AlertCardProps) {
  const [expanded, setExpanded] = useState(false);
  const busy = actingId === alert.alert_id;

  return (
    <div
      className={cn(
        "glass-panel rounded-xl border-l-4 p-4 transition-all duration-200 hover:shadow-lg",
        severityColor(alert.severity)
      )}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {severityBadge(alert.severity)}
          {statusBadge(alert.status)}
          {alert.error_code && (
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-red-300 border border-red-500/30">
              {alert.error_code}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Database className="h-3 w-3" />
            {alert.database_name}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {fmtTs(alert.originating_timestamp)}
          </span>
        </div>
      </div>

      {/* Message */}
      <div className="mt-3">
        <p
          className={cn(
            "font-mono text-xs text-foreground/80 leading-relaxed",
            !expanded && "line-clamp-2"
          )}
        >
          {alert.message_text || "(no message)"}
        </p>
        {alert.message_text && alert.message_text.length > 120 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>

      {/* Lifecycle meta */}
      {(alert.acknowledged_by || alert.resolved_by) && (
        <div className="mt-2 space-y-0.5">
          {alert.acknowledged_by && (
            <p className="text-[11px] text-orange-300/80">
              Acknowledged by {alert.acknowledged_by}
              {alert.acknowledged_at ? ` at ${fmtTs(alert.acknowledged_at)}` : ""}
            </p>
          )}
          {alert.resolved_by && (
            <p className="text-[11px] text-emerald-400/80">
              Resolved by {alert.resolved_by}
              {alert.resolved_at ? ` at ${fmtTs(alert.resolved_at)}` : ""}
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        {alert.status === "OPEN" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAck(alert.alert_id)}
            className="h-7 px-3 text-xs border-orange-400/30 text-orange-300 hover:bg-orange-400/10 hover:border-orange-400/60"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Bell className="mr-1 h-3 w-3" />}
            Acknowledge
          </Button>
        )}
        {alert.status === "ACKNOWLEDGED" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve(alert.alert_id)}
            className="h-7 px-3 text-xs border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10 hover:border-emerald-400/60"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
            Resolve
          </Button>
        )}
        {alert.status === "RESOLVED" && (
          <span className="flex items-center gap-1 text-xs text-emerald-400/70">
            <CheckCircle2 className="h-3 w-3" />
            Resolved
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_TABS: { label: string; value: DbaAlertLogStatus | "ALL" }[] = [
  { label: "OPEN", value: "OPEN" },
  { label: "ACKNOWLEDGED", value: "ACKNOWLEDGED" },
  { label: "RESOLVED", value: "RESOLVED" },
  { label: "ALL", value: "ALL" }
];

function Section1() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [statusFilter, setStatusFilter] = useState<DbaAlertLogStatus | "ALL">("OPEN");
  const [alerts, setAlerts] = useState<DbaAlertLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDbaAlertLog({
        database_name: selectedDb || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        limit: 50
      });
      setAlerts(result.items);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts.");
    } finally {
      setLoading(false);
    }
  }, [selectedDb, statusFilter]);

  // Initial load + polling every 60 s
  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  // ── Real-time: re-fetch immediately when an alert_log SSE notification arrives
  const notifications = useAppStore((s) => s.notifications);
  const alertLogNotifCount = notifications.filter((n) => n.type === "alert_log").length;
  const prevAlertLogCountRef = useRef(alertLogNotifCount);

  useEffect(() => {
    // Skip the initial render — only react to *new* notifications
    if (prevAlertLogCountRef.current === alertLogNotifCount) return;
    prevAlertLogCountRef.current = alertLogNotifCount;

    // Immediately reload the alert list
    load();

    // Reset the 60 s polling timer so it doesn't fire redundantly
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(load, 60_000);
  }, [alertLogNotifCount, load]);

  const handleAck = async (id: number) => {
    setActingId(id);
    try {
      const { alert } = await acknowledgeDbaAlert(id);
      setAlerts((prev) => prev.map((a) => (a.alert_id === id ? alert : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledge failed.");
    } finally {
      setActingId(null);
    }
  };

  const handleResolve = async (id: number) => {
    setActingId(id);
    try {
      const { alert } = await resolveDbaAlert(id);
      setAlerts((prev) => prev.map((a) => (a.alert_id === id ? alert : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed.");
    } finally {
      setActingId(null);
    }
  };

  const p1Count = alerts.filter((a) => a.severity === "P1").length;
  const p2Count = alerts.filter((a) => a.severity === "P2").length;

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">
          <XCircle className="h-4 w-4 text-red-400" />
          <span className="text-red-300 font-semibold">{p1Count}</span>
          <span className="text-muted-foreground">P1 Critical</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-yellow-400" />
          <span className="text-yellow-300 font-semibold">{p2Count}</span>
          <span className="text-muted-foreground">P2 High</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-sm">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="text-foreground font-semibold">{total}</span>
          <span className="text-muted-foreground">Total (this filter)</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Live · Auto-refresh 60s</span>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-7 px-2">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Alerts grid */}
      {loading && alerts.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BellOff className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No {statusFilter !== "ALL" ? statusFilter.toLowerCase() : ""} alerts found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.alert_id}
              alert={alert}
              onAck={handleAck}
              onResolve={handleResolve}
              actingId={actingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Check Alert by Time Range
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function Section2() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [rows, setRows] = useState<DiagAlertExtRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oraFilter, setOraFilter] = useState(false);
  const [queried, setQueried] = useState(false);
  const [page, setPage] = useState(1);

  const [rawResp, setRawResp] = useState<unknown>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  // Helper: convert datetime-local value → "YYYY-MM-DD HH:MM:SS" (no timezone suffix)
  function toOraFormat(val: string) {
    if (!val) return "";
    // datetime-local gives "YYYY-MM-DDTHH:MM" — replace T with space and append seconds
    return val.replace("T", " ") + ":00";
  }

  const handleExecute = async () => {
    if (!startTime || !endTime) {
      setError("Please select both start and end time.");
      return;
    }
    setLoading(true);
    setError(null);
    setRows([]);
    setRawResp(null);
    setQueried(false);
    setPage(1);
    setAiAnalysis(null);
    setAiError(null);
    try {
      const response = await triggerAlertByTime(selectedDb, toOraFormat(startTime), toOraFormat(endTime));
      setRawResp(response);
      const extracted = extractDiagAlertRows(response);
      setRows(extracted);
      setQueried(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleAiAnalyze = async () => {
    const textToAnalyze = rows
      .map((r) => `[${r.originating_timestamp}] ${r.message_text || ""}`)
      .join("\n");

    if (!textToAnalyze.trim()) return;

    setAiLoading(true);
    setAiError(null);
    setAiAnalysis(null);
    try {
      const response = await analyzeAlertLog(selectedDb, textToAnalyze);
      const insight =
        response.ai_summary ||
        response.raw_output ||
        "No analysis returned from AI.";
      setAiAnalysis(insight);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed.");
    } finally {
      setAiLoading(false);
    }
  };

  const displayRows = oraFilter
    ? rows.filter((r) => containsOra(r.message_text))
    : rows;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = displayRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Start Time</label>
          <Input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="h-9 text-sm bg-secondary/40 border-border/60 w-52"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">End Time</label>
          <Input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-9 text-sm bg-secondary/40 border-border/60 w-52"
          />
        </div>
        <Button
          onClick={handleExecute}
          disabled={loading || !startTime || !endTime}
          className="h-9 px-5 bg-primary hover:bg-primary/90"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Query
        </Button>
      </div>

      {/* ORA filter toggle + Analyze with AI */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setOraFilter((v) => !v); setPage(1); }}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
              oraFilter
                ? "border-red-500/50 bg-red-500/15 text-red-300"
                : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
            )}
          >
            <Filter className="h-3 w-3" />
            {oraFilter ? "Showing ORA-ERRORs only" : "Filter ORA-ERRORs only"}
          </button>
          <span className="text-xs text-muted-foreground">
            {displayRows.length} / {rows.length} rows
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={aiLoading}
            onClick={handleAiAnalyze}
            className="ml-auto h-8 gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-500/70 hover:text-violet-200 text-xs"
          >
            {aiLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <BrainCircuit className="h-3.5 w-3.5" />
            }
            Analyze with AI
          </Button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* rawResp kept in state for fallback row extraction — not shown to user */}

      {/* Results table */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Querying n8n…
        </div>
      )}

      {/* When smart extraction yields 0 rows — try FallbackRawTable first, then empty state */}
      {!loading && queried && displayRows.length === 0 && (() => {
        // Scan raw_data for ANY array-valued field (rows, data, items, or custom names)
        let fallbackRows: Record<string, unknown>[] = [];

        if (isRecord(rawResp)) {
          const rd = (rawResp as Record<string, unknown>).raw_data;

          if (Array.isArray(rd)) {
            fallbackRows = rd.filter(isRecord) as Record<string, unknown>[];
          } else if (isRecord(rd)) {
            // Try named keys first
            for (const key of ["rows", "data", "items", "alerts"]) {
              const candidate = (rd as Record<string, unknown>)[key];
              if (Array.isArray(candidate) && candidate.length > 0) {
                fallbackRows = candidate.filter(isRecord) as Record<string, unknown>[];
                break;
              }
            }
            // If still empty, scan every value in raw_data for an array
            if (fallbackRows.length === 0) {
              for (const val of Object.values(rd as Record<string, unknown>)) {
                if (Array.isArray(val) && val.length > 0 && isRecord(val[0])) {
                  fallbackRows = val as Record<string, unknown>[];
                  break;
                }
              }
            }
          }

          // Last resort: try parsing raw_output as JSON
          if (fallbackRows.length === 0) {
            const ro = (rawResp as Record<string, unknown>).raw_output;
            if (typeof ro === "string" && ro.trim().startsWith("[")) {
              try {
                const parsed = JSON.parse(ro.trim());
                if (Array.isArray(parsed)) fallbackRows = parsed.filter(isRecord) as Record<string, unknown>[];
              } catch { /* ignore */ }
            }
          }
        }

        return fallbackRows.length > 0 ? (
          <FallbackRawTable rawRows={fallbackRows} />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Activity className="mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm">No alert entries found in this time window.</p>
          </div>
        );
      })()}

      {!loading && displayRows.length > 0 && (
        <div className="space-y-3">
          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/50">
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium whitespace-nowrap w-44">Timestamp</th>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, i) => (
                  <tr
                    key={i}
                    className={cn(
                      "border-b border-border/40 transition-colors hover:bg-secondary/30",
                      containsOra(row.message_text) && "bg-red-500/5"
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap align-top">
                      {fmtTs(row.originating_timestamp)}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] break-all">
                      {highlightOra(row.message_text || "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 px-1">
              {/* Left: row range info */}
              <span className="text-[11px] text-muted-foreground">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, displayRows.length)} of {displayRows.length} rows
              </span>

              {/* Center: page pills */}
              <div className="flex items-center gap-1">
                {/* Prev */}
                <button
                  disabled={safePage === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-secondary/30 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  ‹
                </button>

                {/* Page number pills — show at most 7 pages with ellipsis */}
                {(() => {
                  const pages: (number | "…")[] = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (safePage > 3) pages.push("…");
                    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pages.push(i);
                    if (safePage < totalPages - 2) pages.push("…");
                    pages.push(totalPages);
                  }
                  return pages.map((p, idx) =>
                    p === "…" ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground/50">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={cn(
                          "flex h-7 min-w-[28px] items-center justify-center rounded-md border px-2 text-[11px] font-medium transition-colors",
                          safePage === p
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                        )}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}

                {/* Next */}
                <button
                  disabled={safePage === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-secondary/30 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  ›
                </button>
              </div>

              {/* Right: rows per page label */}
              <span className="text-[11px] text-muted-foreground">{PAGE_SIZE} rows / page</span>
            </div>
          )}
        </div>
      )}

      {/* AI Analysis Panel */}
      <AiAnalysisPanel loading={aiLoading} error={aiError} analysis={aiAnalysis} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Check Alert by Last N Lines
// ─────────────────────────────────────────────────────────────────────────────

function Section3() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [lineCount, setLineCount] = useState(100);
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oraFilter, setOraFilter] = useState(false);
  const [queried, setQueried] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!lineCount || lineCount < 1) {
      setError("Line count must be at least 1.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutput(null);
    setQueried(false);
    setAiAnalysis(null);
    setAiError(null);
    try {
      const response = await triggerAlertByLines(selectedDb, lineCount);
      // Try extractLineOutput first (handles stdout, raw_output, etc.)
      const extracted = extractLineOutput(response);
      setOutput(extracted || String(
        (response as unknown as Record<string, unknown>).output ||
        response.raw_output ||
        response.raw_data?.rows?.map((r) => JSON.stringify(r)).join("\n") ||
        ""
      ));
      setQueried(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleAiAnalyze = async () => {
    if (!output?.trim()) return;

    setAiLoading(true);
    setAiError(null);
    setAiAnalysis(null);
    try {
      const response = await analyzeAlertLog(selectedDb, output);
      const insight =
        response.ai_summary ||
        response.raw_output ||
        "No analysis returned from AI.";
      setAiAnalysis(insight);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed.");
    } finally {
      setAiLoading(false);
    }
  };

  // Apply ORA filter: split lines and filter those containing ORA-xxxxx
  const lines = output?.split("\n") ?? [];
  const displayLines = oraFilter ? lines.filter((l) => /ORA-\d{4,5}/i.test(l)) : lines;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Last N Lines</label>
          <Input
            type="number"
            min={1}
            max={10000}
            value={lineCount}
            onChange={(e) => setLineCount(Number(e.target.value))}
            className="h-9 text-sm bg-secondary/40 border-border/60 w-36"
            placeholder="100"
          />
        </div>
        <Button
          onClick={handleExecute}
          disabled={loading || lineCount < 1}
          className="h-9 px-5 bg-primary hover:bg-primary/90"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Terminal className="mr-2 h-4 w-4" />}
          Fetch Lines
        </Button>
      </div>

      {/* ORA filter toggle + Analyze with AI */}
      {output !== null && lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setOraFilter((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
              oraFilter
                ? "border-red-500/50 bg-red-500/15 text-red-300"
                : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
            )}
          >
            <Filter className="h-3 w-3" />
            {oraFilter ? "Showing ORA-ERRORs only" : "Filter ORA-ERRORs only"}
          </button>
          <span className="text-xs text-muted-foreground">
            {displayLines.length} / {lines.length} lines
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={aiLoading}
            onClick={handleAiAnalyze}
            className="ml-auto h-8 gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-500/70 hover:text-violet-200 text-xs"
          >
            {aiLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <BrainCircuit className="h-3.5 w-3.5" />
            }
            Analyze with AI
          </Button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Fetching log lines from n8n…
        </div>
      )}

      {/* Empty */}
      {!loading && queried && displayLines.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Terminal className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No output returned.</p>
        </div>
      )}

      {/* Terminal output */}
      {!loading && displayLines.length > 0 && (
        <div className="keep-dark relative rounded-xl border border-border/60 bg-[#0a0d13] overflow-hidden">
          {/* Terminal header */}
          <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/30 px-4 py-2">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="ml-2 text-[11px] text-muted-foreground font-mono">
              alert_{selectedDb?.toLowerCase() || "orcl"}.log — last {lineCount} lines
            </span>
          </div>
          <div className="max-h-[480px] overflow-y-auto p-4">
            <pre className="text-[11px] leading-5 font-mono text-foreground/85 whitespace-pre-wrap break-all">
              {displayLines.map((line, i) => (
                <span
                  key={i}
                  className={cn(
                    "block",
                    /ORA-\d{4,5}/i.test(line) && "text-red-400 font-semibold bg-red-500/10 -mx-4 px-4"
                  )}
                >
                  <span className="select-none mr-3 text-muted-foreground/40 text-[10px]">
                    {String(i + 1).padStart(4, " ")}
                  </span>
                  {line}
                </span>
              ))}
            </pre>
          </div>
        </div>
      )}

      {/* AI Analysis Panel */}
      <AiAnalysisPanel loading={aiLoading} error={aiError} analysis={aiAnalysis} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper component
// ─────────────────────────────────────────────────────────────────────────────

interface SectionPanelProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

function SectionPanel({ id, icon, title, subtitle, badge, children }: SectionPanelProps) {
  return (
    <section id={id} className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary border border-primary/20">
            {icon}
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {badge && <div>{badge}</div>}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────

export function AlertLogPage() {
  return (
    <div className="space-y-6">
      {/* Section 1 */}
      <SectionPanel
        id="alert-notifications"
        icon={<Bell className="h-5 w-5" />}
        title="Alert Notification System"
        subtitle="Oracle ORA- errors captured by n8n every 15 minutes — stored in dba_alert_log"
      >
        <Section1 />
      </SectionPanel>

      {/* Section 2 */}
      <SectionPanel
        id="alert-by-time"
        icon={<Clock className="h-5 w-5" />}
        title="Check Alert by Time Range"
        subtitle="Query v$diag_alert_ext via n8n for a custom time window"
      >
        <Section2 />
      </SectionPanel>

      {/* Section 3 */}
      <SectionPanel
        id="alert-by-lines"
        icon={<Terminal className="h-5 w-5" />}
        title="Check Alert Log — Last N Lines"
        subtitle="Fetch latest alert log lines via PowerShell Get-Content through n8n"
      >
        <Section3 />
      </SectionPanel>
    </div>
  );
}
