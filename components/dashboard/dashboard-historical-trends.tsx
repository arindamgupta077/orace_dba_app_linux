"use client";

import { useCallback, useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Info,
  Loader2,
  MemoryStick,
  Minus,
  PlugZap,
  RefreshCw,
  TrendingUp,
  User,
  Users,
  XCircle,
  Zap
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { normalizeMetrics, safeNum } from "@/components/dashboard/dashboard-utils";
import { cn, formatAppDateTime } from "@/lib/utils";
import { fetchDashboardTrends, type DashboardTrendsRange } from "@/services/api";
import type { DashboardHistoryRow, NotificationPayload } from "@/types/dba";

// ─── Types & constants ───────────────────────────────────────────────────────

export interface TrendPoint {
  id: number;
  ts: number;
  timestamp: string;
  refreshedBy: string | null;
  dbSizeGb: number | null;
  responseMs: number | null;
  avgSessions: number | null;
  peakSessions: number | null;
  tbsPct: number | null;
  tbsName: string;
  fraPct: number | null;
  cpuPct: number | null;
  memPct: number | null;
  connStatus: "SUCCESS" | "FAILED" | "UNKNOWN";
}

interface SeriesStats {
  current: number | null;
  avg: number | null;
  peak: number | null;
  deltaPct: number | null;
}

interface ConnStats {
  total: number;
  success: number;
  failed: number;
  unknown: number;
  rate: number | null;
  latest: "SUCCESS" | "FAILED" | "UNKNOWN";
  bestStreak: number;
  lastFailure: TrendPoint | null;
}

type TrendDirection = "lower-is-better" | "higher-is-better" | "neutral";

const RANGE_OPTIONS: Array<{ value: DashboardTrendsRange; label: string; title: string }> = [
  { value: "24h", label: "Last 24 Hours", title: "Snapshots captured in the last 24 hours" },
  { value: "7d", label: "Last 7 Days", title: "Snapshots captured in the last 7 days" },
  { value: "30d", label: "Last 30 Days", title: "Snapshots captured in the last 30 days" },
  { value: "all", label: "All Snapshots", title: "Every stored snapshot for this database" }
];

const CHART = {
  axis: "#8ea3b8",
  grid: "rgba(142,163,184,0.12)",
  cursor: "rgba(142,163,184,0.06)",
  // Darker tones for the fixed-size print/PDF chart copies (white paper background)
  axisPrint: "#475569",
  gridPrint: "rgba(71,85,105,0.18)",
  cyan: "#06b6d4",
  emerald: "#10b981",
  violet: "#a78bfa",
  amber: "#f59e0b",
  red: "#ef4444",
  orange: "#f97316",
  blue: "#3b82f6"
};

// ─── Extraction & stats helpers ──────────────────────────────────────────────

// Normalise every snapshot (handles UPPERCASE Oracle CLOB JSON keys) and project
// it onto the 7 trend parameters.
export function toTrendPoint(row: DashboardHistoryRow): TrendPoint {
  const m = normalizeMetrics(row.metrics);

  let tbsPct: number | null = null;
  let tbsName = "";
  for (const t of m?.tablespaces ?? []) {
    const pct = safeNum(t.pct_used);
    if (tbsPct === null || pct > tbsPct) {
      tbsPct = pct;
      tbsName = t.tablespace_name;
    }
  }

  const fra = m?.fra;
  const fraPct = fra && safeNum(fra.fra_size_gb) > 0 ? safeNum(fra.pct_used) : null;

  const os = m?.os_resources;
  // memory_used_pct is optional in the normalized payload (older snapshots may
  // not carry it) — keep it as null so the chart shows a gap instead of a fake 0.
  const memPct = os?.memory_used_pct != null ? safeNum(os.memory_used_pct) : null;

  const conn = (m?.db_health?.connection_test ?? "UNKNOWN").toUpperCase();

  return {
    id: row.id,
    ts: row.refresh_timestamp ? new Date(row.refresh_timestamp).getTime() : NaN,
    timestamp: row.refresh_timestamp,
    refreshedBy: row.refreshed_by,
    dbSizeGb: m?.total_db_size_gb ?? null,
    responseMs: m?.db_response_time_ms ?? null,
    avgSessions: m?.avg_active_sessions_1hr ?? null,
    peakSessions: m?.peak_active_sessions_1hr ?? null,
    tbsPct,
    tbsName,
    fraPct,
    cpuPct: os != null ? safeNum(os.cpu_usage_pct) : null,
    memPct,
    connStatus: conn === "SUCCESS" || conn === "FAILED" ? conn : "UNKNOWN"
  };
}

function computeSeriesStats(values: Array<number | null>): SeriesStats {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) {
    return { current: null, avg: null, peak: null, deltaPct: null };
  }
  const current = nums[nums.length - 1];
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const peak = Math.max(...nums);
  const deltaPct = avg !== 0 ? ((current - avg) / Math.abs(avg)) * 100 : current !== 0 ? 100 : 0;
  return { current, avg, peak, deltaPct };
}

