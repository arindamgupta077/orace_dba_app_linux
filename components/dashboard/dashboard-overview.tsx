"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  FileDown,
  HardDrive,
  History,
  Layers,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  Unplug,
  Users,
  XCircle,
  Zap,
  TrendingUp,
  Loader2
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScheduleModal } from "@/components/dashboard/schedule-modal";
import type { DashboardSchedule } from "@/components/dashboard/schedule-modal";
import { FailedJobsModal } from "@/components/dashboard/failed-jobs-modal";
import { InvalidObjectsModal } from "@/components/dashboard/invalid-objects-modal";
import { HistoricalSnapshotsModal } from "@/components/dashboard/historical-snapshots-modal";
import { DashboardHistoricalTrends } from "@/components/dashboard/dashboard-historical-trends";
import { JobHistoryModal } from "@/components/datapump/job-history-modal";
import { toast } from "sonner";
import { saveSessionData } from "@/components/general-admin/storage-helpers";
import {
  getCachedDashboardMetrics,
  getCachedDashboardRefreshedAt,
  getCachedDashboardRefreshedBy,
  isDashboardRefreshing,
  triggerDashboardRefresh
} from "@/services/dashboard-refresh-service";
import { cn, formatAppDateTime } from "@/lib/utils";
import { fetchDataPumpJobsApi, fetchDashboardHistory } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type {
  DataPumpJob,
  DashboardArchiveLogMonthRow,
  DashboardHistoryRow,
  DashboardMetrics,
  DashboardTablespaceRow,
  NotificationPayload
} from "@/types/dba";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtUptime(hours: number): string {
  if (!hours) return "—";
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  const m = Math.round((hours % 1) * 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 && d === 0) parts.push(`${m}m`);
  return parts.join(" ") || "< 1m";
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtMb(mb: unknown): string {
  const n = safeNum(mb);
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  return `${Math.round(n)} MB`;
}

function pctColor(pct: unknown): string {
  const n = safeNum(pct);
  if (n >= 90) return "text-red-400";
  if (n >= 75) return "text-amber-400";
  return "text-emerald-400";
}

function pctBarColor(pct: unknown): string {
  const n = safeNum(pct);
  if (n >= 90) return "bg-red-500";
  if (n >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

function pctStroke(pct: unknown): string {
  const n = safeNum(pct);
  if (n >= 90) return "#ef4444";
  if (n >= 75) return "#f59e0b";
  return "#10b981";
}

// Reads a field from a record trying lowercase then UPPERCASE.
// Oracle DB node returns all column names in uppercase by default.
function field<T = unknown>(row: Record<string, unknown>, key: string): T {
  return (row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]) as T;
}

function safeStr(v: unknown, fallback = ""): string {
  return v != null ? String(v) : fallback;
}

function rawArray(row: Record<string, unknown>, key: string): unknown[] {
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  return Array.isArray(value) ? value : [];
}

function fmtDateOnly(value: unknown): string {
  const raw = safeStr(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Distinct badge color styling for dashboard database info pills
function getEnvBadgeColor(env?: string): string {
  switch (env?.toUpperCase()) {
    case "PROD":
      return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300";
    case "UAT":
      return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "DEV":
      return "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "DR":
      return "border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300";
    default:
      return "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300";
  }
}

function getOsBadgeColor(os?: string): string {
  switch (os?.toLowerCase()) {
    case "windows":
      return "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "linux":
      return "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300";
    default:
      return "border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
  }
}

function getDbTypeBadgeColor(dbType?: string): string {
  switch (dbType) {
    case "RAC & Datagaurd":
    case "RAC & Dataguard":
      return "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300";
    case "RAC":
      return "border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
    case "Dataguard":
      return "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300";
    case "Active Dataguard":
      return "border-pink-500/40 bg-pink-500/15 text-pink-700 dark:text-pink-300";
    case "Standalone":
    default:
      return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
  }
}

function getDbVersionBadgeColor(): string {
  return "border-purple-500/40 bg-purple-500/15 text-purple-800 dark:text-purple-300";
}

function getDivisionBadgeColor(division?: string): string {
  switch (division?.toUpperCase()) {
    case "PCPB":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "ITD":
      return "border-cyan-500/40 bg-cyan-500/15 text-cyan-800 dark:text-cyan-300";
    case "FBD":
      return "border-violet-500/40 bg-violet-500/15 text-violet-800 dark:text-violet-300";
    case "HOTEL":
      return "border-pink-500/40 bg-pink-500/15 text-pink-800 dark:text-pink-300";
    case "ILTD":
      return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "CORP":
      return "border-blue-500/40 bg-blue-500/15 text-blue-800 dark:text-blue-300";
    case "ITSS":
      return "border-rose-500/40 bg-rose-500/15 text-rose-800 dark:text-rose-300";
    default:
      return "border-teal-500/40 bg-teal-500/15 text-teal-800 dark:text-teal-300";
  }
}

// Normalise a raw metrics object from any source (n8n response or Oracle CLOB).
// Handles both lowercase keys (app convention) and UPPERCASE keys (Oracle default).
function normalizeMetrics(raw: unknown): DashboardMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // db_health is the required sentinel — if it's missing this isn't a dashboard snapshot
  const dbh = (r.db_health ?? r.DB_HEALTH) as Record<string, unknown> | undefined;
  if (!dbh) return null;

  const osRes = (r.os_resources ?? r.OS_RESOURCES ?? {}) as Record<string, unknown>;
  const sgaPga = (r.sga_pga ?? r.SGA_PGA ?? {}) as Record<string, unknown>;

  // Tablespaces — Oracle returns UPPERCASE column names
  const tablespaces = (Array.isArray(r.tablespaces) ? r.tablespaces : []).map((t: unknown) => {
    const row = (t ?? {}) as Record<string, unknown>;
    return {
      tablespace_name: safeStr(field(row, "tablespace_name")),
      total_mb:        safeNum(field(row, "total_mb")),
      used_mb:         safeNum(field(row, "used_mb")),
      free_mb:         safeNum(field(row, "free_mb")),
      pct_used:        safeNum(field(row, "pct_used")),
    };
  });

  // RMAN backups — Oracle returns UPPERCASE column names
  const rmanBackups = (Array.isArray(r.rman_backups) ? r.rman_backups : []).map((b: unknown) => {
    const row = (b ?? {}) as Record<string, unknown>;
    return {
      start_time:   safeStr(field(row, "start_time")),
      end_time:     safeStr(field(row, "end_time")),
      input_type:   safeStr(field(row, "input_type")),
      status:       safeStr(field(row, "status")),
      duration_min: safeNum(field(row, "duration_min")),
    };
  });

  // Blocking sessions
  const blockingSessions = (Array.isArray(r.blocking_sessions) ? r.blocking_sessions : []).map(
    (b: unknown) => {
      const row = (b ?? {}) as Record<string, unknown>;
      return {
        waiter_sid:     safeNum(field(row, "waiter_sid")),
        waiter_serial:  safeNum(field(row, "waiter_serial")),
        waiter_user:    safeStr(field(row, "waiter_user")),
        waiter_sql_id:  safeStr(field(row, "waiter_sql_id")),
        blocker_sid:    safeNum(field(row, "blocker_sid")),
        blocker_serial: safeNum(field(row, "blocker_serial")),
        blocker_user:   safeStr(field(row, "blocker_user")),
        blocker_sql_id: safeStr(field(row, "blocker_sql_id")),
        waiting_min:    safeNum(field(row, "waiting_min")),
        event:          safeStr(field(row, "event")),
      };
    }
  );

  // ORA errors — Oracle returns UPPERCASE column names
  const oraErrors = (Array.isArray(r.ora_errors) ? r.ora_errors : []).map((e: unknown) => {
    const row = (e ?? {}) as Record<string, unknown>;
    return {
      originating_timestamp: safeStr(field(row, "originating_timestamp")),
      message_text:          safeStr(field(row, "message_text")),
    };
  });

  const archiveLogGeneration = rawArray(r, "archive_log_generation").map((a: unknown) => {
    const row = (a ?? {}) as Record<string, unknown>;
    return {
      month:             safeStr(field(row, "month")),
      archive_log_count: safeNum(field(row, "archive_log_count")),
      archive_gb:        safeNum(field(row, "archive_gb")),
    };
  });

  const datapumpExports = rawArray(r, "datapump_exports").map((d: unknown) => {
    const row = (d ?? {}) as Record<string, unknown>;
    return {
      owner_name: safeStr(field(row, "owner_name")),
      job_name:   safeStr(field(row, "job_name")),
      operation:  safeStr(field(row, "operation")),
      job_mode:   safeStr(field(row, "job_mode")),
      state:      safeStr(field(row, "state")),
    };
  });

  const passwordExpiringUsers = rawArray(r, "password_expiring_users").map((u: unknown) => {
    const row = (u ?? {}) as Record<string, unknown>;
    return {
      username:       safeStr(field(row, "username")),
      account_status: safeStr(field(row, "account_status")),
      expiry_date:    safeStr(field(row, "expiry_date")),
    };
  });

  // FRA — may come back as an empty object {} if the query returned no rows
  const fraRaw = (r.fra ?? r.FRA ?? {}) as Record<string, unknown>;
  const fraSize = safeNum(field(fraRaw, "fra_size_gb"));
  const fra = fraSize > 0
    ? {
        name:            safeStr(field(fraRaw, "name")),
        fra_size_gb:     fraSize,
        used_gb:         safeNum(field(fraRaw, "used_gb")),
        reclaimable_gb:  safeNum(field(fraRaw, "reclaimable_gb")),
        pct_used:        safeNum(field(fraRaw, "pct_used")),
      }
    : null;

  return {
    db_health: {
      db_name:          safeStr(field(dbh, "db_name")),
      open_mode:        safeStr(field(dbh, "open_mode")),
      listener_status:  safeStr(field(dbh, "listener_status"), "UNKNOWN"),
      connection_test:  (safeStr(field(dbh, "connection_test"), "UNKNOWN")) as "SUCCESS" | "FAILED" | "UNKNOWN",
      instance_name:    safeStr(field(dbh, "instance_name")),
      host_name:        safeStr(field(dbh, "host_name")),
      startup_time:     field(dbh, "startup_time") != null ? safeStr(field(dbh, "startup_time")) : null,
      uptime_hours:     safeNum(field(dbh, "uptime_hours")),
      db_version:       field(dbh, "db_version") != null ? safeStr(field(dbh, "db_version")) : field(dbh, "version") != null ? safeStr(field(dbh, "version")) : undefined,
    },
    os_resources: (() => {
      const rawTotal = safeNum(field(osRes, "total_memory_gb"));
      const rawFree  = safeNum(field(osRes, "free_memory_gb"));

      // Guard: if total_memory_gb is in the 1–100 range AND free_memory_gb is 0,
      // the n8n code node mistakenly placed the raw stdout percentage in that field
      // instead of an actual GB measurement. Reclaim it as memory_used_pct.
      const totalIsPct = rawTotal > 0 && rawTotal <= 100 && rawFree === 0;
      const totalGb = totalIsPct ? 0 : rawTotal;

      // Resolve memory_used_pct in priority order:
      //   1. explicit memory_used_pct field
      //   2. total_memory_gb when it was detected as a percentage (above)
      //   3. stdout / output inside os_resources (n8n passes b3.stdout through)
      //   4. stdout / output at the top-level raw object (older snapshots)
      let memPct: number | undefined;
      const directPct = safeNum(field(osRes, "memory_used_pct"));
      if (directPct > 0) {
        memPct = directPct;
      } else if (totalIsPct) {
        memPct = rawTotal;
      } else if (totalGb === 0) {
        const fromOs  = safeNum(field(osRes, "stdout") ?? field(osRes, "output"));
        const fromTop = safeNum((r.stdout as unknown) ?? (r.output as unknown) ?? (r.os_resources_stdout as unknown));
        const v = fromOs > 0 ? fromOs : fromTop > 0 ? fromTop : 0;
        if (v > 0) memPct = v;
      }

      return {
        cpu_usage_pct:   safeNum(field(osRes, "cpu_usage_pct")),
        total_memory_gb: totalGb,
        free_memory_gb:  rawFree,
        memory_used_pct: memPct,
      };
    })(),
    sga_pga: {
      sga_target:           safeStr(field(sgaPga, "sga_target"),           "N/A"),
      sga_max_size:         safeStr(field(sgaPga, "sga_max_size"),         "N/A"),
      pga_aggregate_target: safeStr(field(sgaPga, "pga_aggregate_target"), "N/A"),
      pga_aggregate_limit:  safeStr(field(sgaPga, "pga_aggregate_limit")),
    },
    tablespaces,
    rman_backups: rmanBackups,
    active_sessions:   safeNum(r.active_sessions   ?? r.ACTIVE_SESSIONS),
    inactive_sessions: safeNum(r.inactive_sessions ?? r.INACTIVE_SESSIONS),
    blocking_sessions: blockingSessions,
    failed_jobs:       safeNum(r.failed_jobs   ?? r.FAILED_JOBS),
    invalid_objects:   safeNum(r.invalid_objects ?? r.INVALID_OBJECTS),
    users_expiring_in_15_days: safeNum(r.users_expiring_in_15_days ?? r.USERS_EXPIRING_IN_15_DAYS ?? passwordExpiringUsers.length),
    archive_log_generation:    archiveLogGeneration,
    tablespaces_over_90:       safeNum(r.tablespaces_over_90 ?? r.TABLESPACES_OVER_90),
    datapump_exports:          datapumpExports,
    password_expiring_users:   passwordExpiringUsers,
    failed_login_count:        safeNum(r.failed_login_count ?? r.FAILED_LOGIN_COUNT),
    db_response_time_ms:       field(r, "db_response_time_ms") != null ? safeNum(field(r, "db_response_time_ms")) : undefined,
    total_db_size_gb:          field(r, "total_db_size_gb") != null ? safeNum(field(r, "total_db_size_gb")) : undefined,
    avg_active_sessions_1hr:   field(r, "avg_active_sessions_1hr") != null ? safeNum(field(r, "avg_active_sessions_1hr")) : undefined,
    peak_active_sessions_1hr:  field(r, "peak_active_sessions_1hr") != null ? safeNum(field(r, "peak_active_sessions_1hr")) : undefined,
    fra:               fra ?? { name: "", fra_size_gb: 0, used_gb: 0, reclaimable_gb: 0, pct_used: 0 },
    ora_errors:        oraErrors,
    captured_at:       r.captured_at ? safeStr(r.captured_at) : undefined,
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-red-400/30 bg-red-500/10 text-red-300"}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  variant = "neutral",
  onClick
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  variant?: "neutral" | "healthy" | "warning" | "critical";
  onClick?: () => void;
}) {
  const variantMap = {
    neutral:  { bg: "bg-slate-400/5  border-slate-400/15",  text: "text-slate-200",    icon: "text-slate-400"   },
    healthy:  { bg: "bg-emerald-400/5 border-emerald-400/20", text: "text-emerald-300",  icon: "text-emerald-400" },
    warning:  { bg: "bg-amber-400/5  border-amber-400/20",  text: "text-amber-300",    icon: "text-amber-400"   },
    critical: { bg: "bg-red-500/5    border-red-400/20",    text: "text-red-300",      icon: "text-red-400"     }
  };
  const s = variantMap[variant];
  const content = (
    <>
      <div className={`rounded-lg border border-current/20 bg-current/10 p-1.5 ${s.icon}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold tabular-nums leading-tight ${s.text}`}>{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 print:hidden" />}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-current/30 hover:bg-current/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:ring-offset-2 focus:ring-offset-background ${s.bg}`}
        aria-label={`Go to ${label}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl border p-4 ${s.bg}`}>
      {content}
    </div>
  );
}

function LinearGauge({ label, value, max, unit = "%", color }: { label: string; value: number; max?: number; unit?: string; color: string }) {
  const safeVal = safeNum(value);
  const safeMax = safeNum(max);
  const pct = safeMax > 0 ? Math.min(100, (safeVal / safeMax) * 100) : Math.min(100, safeVal);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={`font-bold tabular-nums ${pctColor(pct)}`}>
          {safeMax > 0 ? `${safeVal.toFixed(1)}${unit} / ${safeMax}${unit}` : `${safeVal.toFixed(1)}${unit}`}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BackupStatusBadge({ status }: { status?: string | null }) {
  const s = String(status ?? "UNKNOWN").toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS")
    return <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">COMPLETED</span>;
  if (s === "RUNNING")
    return <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-xs font-semibold text-cyan-300">RUNNING</span>;
  return <span className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-300">{s}</span>;
}

function CustomBarTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; name: string }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-popover-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">{fmtMb(payload[0].value)}</p>
    </div>
  );
}

function TablespaceBarChart({ rows }: { rows: DashboardTablespaceRow[] }) {
  const data = rows.map((r) => ({
    name: r.tablespace_name,
    used: safeNum(r.used_mb),
    free: safeNum(r.free_mb),
    pct:  safeNum(r.pct_used)
  }));

  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(142,163,184,0.12)" />
          <XAxis type="number" tickFormatter={(v: number) => fmtMb(v)} stroke="#8ea3b8" fontSize={10} />
          <YAxis type="category" dataKey="name" stroke="#8ea3b8" fontSize={11} width={80} />
          <Tooltip content={<CustomBarTooltip />} cursor={{ fill: "rgba(142,163,184,0.06)" }} />
          <Bar dataKey="used" name="Used" stackId="a" radius={[0, 0, 0, 0]} maxBarSize={18}>
            {data.map((entry, i) => (
              <Cell key={entry.name ?? i} fill={pctStroke(entry.pct)} />
            ))}
          </Bar>
          <Bar dataKey="free" name="Free" stackId="a" fill="rgba(142,163,184,0.15)" radius={[0, 3, 3, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ArchiveLogTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload?: DashboardArchiveLogMonthRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-popover-foreground">{label}</p>
      <p className="text-cyan-300">{safeNum(payload[0].value).toFixed(2)} GB</p>
      <p className="text-muted-foreground">{safeNum(row?.archive_log_count)} logs</p>
    </div>
  );
}

function ArchiveLogChart({ rows }: { rows: DashboardArchiveLogMonthRow[] }) {
  const data = rows.map((r) => ({
    month: r.month,
    archive_gb: safeNum(r.archive_gb),
    archive_log_count: safeNum(r.archive_log_count)
  }));

  return (
    <div className="h-[190px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(142,163,184,0.12)" />
          <XAxis dataKey="month" stroke="#8ea3b8" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis stroke="#8ea3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}G`} />
          <Tooltip content={<ArchiveLogTooltip />} cursor={{ fill: "rgba(142,163,184,0.06)" }} />
          <Bar dataKey="archive_gb" name="Archive GB" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FraDonut({ pct, usedGb, sizeGb }: { pct: number; usedGb: number; sizeGb: number }) {
  const safePct  = safeNum(pct);
  const safeUsed = safeNum(usedGb);
  const safeSize = safeNum(sizeGb);
  const data = [
    { name: "Used", value: safePct },
    { name: "Free", value: Math.max(0, 100 - safePct) }
  ];
  const color = pctStroke(safePct);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-36 w-36">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={62}
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              dataKey="value"
            >
              <Cell fill={color} />
              <Cell fill="rgba(142,163,184,0.12)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold tabular-nums ${pctColor(safePct)}`}>{safePct.toFixed(1)}%</span>
          <span className="text-[10px] text-muted-foreground">used</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-center text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="font-semibold text-slate-200">{safeSize.toFixed(1)} GB</span>
        <span className="text-muted-foreground">Used</span>
        <span className={`font-semibold ${pctColor(safePct)}`}>{safeUsed.toFixed(1)} GB</span>
        <span className="text-muted-foreground">Free</span>
        <span className="font-semibold text-emerald-300">{(safeSize - safeUsed).toFixed(1)} GB</span>
      </div>
    </div>
  );
}

function EmptyState({
  onRefresh,
  loading,
  justRefreshed
}: {
  onRefresh: () => void;
  loading: boolean;
  justRefreshed?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-secondary/20 py-20 text-center">
      <div className="mb-4 rounded-full border border-cyan-400/30 bg-cyan-400/10 p-4">
        <Database className="h-10 w-10 text-cyan-300" />
      </div>
      <h3 className="text-lg font-semibold text-slate-200">No Dashboard Snapshot</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        No data found for this database. Click Refresh to execute the monitoring queries via n8n and capture the first snapshot.
      </p>
      <Button
        className={cn(
          "mt-6 gap-2 transition-all duration-200",
          justRefreshed ? "bg-emerald-600 hover:bg-emerald-500 text-white" : ""
        )}
        onClick={onRefresh}
        disabled={loading}
      >
        {loading ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            Refreshing…
          </>
        ) : justRefreshed ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-white animate-in zoom-in-50 duration-200" />
            Refreshed!
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" />
            Refresh Now
          </>
        )}
      </Button>
    </div>
  );
}

function NoDatabasesState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-secondary/20 py-20 text-center">
      <div className="mb-4 rounded-full border border-amber-400/30 bg-amber-400/10 p-4">
        <Database className="h-10 w-10 text-amber-300" />
      </div>
      <h3 className="text-lg font-semibold text-slate-200">No Databases Assigned</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        No databases have been assigned to your account yet. Please contact your administrator to have a database assigned to you.
      </p>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export function DashboardOverview() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const databases = useAppStore((s) => s.databases);
  const user = useAppStore((s) => s.user);

  // Client users with no assigned databases see a dedicated message — no data fetched.
  const isClientWithNoDatabases = user?.role === "client" && databases.length === 0;

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(() => {
    return selectedDb ? getCachedDashboardMetrics(selectedDb) : null;
  });
  const [refreshedAt, setRefreshedAt] = useState<string | null>(() => {
    return selectedDb ? getCachedDashboardRefreshedAt(selectedDb) : null;
  });
  const [refreshedBy, setRefreshedBy] = useState<string | null>(() => {
    return selectedDb ? getCachedDashboardRefreshedBy(selectedDb) : null;
  });
  const [loading, setLoading]               = useState(true);
  const [refreshing, setRefreshing]         = useState(() => {
    return isDashboardRefreshing(selectedDb);
  });
  const [justRefreshed, setJustRefreshed]   = useState(false);
  const justRefreshedTimerRef               = useRef<NodeJS.Timeout | null>(null);
  const [isReloading, setIsReloading]       = useState(false);
  const [reloadKey, setReloadKey]           = useState(0);
  const reloadTimerRef                      = useRef<NodeJS.Timeout | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [serverSchedule, setServerSchedule]       = useState<DashboardSchedule | null>(null);
  const [failedJobsModalOpen, setFailedJobsModalOpen]       = useState(false);
  const [invalidObjectsModalOpen, setInvalidObjectsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen]             = useState(false);
  const [activeSnapshot, setActiveSnapshot]                 = useState<DashboardHistoryRow | null>(null);
  const [datapumpJobHistory, setDatapumpJobHistory]         = useState<DataPumpJob[]>([]);
  const [datapumpLoading, setDatapumpLoading]               = useState(false);
  const [dpHistoryModalOpen, setDpHistoryModalOpen]         = useState(false);

  // Clean up acknowledgement and reload animation timers on unmount
  useEffect(() => {
    return () => {
      if (justRefreshedTimerRef.current) {
        clearTimeout(justRefreshedTimerRef.current);
      }
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
    };
  }, []);

  const dbTarget  = databases.find((db) => db.name === selectedDb);
  const prevDb    = useRef(selectedDb);

  // Fetch datapump_job_history table data for each selected database_name
  const loadDatapumpJobHistory = useCallback(async (db: string) => {
    if (!db) return;
    setDatapumpLoading(true);
    try {
      const res = await fetchDataPumpJobsApi(db, 10);
      const jobsMap = new Map<string, DataPumpJob>();
      (res.active || []).forEach((j) => jobsMap.set(j.id, j));
      (res.history || []).forEach((j) => jobsMap.set(j.id, j));
      const allJobs = Array.from(jobsMap.values()).sort((a, b) => {
        const tA = a.started_at ? new Date(a.started_at).getTime() : 0;
        const tB = b.started_at ? new Date(b.started_at).getTime() : 0;
        return tB - tA;
      });
      setDatapumpJobHistory(allJobs);
    } catch (e) {
      console.error("[dashboard-overview] Failed to fetch datapump_job_history:", e);
      setDatapumpJobHistory([]);
    } finally {
      setDatapumpLoading(false);
    }
  }, []);

  // Load cached snapshot from Oracle on mount / DB change.
  // The JSON stored in the CLOB is normalised before being placed in state so
  // both UPPERCASE (Oracle default) and lowercase keys are handled.
  const loadHistory = useCallback(async (db: string) => {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDashboardHistory(db);
      if (res.has_data && res.metrics) {
        const norm = normalizeMetrics(res.metrics) ?? res.metrics;
        setMetrics(norm);
        setRefreshedAt(res.refresh_timestamp);
        setRefreshedBy(res.refreshed_by);
        saveSessionData(`dashboard_metrics_${db}`, norm);
        saveSessionData(`dashboard_refreshed_at_${db}`, res.refresh_timestamp);
        saveSessionData(`dashboard_refreshed_by_${db}`, res.refreshed_by);
      } else {
        const cached = getCachedDashboardMetrics(db);
        if (cached) {
          setMetrics(cached);
          setRefreshedAt(getCachedDashboardRefreshedAt(db));
          setRefreshedBy(getCachedDashboardRefreshedBy(db));
        } else {
          setMetrics(null);
        }
      }
    } catch (e) {
      const cached = getCachedDashboardMetrics(db);
      if (cached) {
        setMetrics(cached);
        setRefreshedAt(getCachedDashboardRefreshedAt(db));
        setRefreshedBy(getCachedDashboardRefreshedBy(db));
      } else {
        setError(e instanceof Error ? e.message : "Failed to load dashboard.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectSnapshot = useCallback((snapshot: DashboardHistoryRow) => {
    setActiveSnapshot(snapshot);
    if (snapshot.metrics) {
      setMetrics(normalizeMetrics(snapshot.metrics) ?? snapshot.metrics);
      setRefreshedAt(snapshot.refresh_timestamp);
      setRefreshedBy(snapshot.refreshed_by);
    }
  }, []);

  const handleReturnToLatest = useCallback(() => {
    setActiveSnapshot(null);
    loadHistory(selectedDb);
  }, [loadHistory, selectedDb]);

  const loadServerSchedule = useCallback(async (db: string) => {
    try {
      const res = await fetch("/api/dashboard/schedules");
      if (!res.ok) return;
      const data = (await res.json()) as { schedules: DashboardSchedule[] };
      const found = data.schedules.find((s) => s.db_name === db) ?? null;
      setServerSchedule(found);
    } catch {
      // non-critical — just don't show the schedule badge
    }
  }, []);

  useEffect(() => {
    // Skip all data fetching if this client has no databases assigned.
    if (isClientWithNoDatabases) return;
    if (prevDb.current !== selectedDb) {
      prevDb.current = selectedDb;
      const cached = selectedDb ? getCachedDashboardMetrics(selectedDb) : null;
      setMetrics(cached);
      setRefreshedAt(selectedDb ? getCachedDashboardRefreshedAt(selectedDb) : null);
      setRefreshedBy(selectedDb ? getCachedDashboardRefreshedBy(selectedDb) : null);
      setActiveSnapshot(null);
    }
    setRefreshing(isDashboardRefreshing(selectedDb));
    loadHistory(selectedDb);
    loadServerSchedule(selectedDb);
    loadDatapumpJobHistory(selectedDb);
  }, [selectedDb, loadHistory, loadServerSchedule, loadDatapumpJobHistory, isClientWithNoDatabases]);

  // Listen to background refresh events and notifications
  useEffect(() => {
    if (isClientWithNoDatabases || !selectedDb) return;

    const handleNotification = (e: Event) => {
      const customEv = e as CustomEvent<NotificationPayload>;
      const detail = customEv.detail;
      if (!detail) return;
      const type = detail.type || (detail as unknown as Record<string, unknown>).alertType;
      const targetDb = String(detail.db || "").trim().toUpperCase();
      const currentDb = selectedDb.trim().toUpperCase();

      if (targetDb && targetDb === currentDb) {
        if (type === "refresh_dashboard") {
          void loadHistory(selectedDb);
        }
      }
    };

    const handleRefreshStart = (e: Event) => {
      const customEv = e as CustomEvent<{ db?: string }>;
      if (customEv.detail?.db && customEv.detail.db.toUpperCase() === selectedDb.toUpperCase()) {
        setRefreshing(true);
        setError(null);
        setActiveSnapshot(null);
      }
    };

    const handleRefreshComplete = (e: Event) => {
      const customEv = e as CustomEvent<{
        db?: string;
        metrics?: DashboardMetrics | null;
        refreshedAt?: string | null;
        refreshedBy?: string | null;
      }>;
      if (customEv.detail?.db && customEv.detail.db.toUpperCase() === selectedDb.toUpperCase()) {
        setRefreshing(false);
        if (customEv.detail.metrics) {
          setMetrics(customEv.detail.metrics);
        }
        if (customEv.detail.refreshedAt) {
          setRefreshedAt(customEv.detail.refreshedAt);
        }
        setRefreshedBy(customEv.detail.refreshedBy ?? null);
        void loadDatapumpJobHistory(selectedDb);
      }
    };

    const handleRefreshError = (e: Event) => {
      const customEv = e as CustomEvent<{ db?: string; error?: string }>;
      if (customEv.detail?.db && customEv.detail.db.toUpperCase() === selectedDb.toUpperCase()) {
        setRefreshing(false);
        setError(customEv.detail.error || "Refresh failed.");
      }
    };

    window.addEventListener("dba-notification", handleNotification);
    window.addEventListener("dba-dashboard-refresh-start", handleRefreshStart);
    window.addEventListener("dba-dashboard-refresh-complete", handleRefreshComplete);
    window.addEventListener("dba-dashboard-refresh-error", handleRefreshError);

    return () => {
      window.removeEventListener("dba-notification", handleNotification);
      window.removeEventListener("dba-dashboard-refresh-start", handleRefreshStart);
      window.removeEventListener("dba-dashboard-refresh-complete", handleRefreshComplete);
      window.removeEventListener("dba-dashboard-refresh-error", handleRefreshError);
    };
  }, [selectedDb, loadHistory, loadDatapumpJobHistory, isClientWithNoDatabases]);

  // Trigger n8n refresh_dashboard workflow via background service.
  const handleRefresh = useCallback(async () => {
    if (!selectedDb) return;
    setRefreshing(true);
    setError(null);
    setActiveSnapshot(null);
    try {
      void loadDatapumpJobHistory(selectedDb);
      await triggerDashboardRefresh(selectedDb, user?.username);
      setJustRefreshed(true);
      if (justRefreshedTimerRef.current) {
        clearTimeout(justRefreshedTimerRef.current);
      }
      justRefreshedTimerRef.current = setTimeout(() => {
        setJustRefreshed(false);
      }, 4000);

      // Trigger whole-dashboard visual reload animation
      setReloadKey((prev) => prev + 1);
      setIsReloading(true);
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
      reloadTimerRef.current = setTimeout(() => {
        setIsReloading(false);
      }, 850);

      toast.success("Dashboard refreshed successfully", {
        description: `Live metrics and health status updated for ${selectedDb.toUpperCase()}.`,
        duration: 4000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refresh failed.";
      setError(msg);
      toast.error("Dashboard refresh failed", {
        description: msg,
      });
    }
  }, [selectedDb, loadDatapumpJobHistory, user?.username]);

  const scrollToSection = useCallback((sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────

  const m           = metrics;
  const dbHealth    = m?.db_health;
  const osRes       = m?.os_resources;
  const sgaPga      = m?.sga_pga;
  const tablespaces = m?.tablespaces ?? [];
  const backups     = m?.rman_backups ?? [];
  const blocking    = m?.blocking_sessions ?? [];
  const archiveLogs = m?.archive_log_generation ?? [];
  const passwordExpiringUsers = m?.password_expiring_users ?? [];
  const usersExpiringCount = safeNum(m?.users_expiring_in_15_days ?? passwordExpiringUsers.length);
  const tablespacesOver90 = safeNum(m?.tablespaces_over_90 ?? tablespaces.filter((t) => safeNum(t.pct_used) >= 90).length);
  const failedLoginCount = safeNum(m?.failed_login_count);
  // fra_size_gb === 0 means FRA is not configured for this DB
  const fraRaw      = m?.fra;
  const fra         = fraRaw && safeNum(fraRaw.fra_size_gb) > 0 ? fraRaw : null;
  const oraErrors   = m?.ora_errors ?? [];

  const memTotalGb    = safeNum(osRes?.total_memory_gb);
  const memFreeGb     = safeNum(osRes?.free_memory_gb);
  const memUsedGb     = Math.max(0, memTotalGb - memFreeGb);
  // When n8n only returns a raw % (stdout), fall back to that value
  const memPctDirect  = safeNum(osRes?.memory_used_pct);
  const memPct        = memTotalGb > 0
    ? (memUsedGb / memTotalGb) * 100
    : memPctDirect;
  const memPctOnly    = memTotalGb === 0 && memPctDirect > 0; // flag: only % is available

  const maxTablespacePct = Math.max(0, ...tablespaces.map((t) => safeNum(t.pct_used)));
  const cpuPct = safeNum(osRes?.cpu_usage_pct);
  const openModeUpper = (dbHealth?.open_mode ?? "").toUpperCase();
  const isDbStatusOk = !m || !openModeUpper || openModeUpper.includes("READ WRITE") || openModeUpper === "OPEN" || openModeUpper.includes("READ ONLY");
  const listenerUpper = (dbHealth?.listener_status ?? "").toUpperCase();
  const isListenerOk = !m || !listenerUpper || listenerUpper === "UNKNOWN" || listenerUpper === "UP" || listenerUpper === "READY" || listenerUpper === "RUNNING";
  const connUpper = (dbHealth?.connection_test ?? "").toUpperCase();
  const isRemoteConnOk = !m || !connUpper || connUpper === "UNKNOWN" || connUpper === "SUCCESS";

  const isCritical = !!m && (
    maxTablespacePct > 95 ||
    (fra !== null && safeNum(fra.pct_used) > 90) ||
    cpuPct >= 90 ||
    memPct >= 90 ||
    blocking.length > 0 ||
    !isDbStatusOk ||
    !isListenerOk ||
    !isRemoteConnOk
  );
  const isWarning  = !!m && !isCritical && (usersExpiringCount > 0 || failedLoginCount > 50);
  const isHealthy  = !m || (!isCritical && !isWarning);

  const overallBadge = !m ? null : isHealthy ? "HEALTHY" : isWarning ? "WARNING" : "CRITICAL";
  const overallColor = !m ? "" : isHealthy ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : isWarning ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-red-400/30 bg-red-500/10 text-red-300";

  // Build tooltip status info
  const getTooltipText = () => {
    if (!m) return "";
    const reasons: string[] = [];
    if (isCritical) {
      if (maxTablespacePct > 95) {
        reasons.push(`- Tablespace usage above 95% (Max: ${maxTablespacePct.toFixed(1)}%)`);
      }
      if (fra && safeNum(fra.pct_used) > 90) {
        reasons.push(`- FRA usage above 90% (${safeNum(fra.pct_used).toFixed(1)}%)`);
      }
      if (cpuPct >= 90) {
        reasons.push(`- CPU usage at or above 90% (${cpuPct.toFixed(1)}%)`);
      }
      if (memPct >= 90) {
        reasons.push(`- Memory usage at or above 90% (${memPct.toFixed(1)}%)`);
      }
      if (blocking.length > 0) {
        reasons.push(`- Active blocking sessions (${blocking.length})`);
      }
      if (!isDbStatusOk) {
        reasons.push(`- Database status is negative (${dbHealth?.open_mode || "RESTRICTED"})`);
      }
      if (!isListenerOk) {
        reasons.push(`- Listener status is negative (${dbHealth?.listener_status || "DOWN"})`);
      }
      if (!isRemoteConnOk) {
        reasons.push(`- Remote connection test negative (${dbHealth?.connection_test || "FAILED"})`);
      }
    } else if (isWarning) {
      if (usersExpiringCount > 0) {
        reasons.push(`- Users expiring in 15 days (${usersExpiringCount})`);
      }
      if (failedLoginCount > 50) {
        reasons.push(`- Failed login attempts > 50 (${failedLoginCount})`);
      }
    }

    const reasonsStr = reasons.length > 0 ? `Triggered by:\n${reasons.join("\n")}\n\n` : "";

    return `${reasonsStr}Status Rules:\n• CRITICAL: Tablespace > 95%, FRA > 90%, CPU/Memory ≥ 90%, Blocking sessions > 0, or negative DB/Listener/Remote connection\n• WARNING: Expiring users in 15 days or Failed logins > 50\n• HEALTHY: None of the above`;
  };

  // ── No databases assigned (client role) ─────────────────────────────────

  if (isClientWithNoDatabases) {
    return <NoDatabasesState />;
  }

  // ── Loading skeleton ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-14 animate-pulse rounded-xl bg-secondary/40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary/40" />)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary/40" />)}
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-secondary/40" />)}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl bg-secondary/40" />
          <div className="h-72 animate-pulse rounded-xl bg-secondary/40" />
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      key={reloadKey}
      className={cn(
        "min-w-0 max-w-full space-y-3.5 relative",
        isReloading && "animate-dashboard-reload"
      )}
    >
      {/* ── Visual Reload Sweep Animation ─────────────────────────────────── */}
      {isReloading && (
        <>
          <div className="fixed top-0 left-0 right-0 z-50 h-[3px] overflow-hidden bg-transparent pointer-events-none">
            <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 animate-[scan_0.85s_ease-in-out_infinite]" />
          </div>
          <div
            className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-2xl"
            aria-hidden="true"
          >
            <div className="h-44 w-full bg-gradient-to-b from-cyan-400/0 via-cyan-400/15 dark:via-cyan-400/20 to-transparent animate-dashboard-sweep" />
          </div>
        </>
      )}

      {/* ── PRINT-ONLY REPORT HEADER ─────────────────────────────────────── */}
      <div className="hidden print:block rounded-xl border border-slate-300 bg-slate-50 p-5 mb-6 text-slate-900 shadow-none">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-rose-600">ITSS DBA PORTAL</span>
              <span className="text-slate-400">|</span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Oracle Database Monitoring Report</h1>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Database Target: <span className="font-bold text-slate-900">{selectedDb}</span>
              {dbTarget && (
                <span> ({dbTarget.division ? `${dbTarget.division} \u2022 ` : ""}{dbTarget.env_label} &bull; {dbTarget.os} &bull; {dbTarget.db_type}{(dbTarget.db_version || dbHealth?.db_version) ? ` \u2022 ${dbTarget.db_version || dbHealth?.db_version}` : ""}{dbTarget.server_name ? ` \u2022 Server: ${dbTarget.server_name}` : ""}{dbTarget.zone ? ` \u2022 Zone: ${dbTarget.zone}` : ""}{(dbTarget.location || dbTarget.region) ? ` \u2022 Loc: ${dbTarget.location || dbTarget.region}` : ""}{dbTarget.db_port ? ` \u2022 Port: ${dbTarget.db_port}` : ""})</span>
              )}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p className="font-semibold text-slate-900">Report Generated: {new Date().toLocaleString("en-IN")}</p>
            {user?.username && <p>Exported By: <span className="font-medium text-slate-800">{user.username.toUpperCase()}</span></p>}
            {refreshedAt && <p>Snapshot Captured: <span className="font-medium text-slate-800">{formatAppDateTime(refreshedAt)}</span></p>}
          </div>
        </div>
        {overallBadge && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">Overall System Health:</span>
            <span className={`rounded-md px-2 py-0.5 font-bold border text-[11px] ${
              overallBadge === "HEALTHY" ? "border-emerald-600/40 bg-emerald-50 text-emerald-800" :
              overallBadge === "WARNING" ? "border-amber-600/40 bg-amber-50 text-amber-800" :
              "border-red-600/40 bg-red-50 text-red-800"
            }`}>
              {overallBadge}
            </span>
          </div>
        )}
      </div>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-xl sm:text-[25px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span>Oracle Database Monitoring Dashboard:</span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 dark:bg-cyan-500/15 px-2.5 py-0.5 font-mono font-semibold text-cyan-700 dark:text-cyan-300 text-lg sm:text-[21px]">
              <Database className="h-4.5 w-4.5 text-cyan-500 shrink-0" />
              <span>{selectedDb}</span>
            </span>
            {/* Server-side schedule badge — hidden for client role */}
            {user?.role !== "client" && serverSchedule && (
              <button
                type="button"
                onClick={() => setScheduleModalOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors hover:opacity-80 ml-1 ${
                  serverSchedule.is_active
                    ? "border-violet-400/40 bg-violet-400/10 text-violet-700 dark:text-violet-300"
                    : "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-400"
                }`}
                title="Server-side scheduled refresh — runs even when browser is closed"
              >
                <Calendar className="h-3.5 w-3.5" />
                {serverSchedule.is_active ? "Scheduled" : "Paused"}
                {serverSchedule.is_active && (
                  <span className="opacity-70">
                    {serverSchedule.interval_min < 60
                      ? `· ${serverSchedule.interval_min}m`
                      : `· ${serverSchedule.interval_min / 60}h`}
                  </span>
                )}
              </button>
            )}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {dbTarget && (
              <>
                {dbTarget.division && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getDivisionBadgeColor(dbTarget.division)} cursor-help`}
                    title={`Division: ${dbTarget.division}`}
                  >
                    {dbTarget.division}
                  </span>
                )}
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getEnvBadgeColor(dbTarget.env_label)} cursor-help`}
                  title={`Environment: ${dbTarget.env_label}`}
                >
                  {dbTarget.env_label}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getOsBadgeColor(dbTarget.os)} cursor-help`}
                  title={`Operating System: ${dbTarget.os}`}
                >
                  {dbTarget.os}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getDbTypeBadgeColor(dbTarget.db_type)} cursor-help`}
                  title={`Database Architecture: ${dbTarget.db_type}`}
                >
                  {dbTarget.db_type}
                </span>
                {(dbTarget.db_version || dbHealth?.db_version) && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-mono font-semibold ${getDbVersionBadgeColor()} cursor-help`}
                    title={`DB Version: ${dbTarget.db_version || dbHealth?.db_version}`}
                  >
                    {dbTarget.db_version || dbHealth?.db_version}
                  </span>
                )}
                {dbTarget.server_name && (
                  <span
                    className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-0.5 text-xs font-mono font-semibold text-sky-800 dark:text-sky-300 cursor-help"
                    title={`Server Hostname: ${dbTarget.server_name}`}
                  >
                    {dbTarget.server_name}
                  </span>
                )}
                {dbTarget.zone && (
                  <span
                    className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 dark:text-indigo-300 cursor-help"
                    title={`Network Zone: ${dbTarget.zone}`}
                  >
                    {dbTarget.zone}
                  </span>
                )}
                {(dbTarget.location || dbTarget.region) && (
                  <span
                    className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 cursor-help"
                    title={`Data Center Location: ${dbTarget.location || dbTarget.region}`}
                  >
                    {dbTarget.location || dbTarget.region}
                  </span>
                )}
                {dbTarget.db_port && (
                  <span
                    className="rounded-full border border-lime-500/40 bg-lime-500/15 px-2.5 py-0.5 text-xs font-mono font-semibold text-lime-800 dark:text-lime-300 cursor-help"
                    title={`Database Listener Port: ${dbTarget.db_port}`}
                  >
                    :{dbTarget.db_port}
                  </span>
                )}
              </>
            )}
            {overallBadge && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide ${overallColor} cursor-help print:hidden`}
                title={getTooltipText()}
              >
                {overallBadge}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1.5 text-sm text-muted-foreground">
            {refreshedAt
              ? <>Last snapshot: <span className="font-medium text-slate-300">{formatAppDateTime(refreshedAt)}</span>{refreshedBy ? <> by <span className="font-medium text-slate-300">{String(refreshedBy).toUpperCase()}</span></> : ""}</>
              : "No snapshot yet — click Refresh to collect metrics"
            }
            {justRefreshed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 dark:text-emerald-300 animate-in fade-in zoom-in-95 duration-300">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Refreshed
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col sm:items-end gap-2 print:hidden">
          <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => scrollToSection("historical-trends")}
              className="gap-1.5 border-purple-500/30 text-purple-600 dark:text-purple-300 hover:bg-purple-500/10"
              title="Scroll to historical performance & capacity trends"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Historical Trends
            </Button>

            {/* Schedule button — hidden for client role */}
            {user?.role !== "client" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScheduleModalOpen(true)}
                className="gap-1.5"
                title="Configure server-side scheduled refresh"
              >
                <Calendar className="h-3.5 w-3.5" />
                Schedule refresh
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!m} className="gap-1.5">
              <FileDown className="h-3.5 w-3.5" />
              PDF Export
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryModalOpen(true)}
              className="gap-1.5 border-cyan-500/30 text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/10"
              title="View historical snapshots for this database"
            >
              <History className="h-3.5 w-3.5" />
              Historical Snapshots
            </Button>

            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className={cn(
                "gap-2 transition-all duration-200 disabled:opacity-60",
                justRefreshed
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/50"
                  : "bg-cyan-600 text-white hover:bg-cyan-500",
                user?.role !== "client" && "col-span-2"
              )}
            >
              {refreshing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Collecting…
                </>
              ) : justRefreshed ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-white animate-in zoom-in-50 duration-200" />
                  Refreshed!
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Active Historical Snapshot Banner ────────────────────────────── */}
      {activeSnapshot && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 dark:bg-amber-950/30 p-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
              <History className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Viewing Historical Snapshot
                </span>
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                  ID #{activeSnapshot.id}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Captured at <span className="font-semibold text-foreground">{formatAppDateTime(activeSnapshot.refresh_timestamp)}</span>
                {activeSnapshot.refreshed_by && <> by <span className="font-semibold text-cyan-600 dark:text-cyan-300">{activeSnapshot.refreshed_by.toUpperCase()}</span></>}
              </p>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleReturnToLatest}
            className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20 text-xs font-semibold print:hidden"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Return to Latest Live View
          </Button>
        </div>
      )}

      {/* ── Error Banner ───────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── EMPTY STATE ────────────────────────────────────────────────── */}
      {!m ? (
        <EmptyState onRefresh={handleRefresh} loading={refreshing} justRefreshed={justRefreshed} />
      ) : (
        <>
          {/* ── SECTION 1: DB HEALTH BANNER ────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {/* DB Status */}
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-2.5">
                <Database className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Database Status</p>
                <p className="truncate text-sm font-bold text-slate-200">{dbHealth?.open_mode ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">{dbHealth?.db_name ?? selectedDb}</p>
              </div>
              <div className="ml-auto">
                <StatusPill ok={dbHealth?.open_mode?.includes("READ WRITE") ?? false} label={dbHealth?.open_mode?.includes("READ WRITE") ? "OPEN" : "RESTRICTED"} />
              </div>
            </div>

            {/* Listener */}
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="rounded-lg border border-purple-400/20 bg-purple-400/10 p-2.5">
                <Unplug className="h-5 w-5 text-purple-300" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Listener Status</p>
                <p className="truncate text-sm font-bold text-slate-200">{dbHealth?.listener_status ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">TNS / JDBC</p>
              </div>
              <div className="ml-auto">
                {(() => {
                  const ls = (dbHealth?.listener_status ?? "").toUpperCase();
                  const up = ls === "UP" || ls === "READY" || ls === "RUNNING";
                  return <StatusPill ok={up} label={up ? "UP" : "DOWN"} />;
                })()}
              </div>
            </div>

            {/* Remote Connection */}
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="rounded-lg border border-blue-400/20 bg-blue-400/10 p-2.5">
                <Server className="h-5 w-5 text-blue-300" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Remote Connection</p>
                <p className={`truncate text-sm font-bold ${dbHealth?.connection_test === "SUCCESS" ? "text-emerald-300" : dbHealth?.connection_test === "FAILED" ? "text-red-300" : "text-slate-400"}`}>
                  {dbHealth?.connection_test ?? "UNKNOWN"}
                </p>
                <p className="truncate text-xs text-muted-foreground">connected successfully</p>
              </div>
              <div className="ml-auto">
                <StatusPill ok={dbHealth?.connection_test === "SUCCESS"} label={dbHealth?.connection_test === "SUCCESS" ? "OK" : "FAIL"} />
              </div>
            </div>

            {/* Uptime */}
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-2.5">
                <Clock className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Instance Uptime</p>
                <p className="truncate text-sm font-bold text-emerald-300">{fmtUptime(dbHealth?.uptime_hours ?? 0)}</p>
                <p className="truncate text-xs text-muted-foreground">{dbHealth?.instance_name ?? "—"}</p>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1">
                <span className="text-xs font-medium text-muted-foreground">since</span>
                <span className="text-[10px] text-slate-400">{dbHealth?.startup_time ? new Date(dbHealth.startup_time).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</span>
              </div>
            </div>
          </div>

          {/* ── SECTION 2: OPERATIONS KPIs ─────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile icon={Users}         label="Active Sessions"    value={m.active_sessions}   sub="USER type, ACTIVE status" variant="healthy" />
            <KpiTile icon={Activity}      label="Inactive Sessions"  value={m.inactive_sessions}  sub="SQL*Net wait or idle"    variant="neutral" />
            <KpiTile
              icon={Database}
              label="Tablespaces >90%"
              value={tablespacesOver90}
              sub="Capacity threshold breached"
              variant={tablespacesOver90 > 0 ? "critical" : "healthy"}
              onClick={() => scrollToSection("tablespace-utilization")}
            />
            <KpiTile
              icon={Users}
              label="Password Expiring"
              value={usersExpiringCount}
              sub="Open users within 15 days"
              variant={usersExpiringCount > 0 ? "warning" : "healthy"}
              onClick={() => scrollToSection("password-expiry")}
            />
          </div>

          {/* ── SECTION 3: COMPUTE RESOURCES & PERFORMANCE KPIs (with RMAN Backup History) ── */}
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              {/* CPU & Memory */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* CPU */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Cpu className="h-4 w-4 text-cyan-300" />
                      CPU Utilization
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="relative flex h-32 w-32 items-center justify-center">
                        <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                          <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(142,163,184,0.12)" strokeWidth="12" />
                          <circle
                            cx="60" cy="60" r="48" fill="none"
                            stroke={pctStroke(safeNum(osRes?.cpu_usage_pct))}
                            strokeWidth="12"
                            strokeDasharray={`${safeNum(osRes?.cpu_usage_pct) * 3.016} 301.6`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className={`text-2xl font-bold tabular-nums ${pctColor(safeNum(osRes?.cpu_usage_pct))}`}>
                            {safeNum(osRes?.cpu_usage_pct).toFixed(1)}%
                          </span>
                          <span className="text-[10px] text-muted-foreground">CPU</span>
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2 text-center text-xs font-medium ${pctColor(safeNum(osRes?.cpu_usage_pct))} border-current/20 bg-current/5`}>
                      {safeNum(osRes?.cpu_usage_pct) < 60 ? "Normal load" : safeNum(osRes?.cpu_usage_pct) < 80 ? "Moderate load" : "High CPU pressure"}
                    </div>
                  </CardContent>
                </Card>

                {/* Memory */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <HardDrive className="h-4 w-4 text-violet-300" />
                      OS Memory
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {memPctOnly ? (
                      /* n8n returned only a percentage (stdout) — show circular gauge */
                      <div className="space-y-3">
                        <div className="flex items-center justify-center">
                          <div className="relative flex h-32 w-32 items-center justify-center">
                            <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                              <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(142,163,184,0.12)" strokeWidth="12" />
                              <circle cx="60" cy="60" r="48" fill="none"
                                stroke={pctStroke(memPct)} strokeWidth="12"
                                strokeDasharray={`${memPct * 3.016} 301.6`} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className={`text-2xl font-bold tabular-nums ${pctColor(memPct)}`}>{memPct.toFixed(1)}%</span>
                              <span className="text-[10px] text-muted-foreground">used</span>
                            </div>
                          </div>
                        </div>
                        <div className={`rounded-lg border px-3 py-2 text-center text-xs font-medium ${pctColor(memPct)} border-current/20 bg-current/5`}>
                          {memPct < 70 ? "Memory pressure normal" : memPct < 85 ? "Memory under moderate pressure" : "High memory pressure"}
                        </div>
                      </div>
                    ) : (
                      /* Full GB breakdown available */
                      <div className="space-y-3">
                        <LinearGauge label="Memory Used" value={memUsedGb} max={memTotalGb || 64} unit=" GB" color={pctBarColor(memPct)} />
                        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/40 bg-secondary/30 p-3 text-center text-xs">
                          <div>
                            <p className="text-muted-foreground">Total</p>
                            <p className="font-bold text-slate-200">{memTotalGb.toFixed(1)} GB</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Used</p>
                            <p className={`font-bold ${pctColor(memPct)}`}>{memUsedGb.toFixed(1)} GB</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Free</p>
                            <p className="font-bold text-emerald-300">{memFreeGb.toFixed(1)} GB</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* 4 DB Performance & Capacity Parameters */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile
                  icon={Database}
                  label="Database Size"
                  value={m.total_db_size_gb != null ? `${safeNum(m.total_db_size_gb).toFixed(2)} GB` : "—"}
                  sub="Data, temp & redo log"
                  variant="healthy"
                />
                <KpiTile
                  icon={Clock}
                  label="Avg Response Time"
                  value={m.db_response_time_ms != null ? `${safeNum(m.db_response_time_ms).toFixed(2)} ms` : "—"}
                  sub="Last 60 mins (SQL)"
                  variant={m.db_response_time_ms == null ? "neutral" : safeNum(m.db_response_time_ms) > 100 ? "critical" : safeNum(m.db_response_time_ms) > 20 ? "warning" : "healthy"}
                />
                <KpiTile
                  icon={Users}
                  label="1h Avg Active Sessions"
                  value={m.avg_active_sessions_1hr != null ? safeNum(m.avg_active_sessions_1hr).toFixed(2) : "0.00"}
                  sub="DB time / sec (60m)"
                  variant={m.avg_active_sessions_1hr == null ? "neutral" : safeNum(m.avg_active_sessions_1hr) > 10 ? "warning" : "healthy"}
                />
                <KpiTile
                  icon={TrendingUp}
                  label="1h Peak Active Sessions"
                  value={m.peak_active_sessions_1hr != null ? safeNum(m.peak_active_sessions_1hr).toFixed(2) : "0.00"}
                  sub="Peak DB time / sec (60m)"
                  variant={m.peak_active_sessions_1hr == null ? "neutral" : safeNum(m.peak_active_sessions_1hr) > 20 ? "warning" : "healthy"}
                />
              </div>
            </div>

            {/* RMAN Backup History — Green Section */}
            <Card className="flex flex-col h-full xl:col-start-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ArchiveRestore className="h-4 w-4 text-emerald-300" />
                  RMAN Backup History
                  <span className="ml-auto text-xs font-normal text-muted-foreground">Last 5 jobs</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                <div className="max-h-[250px] xl:max-h-[265px] flex-1 overflow-y-auto pr-1 space-y-2">
                  {backups.length > 0 ? backups.map((b, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 p-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-secondary/40 text-xs font-bold text-muted-foreground">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-200">{b.input_type}</span>
                          <BackupStatusBadge status={b.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {b.start_time}
                          {b.duration_min ? <> &middot; <span className="text-slate-400">{safeNum(b.duration_min).toFixed(1)} min</span></> : ""}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 print:hidden" />
                    </div>
                  )) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">No backup history found.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── SECTION 4: OPERATIONS & DATA PUMP (Red Section) ───────────── */}
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              {/* Operations & Security Status Cards */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile
                  icon={AlertTriangle}
                  label="Failed Jobs"
                  value={m.failed_jobs}
                  sub="Scheduler job failures"
                  variant={m.failed_jobs > 0 ? "warning" : "healthy"}
                  onClick={() => setFailedJobsModalOpen(true)}
                />
                <KpiTile
                  icon={Layers}
                  label="Invalid Objects"
                  value={m.invalid_objects}
                  sub="PL/SQL, views, triggers"
                  variant={m.invalid_objects > 10 ? "warning" : m.invalid_objects > 0 ? "neutral" : "healthy"}
                  onClick={() => setInvalidObjectsModalOpen(true)}
                />
                <KpiTile
                  icon={Shield}
                  label="Failed Logins"
                  value={failedLoginCount}
                  sub="Last 24 hours"
                  variant={failedLoginCount > 50 ? "warning" : "healthy"}
                />
                <KpiTile
                  icon={Shield}
                  label="Blocking Sessions"
                  value={blocking.length}
                  sub={blocking.length > 0 ? "TX lock contention" : "No blockers"}
                  variant={blocking.length > 0 ? "critical" : "healthy"}
                />
              </div>

              {/* Monthly Archive Log & Password Expiry */}
              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ArchiveRestore className="h-4 w-4 text-cyan-300" />
                      Monthly Archive Log Generation
                      <span className="ml-auto text-xs font-normal text-muted-foreground">6 months</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {archiveLogs.length > 0 ? (
                      <ArchiveLogChart rows={archiveLogs} />
                    ) : (
                      <p className="py-10 text-center text-sm text-muted-foreground">No archive log generation data.</p>
                    )}
                  </CardContent>
                </Card>

                <Card id="password-expiry" className="scroll-mt-24">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Shield className="h-4 w-4 text-amber-300" />
                      Password Expiry
                      <span className="ml-auto text-xs font-normal text-muted-foreground">Next 15 days</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-[210px] space-y-2 overflow-y-auto pr-1">
                      {passwordExpiringUsers.length > 0 ? passwordExpiringUsers.map((userRow, i) => (
                        <div key={`${userRow.username}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-200">{userRow.username || "UNKNOWN"}</p>
                            <p className="text-xs text-muted-foreground">{userRow.account_status || "OPEN"}</p>
                          </div>
                          <span className="shrink-0 rounded border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
                            {fmtDateOnly(userRow.expiry_date)}
                          </span>
                        </div>
                      )) : (
                        <div className="flex flex-col items-center gap-2 py-10">
                          <CheckCircle2 className="h-8 w-8 text-emerald-400/60" />
                          <p className="text-sm font-medium text-emerald-300">No passwords expiring soon</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Data Pump — Red Section */}
            <Card className="flex flex-col h-full xl:col-start-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm cursor-pointer" onClick={() => setDpHistoryModalOpen(true)}>
                  <ArchiveRestore className="h-4 w-4 text-emerald-300" />
                  Data Pump
                  <span className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground transition-colors">
                    {datapumpLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin inline" />
                    ) : datapumpJobHistory.length > 0 ? (
                      `${datapumpJobHistory.length} job${datapumpJobHistory.length !== 1 ? "s" : ""}`
                    ) : (
                      "0 jobs"
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                <div className="max-h-[250px] xl:max-h-[265px] flex-1 overflow-y-auto pr-1 space-y-2">
                  {datapumpLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
                      <p className="text-xs">Loading Data Pump job history...</p>
                    </div>
                  ) : datapumpJobHistory.length > 0 ? (
                    datapumpJobHistory.slice(0, 10).map((job, i) => {
                      const isRunning = job.status === "running";
                      const isError = job.status === "error";
                      const isExpdp = job.operation === "expdp";
                      return (
                        <div
                          key={`${job.id}-${i}`}
                          onClick={() => setDpHistoryModalOpen(true)}
                          className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 p-2.5 hover:bg-secondary/30 transition-colors cursor-pointer"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-secondary/40 text-xs font-bold text-muted-foreground">
                            {i + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="truncate text-sm font-semibold text-slate-200">
                                {job.dump_file || job.id || "Data Pump job"}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border",
                                  isRunning
                                    ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                                    : isError
                                    ? "border-red-400/30 bg-red-500/10 text-red-300"
                                    : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                )}
                              >
                                {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                {job.status.toUpperCase()}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border",
                                  isExpdp
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                    : "border-violet-500/40 bg-violet-500/10 text-violet-300"
                                )}
                              >
                                {job.operation.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              <span className="text-slate-400">{job.requested_by || "system"}</span>
                              {" "}&middot; {job.db || selectedDb} &middot; {job.started_at ? formatAppDateTime(job.started_at) : "-"}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 print:hidden" />
                        </div>
                      );
                    })
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No Data Pump job history found for {selectedDb}.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── SECTION 4: STORAGE ─────────────────────────────────────── */}
          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            {/* Tablespace Chart */}
            <Card id="tablespace-utilization" className="scroll-mt-24 flex flex-col h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-cyan-300" />
                  Tablespace Utilization
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{tablespaces.length} tablespace{tablespaces.length !== 1 ? "s" : ""}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col space-y-4">
                {tablespaces.length > 0 ? (
                  <>
                    <TablespaceBarChart rows={tablespaces} />
                    <div className="max-h-[280px] xl:max-h-[320px] flex-1 overflow-y-auto pr-1 space-y-2">
                      {tablespaces.map((t, i) => {
                        const pct  = safeNum(t.pct_used);
                        const used = safeNum(t.used_mb);
                        const tot  = safeNum(t.total_mb);
                        return (
                          <div key={t.tablespace_name ?? i} className="flex items-center gap-3 text-xs">
                            <span className="w-28 shrink-0 truncate font-mono text-slate-300">{t.tablespace_name}</span>
                            <div className="flex-1">
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                                <div className={`h-full rounded-full ${pctBarColor(pct)}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <span className={`w-10 text-right font-bold tabular-nums ${pctColor(pct)}`}>{pct.toFixed(0)}%</span>
                            <span className="w-24 text-right text-muted-foreground">{fmtMb(used)} / {fmtMb(tot)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">No tablespace data.</p>
                )}
              </CardContent>
            </Card>

            {/* Critical ORA Errors */}
            <Card className="flex flex-col h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-300" />
                  Critical ORA Errors
                  <span className="ml-auto text-xs font-normal text-muted-foreground">Last 5 from alert log</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col">
                <div className="max-h-[540px] xl:max-h-[580px] flex-1 overflow-y-auto pr-1 space-y-2">
                  {oraErrors.length > 0 ? oraErrors.map((e, i) => (
                    <div key={i} className="rounded-lg border border-red-400/20 bg-red-500/5 p-3">
                      <p className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatAppDateTime(e.originating_timestamp)}
                      </p>
                      <p className="font-mono text-xs leading-relaxed text-red-300 break-all">{e.message_text}</p>
                    </div>
                  )) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 flex-1">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400/60" />
                      <p className="text-sm font-medium text-emerald-300">No critical ORA errors</p>
                      <p className="text-xs text-muted-foreground">Alert log is clean.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── SECTION 5: FRA + ORA ERRORS ────────────────────────────── */}
          <div className="grid gap-5 xl:grid-cols-2">
            {/* FRA Utilization — moved here */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <ArchiveRestore className="h-4 w-4 text-amber-300" />
                  FRA Utilization
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fra ? (
                  <div className="flex flex-col items-center gap-5">
                    <FraDonut pct={safeNum(fra.pct_used)} usedGb={safeNum(fra.used_gb)} sizeGb={safeNum(fra.fra_size_gb)} />
                    <div className="w-full space-y-2 rounded-xl border border-border/50 bg-secondary/20 p-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Location</span>
                        <span className="font-mono font-medium text-slate-300">{fra.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Reclaimable</span>
                        <span className="font-semibold text-cyan-300">{safeNum(fra.reclaimable_gb).toFixed(1)} GB</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">% Used</span>
                        <span className={`font-bold tabular-nums ${pctColor(fra.pct_used)}`}>{safeNum(fra.pct_used).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <ArchiveRestore className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground">FRA Not Configured</p>
                    <p className="text-xs text-muted-foreground/70">v$recovery_file_dest returned no rows for this database.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SGA & PGA */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-300" />
                  SGA &amp; PGA Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "SGA Target",           value: sgaPga?.sga_target           ?? "—" },
                  { label: "SGA Max Size",          value: sgaPga?.sga_max_size         ?? "—" },
                  { label: "PGA Aggregate Target",  value: sgaPga?.pga_aggregate_target ?? "—" },
                  { label: "PGA Aggregate Limit",   value: sgaPga?.pga_aggregate_limit  ?? "—" }
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-secondary/20 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="rounded border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-xs font-bold font-mono text-amber-300">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── SECTION 6: BLOCKING SESSIONS TABLE (conditional) ───────── */}
          {blocking.length > 0 && (
            <Card className="border-red-400/30 bg-red-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-red-300">
                  <Shield className="h-4 w-4" />
                  Active Blocking Sessions
                  <span className="ml-2 rounded-full border border-red-400/40 bg-red-500/20 px-2 py-0.5 text-xs font-bold">{blocking.length}</span>
                  <span className="ml-auto text-xs font-normal text-red-300/60">Requires immediate attention</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-red-400/20">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead>
                      <tr className="border-b border-red-400/20 bg-red-500/10">
                        {["Waiter SID", "Waiter User", "Waiter SQL", "Blocker SID", "Blocker User", "Blocker SQL", "Wait (min)", "Event"].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left font-semibold text-red-200">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {blocking.map((row, i) => (
                        <tr key={i} className="border-b border-red-400/10 last:border-0 hover:bg-red-500/5">
                          <td className="px-3 py-2 font-mono font-bold text-red-300">{row.waiter_sid}</td>
                          <td className="px-3 py-2 font-medium text-slate-200">{row.waiter_user}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{row.waiter_sql_id}</td>
                          <td className="px-3 py-2 font-mono font-bold text-amber-300">{row.blocker_sid}</td>
                          <td className="px-3 py-2 font-medium text-slate-200">{row.blocker_user}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{row.blocker_sql_id}</td>
                          <td className="px-3 py-2 font-bold text-red-300 tabular-nums">{row.waiting_min.toFixed(1)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.event}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── SECTION 7: SNAPSHOT INFO FOOTER ───────────────────────── */}
          {serverSchedule?.is_active && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-secondary/20 p-3 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <span>
                <span className="font-medium text-violet-300">Server scheduler active</span>
                {" "}— refreshes every{" "}
                <span className="font-medium text-slate-300">
                  {serverSchedule.interval_min < 60
                    ? `${serverSchedule.interval_min}m`
                    : `${serverSchedule.interval_min / 60}h`}
                </span>
                {" "}even when browser is closed.
              </span>
            </div>
          )}
        </>
      )}

      {/* ── SECTION 8: HISTORICAL PERFORMANCE & CAPACITY TRENDS ─────── */}
      <DashboardHistoricalTrends
        selectedDb={selectedDb}
        refreshKey={reloadKey}
        lastRefreshedAt={refreshedAt}
      />

      {/* ── Schedule Modal ──────────────────────────────────────────── */}
      <ScheduleModal
        open={scheduleModalOpen}
        onClose={() => {
          setScheduleModalOpen(false);
          loadServerSchedule(selectedDb);
        }}
        selectedDb={selectedDb}
      />

      {/* ── Failed Jobs Modal ────────────────────────────────────────── */}
      <FailedJobsModal
        open={failedJobsModalOpen}
        onClose={() => setFailedJobsModalOpen(false)}
        selectedDb={selectedDb}
      />

      {/* ── Invalid Objects Modal ────────────────────────────────────── */}
      <InvalidObjectsModal
        open={invalidObjectsModalOpen}
        onClose={() => setInvalidObjectsModalOpen(false)}
        selectedDb={selectedDb}
      />

      {/* ── Historical Snapshots Modal ───────────────────────────────── */}
      <HistoricalSnapshotsModal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        selectedDb={selectedDb}
        activeSnapshotId={activeSnapshot?.id ?? null}
        onSelectSnapshot={handleSelectSnapshot}
      />

      {/* ── Data Pump Job History Modal ──────────────────────────────── */}
      <JobHistoryModal
        open={dpHistoryModalOpen}
        onOpenChange={setDpHistoryModalOpen}
      />
    </div>
  );
}