function computeConnStats(points: TrendPoint[]): ConnStats {
  let success = 0;
  let failed = 0;
  let unknown = 0;
  let best = 0;
  let streak = 0;
  let lastFailure: TrendPoint | null = null;

  for (const p of points) {
    if (p.connStatus === "SUCCESS") {
      success++;
      streak++;
      if (streak > best) best = streak;
    } else if (p.connStatus === "FAILED") {
      failed++;
      streak = 0;
      lastFailure = p;
    } else {
      unknown++;
      streak = 0;
    }
  }

  const total = points.length;
  return {
    total,
    success,
    failed,
    unknown,
    rate: total > 0 ? (success / total) * 100 : null,
    latest: total > 0 ? points[total - 1].connStatus : "UNKNOWN",
    bestStreak: best,
    lastFailure
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const fmtGb = (v: number) => `${v.toFixed(v >= 100 ? 1 : 2)} GB`;
const fmtMs = (v: number) => `${v.toFixed(2)} ms`;
const fmtCount = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function formatTick(ts: number, range: DashboardTrendsRange): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  if (range === "24h") {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function successRateClass(rate: number | null): string {
  if (rate == null) return "text-muted-foreground";
  if (rate >= 99) return "text-emerald-600 dark:text-emerald-300";
  if (rate >= 90) return "text-amber-600 dark:text-amber-300";
  return "text-red-600 dark:text-red-300";
}

// ─── KPI badge widgets ───────────────────────────────────────────────────────

function deltaBadgeClass(delta: number, direction: TrendDirection): string {
  const up = delta > 0.05;
  const down = delta < -0.05;
  const neutral = "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300";
  if (!up && !down) return neutral;
  const isBad =
    direction === "lower-is-better" ? up : direction === "higher-is-better" ? down : null;
  if (isBad === null) {
    return up
      ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
      : neutral;
  }
  return isBad
    ? "border-red-400/30 bg-red-500/10 text-red-600 dark:text-red-300"
    : "border-emerald-400/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
}

function TrendKpiCard({
  icon: Icon,
  label,
  stats,
  format,
  direction,
  iconClass,
  sublabel
}: {
  icon: ElementType;
  label: string;
  stats: SeriesStats;
  format: (v: number) => string;
  direction: TrendDirection;
  iconClass: string;
  sublabel?: string;
}) {
  const delta = stats.deltaPct;
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
      <div className={cn("flex items-center gap-1.5", iconClass)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[11px] font-semibold">{label}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-lg font-bold leading-none tabular-nums text-foreground">
          {stats.current != null ? format(stats.current) : "—"}
        </span>
        {delta != null && stats.current != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-bold tabular-nums",
              deltaBadgeClass(delta, direction)
            )}
            title="Current snapshot vs. timeframe average"
          >
            {delta > 0.05 ? (
              <ArrowUpRight className="h-2.5 w-2.5" />
            ) : delta < -0.05 ? (
              <ArrowDownRight className="h-2.5 w-2.5" />
            ) : (
              <Minus className="h-2.5 w-2.5" />
            )}
            {Math.abs(delta).toFixed(Math.abs(delta) >= 10 ? 0 : 1)}% vs avg
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {stats.avg != null ? (
          <>
            Avg <span className="font-semibold tabular-nums">{format(stats.avg)}</span>
          </>
        ) : (
          "No data"
        )}
        {stats.peak != null && (
          <>
            {" · Peak "}
            <span className="font-semibold tabular-nums">{format(stats.peak)}</span>
          </>
        )}
        {sublabel && <> · {sublabel}</>}
      </p>
    </div>
  );
}

function ConnectionKpiCard({ stats }: { stats: ConnStats }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
        <PlugZap className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[11px] font-semibold">Database Availability</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn("text-lg font-bold leading-none tabular-nums", successRateClass(stats.rate))}>
          {stats.rate != null ? `${stats.rate.toFixed(1)}%` : "—"}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-bold",
            stats.latest === "SUCCESS"
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : stats.latest === "FAILED"
                ? "border-red-400/30 bg-red-500/10 text-red-600 dark:text-red-300"
                : "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300"
          )}
          title="Database up status on the latest snapshot (remote connection test)"
        >
          {stats.latest === "SUCCESS" ? "UP" : stats.latest === "FAILED" ? "DOWN" : "UNKNOWN"}
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {stats.total > 0 ? (
          <>
            <span className="font-semibold tabular-nums">
              {stats.success}/{stats.total}
            </span>{" "}
            up · Best streak <span className="font-semibold tabular-nums">{stats.bestStreak}</span>
          </>
        ) : (
          "No data"
        )}
      </p>
    </div>
  );
}

// ─── Tooltip widgets ─────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  payload?: TrendPoint;
}

function TooltipShell({ point, children }: { point: TrendPoint; children?: ReactNode }) {
  return (
    <div className="min-w-[190px] rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-popover-foreground">{formatAppDateTime(point.timestamp)}</p>
      <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
        <User className="h-3 w-3 shrink-0" />
        Captured by <span className="font-medium">{point.refreshedBy || "unknown"}</span>
      </p>
      {children && <div className="mt-1.5 space-y-1">{children}</div>}
    </div>
  );
}

function TooltipMetricRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-semibold tabular-nums text-popover-foreground">{value}</span>
    </p>
  );
}

function DbSizeTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;
  return (
    <TooltipShell point={p}>
      <TooltipMetricRow
        color={CHART.cyan}
        label="Database Size"
        value={p.dbSizeGb != null ? fmtGb(p.dbSizeGb) : "Not captured"}
      />
    </TooltipShell>
  );
}

function UtilTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;
  return (
    <TooltipShell point={p}>
      <TooltipMetricRow
        color={CHART.emerald}
        label={`Max Tablespace${p.tbsName ? ` (${p.tbsName})` : ""}`}
        value={p.tbsPct != null ? fmtPct(p.tbsPct) : "Not captured"}
      />
      <TooltipMetricRow
        color={CHART.violet}
        label="FRA Utilization"
        value={p.fraPct != null ? fmtPct(p.fraPct) : "Not captured"}
      />
    </TooltipShell>
  );
}

function PerfTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;
  return (
    <TooltipShell point={p}>
      <TooltipMetricRow
        color={CHART.cyan}
        label="Avg Response Time"
        value={p.responseMs != null ? fmtMs(p.responseMs) : "Not captured"}
      />
      <TooltipMetricRow
        color={CHART.emerald}
        label="Avg Active Sessions (1h)"
        value={p.avgSessions != null ? fmtCount(p.avgSessions) : "Not captured"}
      />
      <TooltipMetricRow
        color={CHART.violet}
        label="Peak Active Sessions (1h)"
        value={p.peakSessions != null ? fmtCount(p.peakSessions) : "Not captured"}
      />
    </TooltipShell>
  );
}

function OsTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;
  return (
    <TooltipShell point={p}>
      <TooltipMetricRow
        color={CHART.orange}
        label="CPU Utilization"
        value={p.cpuPct != null ? fmtPct(p.cpuPct) : "Not captured"}
      />
      <TooltipMetricRow
        color={CHART.blue}
        label="OS Memory Utilization"
        value={p.memPct != null ? fmtPct(p.memPct) : "Not captured"}
      />
    </TooltipShell>
  );
}

// ─── Chart scaffolding ───────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  badge,
  children
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function ChartNoData({ message }: { message: string }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 bg-secondary/20 text-center">
      <p className="text-sm font-semibold text-muted-foreground">No data in this timeframe</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

// ─── Reusable trend charts ───────────────────────────────────────────────────
// Render fluid (ResponsiveContainer) for the on-screen tabs, or at a fixed pixel
// size for the print/PDF report — ResponsiveContainer cannot measure containers
// hidden with display:none, so print copies must use explicit width/height.

interface TrendChartProps {
  data: TrendPoint[];
  xDomain: [number, number];
  range: DashboardTrendsRange;
  fixedSize?: { width: number; height: number };
}

function DbSizeTrendChart({ data, xDomain, range, fixedSize }: TrendChartProps) {
  const axis = fixedSize ? CHART.axisPrint : CHART.axis;
  const grid = fixedSize ? CHART.gridPrint : CHART.grid;
  const gradId = fixedSize ? "trendSizeFillPrint" : "trendSizeFill";

  const chart = (
    <AreaChart
      data={data}
      margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      {...(fixedSize != null ? { width: fixedSize.width, height: fixedSize.height } : {})}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CHART.cyan} stopOpacity={0.3} />
          <stop offset="100%" stopColor={CHART.cyan} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
      <XAxis
        dataKey="ts"
        type="number"
        scale="time"
        domain={xDomain}
        tickFormatter={(v: number) => formatTick(v, range)}
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        minTickGap={48}
      />
      <YAxis
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        width={60}
        domain={["auto", "auto"]}
        tickFormatter={(v: number) => `${v.toFixed(1)} GB`}
      />
      <Tooltip
        content={<DbSizeTooltip />}
        cursor={{ stroke: "rgba(142,163,184,0.3)", strokeDasharray: "4 4" }}
      />
      <Area
        type="monotone"
        dataKey="dbSizeGb"
        name="Database Size"
        stroke={CHART.cyan}
        strokeWidth={2}
        fill={`url(#${gradId})`}
        dot={false}
        activeDot={{ r: 4, strokeWidth: 0 }}
        connectNulls={false}
      />
    </AreaChart>
  );

  if (fixedSize != null) return chart;
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}

function UtilizationTrendChart({ data, xDomain, range, fixedSize }: TrendChartProps) {
  const axis = fixedSize ? CHART.axisPrint : CHART.axis;
  const grid = fixedSize ? CHART.gridPrint : CHART.grid;

  const chart = (
    <ComposedChart
      data={data}
      margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      {...(fixedSize != null ? { width: fixedSize.width, height: fixedSize.height } : {})}
    >
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
      <XAxis
        dataKey="ts"
        type="number"
        scale="time"
        domain={xDomain}
        tickFormatter={(v: number) => formatTick(v, range)}
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        minTickGap={48}
      />
      <YAxis
        domain={[0, 100]}
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => `${Math.round(v)}%`}
      />
      <ReferenceLine
        y={80}
        stroke={CHART.violet}
        strokeDasharray="5 3"
        label={{ value: "80%", position: "insideRight", fill: CHART.violet, fontSize: 9, dy: -6 }}
      />
      <ReferenceLine
        y={85}
        stroke={CHART.amber}
        strokeDasharray="5 3"
        label={{ value: "85%", position: "insideRight", fill: CHART.amber, fontSize: 9, dy: -6 }}
      />
      <ReferenceLine
        y={90}
        stroke={CHART.red}
        strokeDasharray="5 3"
        label={{ value: "90%", position: "insideRight", fill: CHART.red, fontSize: 9, dy: -6 }}
      />
      <Tooltip
        content={<UtilTooltip />}
        cursor={{ stroke: "rgba(142,163,184,0.3)", strokeDasharray: "4 4" }}
      />
      <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
      <Line
        type="monotone"
        dataKey="tbsPct"
        name="Max Tablespace %"
        stroke={CHART.emerald}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
      />
      <Line
        type="monotone"
        dataKey="fraPct"
        name="FRA %"
        stroke={CHART.violet}
        strokeWidth={2}
        strokeDasharray="6 3"
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
      />
    </ComposedChart>
  );

  if (fixedSize != null) return chart;
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}

function PerfTrendChart({ data, xDomain, range, fixedSize }: TrendChartProps) {
  const axis = fixedSize ? CHART.axisPrint : CHART.axis;
  const grid = fixedSize ? CHART.gridPrint : CHART.grid;

  const chart = (
    <ComposedChart
      data={data}
      margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
      {...(fixedSize != null ? { width: fixedSize.width, height: fixedSize.height } : {})}
    >
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
      <XAxis
        dataKey="ts"
        type="number"
        scale="time"
        domain={xDomain}
        tickFormatter={(v: number) => formatTick(v, range)}
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        minTickGap={48}
      />
      <YAxis
        yAxisId="ms"
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        width={52}
        domain={[0, (dataMax: number) => Math.ceil(Math.max(10, dataMax || 0) * 1.15)]}
        tickFormatter={(v: number) => `${Math.round(v)} ms`}
      />
      <YAxis
        yAxisId="sessions"
        orientation="right"
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        width={36}
        allowDecimals={false}
        domain={[0, (dataMax: number) => Math.ceil(Math.max(1, dataMax || 0) * 1.2)]}
      />
      <Tooltip
        content={<PerfTooltip />}
        cursor={{ fill: CHART.cursor }}
      />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar
        yAxisId="sessions"
        dataKey="peakSessions"
        name="Peak Active Sessions (1h)"
        fill="rgba(167,139,250,0.4)"
        radius={[3, 3, 0, 0]}
        maxBarSize={10}
      />
      <Line
        yAxisId="sessions"
        type="monotone"
        dataKey="avgSessions"
        name="Avg Active Sessions (1h)"
        stroke={CHART.emerald}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
      />
      <Line
        yAxisId="ms"
        type="monotone"
        dataKey="responseMs"
        name="Avg Response Time (ms)"
        stroke={CHART.cyan}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
      />
    </ComposedChart>
  );

  if (fixedSize != null) return chart;
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}

function OsUtilizationTrendChart({ data, xDomain, range, fixedSize }: TrendChartProps) {
  const axis = fixedSize ? CHART.axisPrint : CHART.axis;
  const grid = fixedSize ? CHART.gridPrint : CHART.grid;

  const chart = (
    <ComposedChart
      data={data}
      margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      {...(fixedSize != null ? { width: fixedSize.width, height: fixedSize.height } : {})}
    >
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
      <XAxis
        dataKey="ts"
        type="number"
        scale="time"
        domain={xDomain}
        tickFormatter={(v: number) => formatTick(v, range)}
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        minTickGap={48}
      />
      <YAxis
        domain={[0, 100]}
        stroke={axis}
        fontSize={10}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => `${Math.round(v)}%`}
      />
      <ReferenceLine
        y={80}
        stroke={CHART.amber}
        strokeDasharray="5 3"
        label={{ value: "80%", position: "insideRight", fill: CHART.amber, fontSize: 9, dy: -6 }}
      />
      <ReferenceLine
        y={90}
        stroke={CHART.red}
        strokeDasharray="5 3"
        label={{ value: "90%", position: "insideRight", fill: CHART.red, fontSize: 9, dy: -6 }}
      />
      <Tooltip
        content={<OsTooltip />}
        cursor={{ stroke: "rgba(142,163,184,0.3)", strokeDasharray: "4 4" }}
      />
      <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
      <Line
        type="monotone"
        dataKey="cpuPct"
        name="CPU Utilization %"
        stroke={CHART.orange}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
      />
      <Line
        type="monotone"
        dataKey="memPct"
        name="OS Memory Utilization %"
        stroke={CHART.blue}
        strokeWidth={2}
        strokeDasharray="6 3"
        dot={false}
        activeDot={{ r: 4 }}
        connectNulls={false}
      />
    </ComposedChart>
  );

  if (fixedSize != null) return chart;
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}

function SuccessGauge({ pct }: { pct: number }) {
  const safePct = Math.min(100, Math.max(0, pct));
  const color = safePct >= 99 ? CHART.emerald : safePct >= 90 ? CHART.amber : CHART.red;
  const circumference = 2 * Math.PI * 48;
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(142,163,184,0.12)" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(safePct / 100) * circumference} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>
          {safePct.toFixed(1)}%
        </span>
        <span className="text-[10px] text-muted-foreground">success rate</span>
      </div>
    </div>
  );
}

// ─── Print/PDF report ────────────────────────────────────────────────────────
// Print-only rendering of ALL three trend sections (the interactive tabs are
// print:hidden since only the active tab would otherwise export). Charts render
// at fixed pixel sizes so they appear correctly in the printed PDF regardless of
// the on-screen tab state. Uses explicit light-theme classes because the global
// print CSS flattens the dark portal theme to white paper.

function PrintSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="border-b border-slate-300 pb-1 text-sm font-bold tracking-wide text-slate-900">
      {children}
    </h4>
  );
}

function PrintChartFrame({
  title,
  footnote,
  children
}: {
  title: string;
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-300 p-2">
      <p className="mb-1 text-xs font-semibold text-slate-700">{title}</p>
      {children}
      {footnote && <p className="mt-1 text-[10px] text-slate-500">{footnote}</p>}
    </div>
  );
}

function TrendsPrintReport({
  selectedDb,
  rangeLabel,
  range,
  points,
  healthyPoints,
  excludedCount,
  xDomain,
  osXDomain,
  sizeGrowth,
  hasSizeData,
  hasUtilData,
  hasPerfData,
  hasOsData,
  connStats,
  seriesStats
}: {
  selectedDb: string;
  rangeLabel: string;
  range: DashboardTrendsRange;
  points: TrendPoint[];
  healthyPoints: TrendPoint[];
  excludedCount: number;
  xDomain: [number, number];
  osXDomain: [number, number];
  sizeGrowth: number | null;
  hasSizeData: boolean;
  hasUtilData: boolean;
  hasPerfData: boolean;
  hasOsData: boolean;
  connStats: ConnStats;
  seriesStats: Array<{ label: string; stats: SeriesStats; format: (v: number) => string }>;
}) {
  const first = points[0];
  const last = points[points.length - 1];
  const rangeFilter = RANGE_OPTIONS.find((o) => o.value === range);

  return (
    <div className="hidden space-y-5 print:block">
      {/* ── Print report header (filtered timeline context) ─────────── */}
      <div className="rounded-xl border border-slate-300 p-4 text-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-2.5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">
              ITSS DBA PORTAL
            </p>
            <h3 className="text-base font-bold tracking-tight text-slate-900">
              Historical Performance &amp; Capacity Trends
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Database Target: <span className="font-bold text-slate-900">{selectedDb}</span>
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>
              Timeframe Filter: <span className="font-semibold text-slate-900">{rangeLabel}</span>
            </p>
            <p>
              Snapshots Analyzed: <span className="font-semibold tabular-nums text-slate-900">{points.length}</span>
            </p>
            {first && last && (
              <p>
                Period: {formatAppDateTime(first.timestamp)} → {formatAppDateTime(last.timestamp)}
              </p>
            )}
            <p>Report Generated: {new Date().toLocaleString("en-IN")}</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {excludedCount > 0 ? (
            <>
              Note: <span className="font-semibold tabular-nums">{excludedCount}</span> snapshot
              {excludedCount === 1 ? "" : "s"} with a FAILED remote connection
              {excludedCount === 1 ? " is" : "s are"} excluded from the Capacity &amp; Storage and
              Response Time / Sessions trends; CPU &amp; OS Memory Utilization and Database
              Availability include every snapshot.
            </>
          ) : (
            <>All snapshots in the selected timeframe had a successful remote connection test.</>
          )}
        </p>
      </div>

      {/* ── Summary statistics for the filtered timeline ─────────────── */}
      <div className="break-inside-avoid">
        <PrintSectionHeading>Summary — Current vs Average vs Peak</PrintSectionHeading>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-4 font-semibold">Metric</th>
              <th className="py-1.5 px-3 text-right font-semibold">Current</th>
              <th className="py-1.5 px-3 text-right font-semibold">Average</th>
              <th className="py-1.5 pl-3 text-right font-semibold">Peak</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-1.5 pr-4 font-medium text-slate-700">Database Availability</td>
              <td className="py-1.5 px-3 text-right font-bold tabular-nums text-slate-900">
                {connStats.rate != null ? `${connStats.rate.toFixed(1)}%` : "—"}
              </td>
              <td className="py-1.5 px-3 text-right tabular-nums text-slate-600" colSpan={2}>
                {connStats.success}/{connStats.total} snapshots up · best streak {connStats.bestStreak}
              </td>
            </tr>
            {seriesStats.map(({ label, stats, format }) => (
              <tr key={label} className="border-b border-slate-200 last:border-b-0">
                <td className="py-1.5 pr-4 font-medium text-slate-700">{label}</td>
                <td className="py-1.5 px-3 text-right font-bold tabular-nums text-slate-900">
                  {stats.current != null ? format(stats.current) : "—"}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">
                  {stats.avg != null ? format(stats.avg) : "—"}
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-slate-600">
                  {stats.peak != null ? format(stats.peak) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Section 1: Capacity & Storage ─────────────────────────────── */}
      <div className="space-y-3 break-inside-avoid">
        <PrintSectionHeading>1. Capacity &amp; Storage Trend</PrintSectionHeading>
        {hasSizeData ? (
          <PrintChartFrame
            title={`Database Size Growth${sizeGrowth != null ? ` — ${sizeGrowth >= 0 ? "+" : ""}${sizeGrowth.toFixed(2)} GB over range` : ""}`}
            footnote="Metric: total_db_size_gb per snapshot"
          >
            <DbSizeTrendChart data={healthyPoints} xDomain={xDomain} range={range} fixedSize={{ width: 700, height: 230 }} />
          </PrintChartFrame>
        ) : (
          <p className="text-xs text-slate-500">No usable database size values in this timeframe.</p>
        )}
        {hasUtilData ? (
          <PrintChartFrame
            title="Tablespace & FRA Utilization"
            footnote="Thresholds — tablespace warn 85% / critical 90% · FRA warn 80% / critical 90%"
          >
            <UtilizationTrendChart data={healthyPoints} xDomain={xDomain} range={range} fixedSize={{ width: 700, height: 230 }} />
          </PrintChartFrame>
        ) : (
          <p className="text-xs text-slate-500">No usable tablespace or FRA utilization values in this timeframe.</p>
        )}
      </div>

      {/* ── Section 2: Performance & Latency ──────────────────────────── */}
      <div className="space-y-3 break-inside-avoid">
        <PrintSectionHeading>2. Performance &amp; Latency Trend</PrintSectionHeading>
        {hasPerfData ? (
          <PrintChartFrame
            title="Avg Response Time (ms) vs 1h Avg / Peak Active Sessions"
            footnote="Left axis: db_response_time_ms · Right axis: session count"
          >
            <PerfTrendChart data={healthyPoints} xDomain={xDomain} range={range} fixedSize={{ width: 700, height: 280 }} />
          </PrintChartFrame>
        ) : (
          <p className="text-xs text-slate-500">
            No usable response time or active session metrics in this timeframe.
          </p>
        )}
        {hasOsData ? (
          <PrintChartFrame
            title="CPU & OS Memory Utilization"
            footnote="Metrics: os_resources cpu_usage_pct / memory_used_pct · Includes all snapshots (host OS metrics stay valid when remote connection fails) · Thresholds — warn 80% / critical 90%"
          >
            <OsUtilizationTrendChart data={points} xDomain={osXDomain} range={range} fixedSize={{ width: 700, height: 230 }} />
          </PrintChartFrame>
        ) : (
          <p className="text-xs text-slate-500">
            No usable CPU or OS memory utilization values in this timeframe.
          </p>
        )}
      </div>

      {/* ── Section 3: Remote Connection & Availability ───────────────── */}
      <div className="space-y-3 break-inside-avoid">
        <PrintSectionHeading>3. Remote Connection &amp; Availability Trend</PrintSectionHeading>
        <div className="flex items-center gap-8 rounded-lg border border-slate-300 p-3">
          <SuccessGauge pct={connStats.rate ?? 0} />
          <div className="grid flex-1 grid-cols-[auto_1fr] gap-x-8 gap-y-1 text-xs text-slate-600">
            <span>Snapshots Tested</span>
            <span className="font-bold tabular-nums text-slate-900">{connStats.total}</span>
            <span>Successful</span>
            <span className="font-bold tabular-nums text-emerald-700">{connStats.success}</span>
            <span>Failed</span>
            <span className="font-bold tabular-nums text-red-700">{connStats.failed}</span>
            <span>Unknown</span>
            <span className="font-bold tabular-nums text-slate-900">{connStats.unknown}</span>
            <span>Success Rate</span>
            <span className="font-bold tabular-nums text-slate-900">
              {connStats.rate != null ? `${connStats.rate.toFixed(1)}%` : "—"}
            </span>
            <span>Best Success Streak</span>
            <span className="font-bold tabular-nums text-slate-900">{connStats.bestStreak}</span>
            <span>Last Failure</span>
            <span className="font-semibold text-slate-900">
              {connStats.lastFailure ? formatAppDateTime(connStats.lastFailure.timestamp) : "None in window"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-300 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Connection Status Timeline — chronological, one segment per snapshot
          </p>
          <div className="flex flex-wrap gap-[2px]">
            {points.map((p) => (
              <span
                key={p.id}
                className={cn(
                  "h-4 w-2.5 rounded-[2px]",
                  p.connStatus === "SUCCESS"
                    ? "bg-emerald-500"
                    : p.connStatus === "FAILED"
                      ? "bg-red-500"
                      : "bg-zinc-500"
                )}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-600">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-emerald-500" /> SUCCESS
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-red-500" /> FAILED
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-zinc-500" /> UNKNOWN
            </span>
            <span className="ml-auto">
              Timeframe: {rangeFilter?.label ?? range} · {points.length} snapshot
              {points.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export interface DashboardHistoricalTrendsProps {
  selectedDb: string;
  refreshKey?: number;
  lastRefreshedAt?: string | null;
}
export function DashboardHistoricalTrends({
  selectedDb,
  refreshKey,
  lastRefreshedAt
}: DashboardHistoricalTrendsProps) {
  const [range, setRange] = useState<DashboardTrendsRange>("7d");
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadTrends = useCallback(async (db: string, r: DashboardTrendsRange) => {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDashboardTrends(db, r);
      const mapped = (res.snapshots ?? [])
        .map(toTrendPoint)
        .filter((p) => Number.isFinite(p.ts))
        .sort((a, b) => a.ts - b.ts);
      setPoints(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load historical trends.");
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when selectedDb, range, internal reloadKey, or parent refreshKey/lastRefreshedAt changes
  useEffect(() => {
    loadTrends(selectedDb, range);
  }, [selectedDb, range, loadTrends, reloadKey, refreshKey, lastRefreshedAt]);

  // Listen to background refresh events and push notifications for the selected DB
  useEffect(() => {
    if (!selectedDb) return;

    const handleRefreshComplete = (e: Event) => {
      const customEv = e as CustomEvent<{ db?: string }>;
      if (customEv.detail?.db && customEv.detail.db.toUpperCase() === selectedDb.toUpperCase()) {
        void loadTrends(selectedDb, range);
      }
    };

    const handleNotification = (e: Event) => {
      const customEv = e as CustomEvent<NotificationPayload>;
      const detail = customEv.detail;
      if (!detail) return;
      const type = detail.type || (detail as unknown as Record<string, unknown>).alertType;
      const targetDb = String(detail.db || "").trim().toUpperCase();
      const currentDb = selectedDb.trim().toUpperCase();

      if (targetDb && targetDb === currentDb && type === "refresh_dashboard") {
        void loadTrends(selectedDb, range);
      }
    };

    window.addEventListener("dba-dashboard-refresh-complete", handleRefreshComplete);
    window.addEventListener("dba-notification", handleNotification);

    return () => {
      window.removeEventListener("dba-dashboard-refresh-complete", handleRefreshComplete);
      window.removeEventListener("dba-notification", handleNotification);
    };
  }, [selectedDb, range, loadTrends]);

  // Snapshots captured while the remote connection test FAILED are excluded from
  // the Capacity & Storage and Response Time / Sessions trends — the monitoring
  // queries could not reach the database, so those values are unreliable.
  // CPU & OS memory utilization (host OS metrics) and the Remote Connection
  // availability trend (Tab 3) still include every snapshot.
  const healthyPoints = useMemo(
    () => points.filter((p) => p.connStatus !== "FAILED"),
    [points]
  );
  const excludedCount = points.length - healthyPoints.length;

  const sizeStats = useMemo(() => computeSeriesStats(healthyPoints.map((p) => p.dbSizeGb)), [healthyPoints]);
  const responseStats = useMemo(() => computeSeriesStats(healthyPoints.map((p) => p.responseMs)), [healthyPoints]);
  const avgSessStats = useMemo(() => computeSeriesStats(healthyPoints.map((p) => p.avgSessions)), [healthyPoints]);
  const peakSessStats = useMemo(() => computeSeriesStats(healthyPoints.map((p) => p.peakSessions)), [healthyPoints]);
  const tbsStats = useMemo(() => computeSeriesStats(healthyPoints.map((p) => p.tbsPct)), [healthyPoints]);
  const fraStats = useMemo(() => computeSeriesStats(healthyPoints.map((p) => p.fraPct)), [healthyPoints]);
  // CPU & OS memory come from the DB host OS — valid even when remote connection failed.
  const cpuStats = useMemo(() => computeSeriesStats(points.map((p) => p.cpuPct)), [points]);
  const memStats = useMemo(() => computeSeriesStats(points.map((p) => p.memPct)), [points]);
  const connStats = useMemo(() => computeConnStats(points), [points]);

  const hasSizeData = healthyPoints.some((p) => p.dbSizeGb != null);
  const hasUtilData = healthyPoints.some((p) => p.tbsPct != null || p.fraPct != null);
  const hasPerfData = healthyPoints.some(
    (p) => p.responseMs != null || p.avgSessions != null || p.peakSessions != null
  );
  const hasOsData = points.some((p) => p.cpuPct != null || p.memPct != null);

  const latestTbsName = useMemo(() => {
    for (let i = healthyPoints.length - 1; i >= 0; i--) {
      if (healthyPoints[i].tbsPct != null) return healthyPoints[i].tbsName || undefined;
    }
    return undefined;
  }, [healthyPoints]);

  const sizeGrowth = useMemo(() => {
    const vals = healthyPoints.map((p) => p.dbSizeGb).filter((v): v is number => v != null);
    if (vals.length < 2) return null;
    return vals[vals.length - 1] - vals[0];
  }, [healthyPoints]);

  const xDomain = useMemo((): [number, number] => {
    if (healthyPoints.length === 0) {
      const now = Date.now();
      return [now - 3600_000, now];
    }
    const min = healthyPoints[0].ts;
    const max = healthyPoints[healthyPoints.length - 1].ts;
    const pad = Math.max((max - min) * 0.02, 60_000);
    return [min - pad, max + pad];
  }, [healthyPoints]);

  // Full-timeline X-axis domain — used by the CPU / OS memory chart which
  // includes FAILED-connection snapshots.
  const osXDomain = useMemo((): [number, number] => {
    if (points.length === 0) {
      const now = Date.now();
      return [now - 3600_000, now];
    }
    const min = points[0].ts;
    const max = points[points.length - 1].ts;
    const pad = Math.max((max - min) * 0.02, 60_000);
    return [min - pad, max + pad];
  }, [points]);

  const hasEnoughData = points.length >= 2;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <Card id="historical-trends" className="scroll-mt-24">
      <CardHeader className="pb-3 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-lg border border-purple-400/20 bg-purple-400/10 p-2.5">
              <TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-300" />
            </div>
            <div className="min-w-0">
              <CardTitle>Historical Performance &amp; Capacity Trends</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Time-series analysis across{" "}
                <span className="font-semibold tabular-nums text-foreground">{points.length}</span>{" "}
                snapshot{points.length === 1 ? "" : "s"} for{" "}
                <span className="font-mono font-semibold text-cyan-700 dark:text-cyan-300">
                  {selectedDb}
                </span>
                {hasEnoughData && first && last && (
                  <>
                    {" · "}
                    {formatAppDateTime(first.timestamp)} → {formatAppDateTime(last.timestamp)}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {loading && points.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-600 dark:text-cyan-400 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                Updating trends…
              </span>
            )}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-secondary/40 p-1">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRange(opt.value)}
                  title={opt.title}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                    range === opt.value
                      ? "bg-cyan-500/15 text-cyan-700 shadow-sm dark:text-cyan-300"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 gap-0 p-0"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              title="Reload trend data"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-secondary/20 py-16 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-500" />
            <p className="text-sm font-semibold text-foreground">Analyzing snapshot history…</p>
            <p className="text-xs text-muted-foreground">
              Loading {selectedDb} snapshots for the selected timeframe.
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
            <p className="text-sm font-semibold text-red-600 dark:text-red-300">
              Failed to load historical trends
            </p>
            <p className="mt-1 text-xs text-red-600/80 dark:text-red-300/80">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : !hasEnoughData ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-secondary/20 py-14 text-center">
            <div className="mb-4 rounded-full border border-purple-400/30 bg-purple-400/10 p-4">
              <TrendingUp className="h-8 w-8 text-purple-600 dark:text-purple-300" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Not Enough Snapshot History</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {points.length === 0
                ? "No snapshots were captured in this timeframe."
                : "Only one snapshot exists in this timeframe."}{" "}
              At least 2 snapshots are needed to plot trends.{" "}
              {range !== "all" && "Try widening the timeframe to “All Snapshots”. "}
              New snapshots are captured via Refresh or the server-side schedule.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {range !== "all" && (
                <Button size="sm" variant="outline" onClick={() => setRange("all")}>
                  View All Snapshots
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reload
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Summary KPI badges (screen — print uses summary table) ── */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 print:hidden">
              <ConnectionKpiCard stats={connStats} />
              <TrendKpiCard
                icon={Database}
                label="Database Size"
                stats={sizeStats}
                format={fmtGb}
                direction="neutral"
                iconClass="text-cyan-600 dark:text-cyan-400"
              />
              <TrendKpiCard
                icon={Clock}
                label="Avg Response Time"
                stats={responseStats}
                format={fmtMs}
                direction="lower-is-better"
                iconClass="text-purple-600 dark:text-purple-400"
              />
              <TrendKpiCard
                icon={Users}
                label="Avg Active Sessions (1h)"
                stats={avgSessStats}
                format={fmtCount}
                direction="neutral"
                iconClass="text-emerald-600 dark:text-emerald-400"
              />
              <TrendKpiCard
                icon={Zap}
                label="Peak Active Sessions (1h)"
                stats={peakSessStats}
                format={fmtCount}
                direction="neutral"
                iconClass="text-amber-600 dark:text-amber-400"
              />
              <TrendKpiCard
                icon={HardDrive}
                label="Max Tablespace Util"
                stats={tbsStats}
                format={fmtPct}
                direction="lower-is-better"
                iconClass="text-emerald-600 dark:text-emerald-400"
                sublabel={latestTbsName ? `top: ${latestTbsName}` : undefined}
              />
              <TrendKpiCard
                icon={Cpu}
                label="CPU Utilization"
                stats={cpuStats}
                format={fmtPct}
                direction="lower-is-better"
                iconClass="text-orange-600 dark:text-orange-400"
              />
              <TrendKpiCard
                icon={MemoryStick}
                label="OS Memory Utilization"
                stats={memStats}
                format={fmtPct}
                direction="lower-is-better"
                iconClass="text-blue-600 dark:text-blue-400"
              />
            </div>

            {excludedCount > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 print:hidden">
                <Info className="mt-px h-3 w-3 shrink-0" />
                <span>
                  <span className="font-semibold tabular-nums">{excludedCount}</span> snapshot
                  {excludedCount === 1 ? "" : "s"} with a FAILED remote connection
                  {excludedCount === 1 ? " is" : "s are"} excluded from the Capacity &amp; Storage and
                  Response Time / Sessions trends — CPU &amp; OS Memory Utilization and Database
                  Availability still include every snapshot.
                </span>
              </p>
            )}

            {/* ── Trend tabs (screen only — print uses TrendsPrintReport) ── */}
            <Tabs defaultValue="capacity" className="w-full print:hidden">
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
                <TabsTrigger value="capacity" className="gap-1.5 text-xs">
                  <HardDrive className="h-3.5 w-3.5" />
                  Capacity &amp; Storage
                </TabsTrigger>
                <TabsTrigger value="performance" className="gap-1.5 text-xs">
                  <Activity className="h-3.5 w-3.5" />
                  Performance &amp; Latency
                </TabsTrigger>
                <TabsTrigger value="connection" className="gap-1.5 text-xs">
                  <PlugZap className="h-3.5 w-3.5" />
                  Remote Connection
                </TabsTrigger>
              </TabsList>

              {/* ── TAB 1: Capacity & Storage ───────────────────────── */}
              <TabsContent value="capacity" className="mt-3 space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <ChartCard
                    title="Database Size Growth"
                    subtitle="total_db_size_gb per snapshot"
                    badge={
                      sizeGrowth != null && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                            sizeGrowth >= 0
                              ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          )}
                        >
                          {sizeGrowth >= 0 ? "+" : ""}
                          {sizeGrowth.toFixed(2)} GB over range
                        </span>
                      )
                    }
                  >
                    {hasSizeData ? (
                      <div className="h-[240px]">
                        <DbSizeTrendChart data={healthyPoints} xDomain={xDomain} range={range} />
                      </div>
                    ) : (
                      <ChartNoData message="No usable total_db_size_gb values in this timeframe. Snapshots with a FAILED remote connection are excluded from capacity trends." />
                    )}
                  </ChartCard>

                  <ChartCard
                    title="Tablespace & FRA Utilization"
                    subtitle="Max tablespace % and FRA % with warning / critical thresholds"
                  >
                    {hasUtilData ? (
                      <div className="h-[240px]">
                        <UtilizationTrendChart data={healthyPoints} xDomain={xDomain} range={range} />
                      </div>
                    ) : (
                      <ChartNoData message="No usable tablespace or FRA utilization values in this timeframe. Snapshots with a FAILED remote connection are excluded from capacity trends." />
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Thresholds — tablespace warn 85% / critical 90% · FRA warn 80% / critical 90%
                    </p>
                  </ChartCard>
                </div>
              </TabsContent>

              {/* ── TAB 2: Performance & Latency ─────────────────────── */}
              <TabsContent value="performance" className="mt-3 space-y-4">
                <ChartCard
                  title="Response Time & Active Sessions"
                  subtitle="db_response_time_ms (left axis) overlaid with 1h avg / peak active sessions (right axis)"
                >
                  {hasPerfData ? (
                    <div className="h-[280px]">
                      <PerfTrendChart data={healthyPoints} xDomain={xDomain} range={range} />
                    </div>
                  ) : (
                    <ChartNoData message="No usable response time or active session metrics in this timeframe. Snapshots with a FAILED remote connection are excluded from performance trends." />
                  )}
                </ChartCard>

                <ChartCard
                  title="CPU & OS Memory Utilization"
                  subtitle="os_resources cpu_usage_pct and memory_used_pct with warning / critical thresholds (includes all snapshots — host OS metrics stay valid when remote connection fails)"
                >
                  {hasOsData ? (
                    <div className="h-[240px]">
                      <OsUtilizationTrendChart data={points} xDomain={osXDomain} range={range} />
                    </div>
                  ) : (
                    <ChartNoData message="No CPU or OS memory utilization values were captured in this timeframe." />
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Thresholds — CPU &amp; OS memory warn 80% / critical 90%
                  </p>
                </ChartCard>
              </TabsContent>

              {/* ── TAB 3: Remote Connection & Availability ──────────── */}
              <TabsContent value="connection" className="mt-3 space-y-4">
                <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
                  <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border/60 bg-secondary/20 p-4">
                    <SuccessGauge pct={connStats.rate ?? 0} />
                    <div className="grid w-full grid-cols-3 gap-1 text-center">
                      <div className="rounded-lg border border-border/60 p-1.5">
                        <p className="text-sm font-bold tabular-nums text-foreground">{connStats.total}</p>
                        <p className="text-[10px] text-muted-foreground">Snapshots</p>
                      </div>
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-1.5">
                        <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                          {connStats.success}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Success</p>
                      </div>
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-1.5">
                        <p className="text-sm font-bold tabular-nums text-red-600 dark:text-red-300">
                          {connStats.failed}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Failed</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 p-3 sm:p-4">
                    <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">Connection Status Timeline</h4>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          One segment per snapshot — hover a segment for capture details
                        </p>
                      </div>
                      {connStats.bestStreak > 0 && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                          Best streak: {connStats.bestStreak}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex gap-px overflow-x-auto pb-1">
                      {points.map((p) => (
                        <span
                          key={p.id}
                          title={`${formatAppDateTime(p.timestamp)} — ${p.connStatus}${
                            p.refreshedBy ? ` (by ${p.refreshedBy})` : ""
                          }`}
                          className={cn(
                            "h-7 min-w-[6px] flex-1 cursor-default rounded-sm transition-colors",
                            p.connStatus === "SUCCESS"
                              ? "bg-emerald-500/70 hover:bg-emerald-400"
                              : p.connStatus === "FAILED"
                                ? "bg-red-500/70 hover:bg-red-400"
                                : "bg-slate-500/50 hover:bg-slate-400"
                          )}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" /> SUCCESS
                      </span>
                      <span className="flex items-center gap-1.5">
                        <XCircle className="h-3 w-3 text-red-500" /> FAILED
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-slate-500/50" /> UNKNOWN
                      </span>
                      <span className="ml-auto">
                        {connStats.lastFailure
                          ? `Last failure: ${formatAppDateTime(connStats.lastFailure.timestamp)}`
                          : "No connection failures recorded in this window"}
                      </span>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* ── Print/PDF report — all 3 sections with the filtered timeline ── */}
            <TrendsPrintReport
              selectedDb={selectedDb}
              rangeLabel={RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range}
              range={range}
              points={points}
              healthyPoints={healthyPoints}
              excludedCount={excludedCount}
              xDomain={xDomain}
              osXDomain={osXDomain}
              sizeGrowth={sizeGrowth}
              hasSizeData={hasSizeData}
              hasUtilData={hasUtilData}
              hasPerfData={hasPerfData}
              hasOsData={hasOsData}
              connStats={connStats}
              seriesStats={[
                { label: "Database Size (GB)", stats: sizeStats, format: fmtGb },
                { label: "Avg Response Time (ms)", stats: responseStats, format: fmtMs },
                { label: "Avg Active Sessions (1h)", stats: avgSessStats, format: fmtCount },
                { label: "Peak Active Sessions (1h)", stats: peakSessStats, format: fmtCount },
                { label: "Max Tablespace Utilization (%)", stats: tbsStats, format: fmtPct },
                { label: "FRA Utilization (%)", stats: fraStats, format: fmtPct },
                { label: "CPU Utilization (%)", stats: cpuStats, format: fmtPct },
                { label: "OS Memory Utilization (%)", stats: memStats, format: fmtPct }
              ]}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
