"use client";

import { useEffect, useState, type ElementType, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, Database, Info, RefreshCw, XCircle } from "lucide-react";
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
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { fmtMb, pctColor, pctStroke, safeNum } from "@/components/dashboard/dashboard-utils";
import { cn } from "@/lib/utils";
import type { DashboardArchiveLogMonthRow, DashboardTablespaceRow } from "@/types/dba";

// ─── Section navigation ──────────────────────────────────────────────────────

export interface DashboardSectionDef {
  id: string;
  label: string;
  icon: ElementType;
}

export function scrollToDashboardSection(sectionId: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  const header = document.querySelector("header");
  const offset = (header?.offsetHeight ?? 96) + 16;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

export function DashboardSectionNav({ sections }: { sections: DashboardSectionDef[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const update = () => setHeaderHeight(header.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      className="sticky z-20 flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-background/80 p-1.5 shadow-sm backdrop-blur-md print:hidden"
      style={headerHeight != null ? { top: `${headerHeight + 4}px` } : undefined}
    >
      {sections.map((section) => {
        const Icon = section.icon;
        const isActive = active === section.id;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => scrollToDashboardSection(section.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
              isActive
                ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
            aria-current={isActive ? "location" : undefined}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {section.label}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────

export function SectionHeading({
  icon: Icon,
  title,
  description,
  accentClass,
  badge
}: {
  icon: ElementType;
  title: string;
  description?: string;
  accentClass?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 pb-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", accentClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold tracking-wide text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {badge && <div className="print:hidden">{badge}</div>}
    </div>
  );
}

// ─── Status / KPI widgets ────────────────────────────────────────────────────

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-red-400/30 bg-red-500/10 text-red-300"}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function getKpiValueFontSize(val: string | number) {
  const str = String(val ?? "").trim();
  const len = str.length;
  if (len >= 18) return "text-sm sm:text-base";
  if (len >= 14) return "text-base sm:text-lg";
  if (len >= 11) return "text-lg sm:text-xl";
  if (len >= 9) return "text-xl sm:text-2xl";
  return "text-2xl";
}

export function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  variant = "neutral",
  onClick,
  tooltip,
  tooltipTitle
}: {
  icon: ElementType;
  label: string;
  value: string | number;
  sub?: string;
  variant?: "neutral" | "healthy" | "warning" | "critical";
  onClick?: () => void;
  tooltip?: string;
  tooltipTitle?: string;
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
        <div className="flex items-center gap-1.5">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          {tooltip && (
            <UiTooltip>
              <TooltipTrigger asChild>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
                  className="inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground/60 hover:text-cyan-400 hover:bg-cyan-500/10 focus:outline-none focus:ring-1 focus:ring-cyan-400/50 transition-colors cursor-help shrink-0"
                  aria-label={`Info about ${tooltipTitle || label}`}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                sideOffset={6}
                className="max-w-xs sm:max-w-sm p-3.5 space-y-1.5 rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-2xl backdrop-blur-md dark:bg-slate-900/95 dark:border-slate-700/80 z-50 pointer-events-auto"
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground dark:text-slate-100">
                  <Icon className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400 shrink-0" />
                  <span>{tooltipTitle || label}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground dark:text-slate-300 font-normal">
                  {tooltip}
                </p>
              </TooltipContent>
            </UiTooltip>
          )}
        </div>
        <p className={cn("font-bold tabular-nums leading-tight whitespace-nowrap", getKpiValueFontSize(value), s.text)}>{value}</p>
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
        className={`group relative flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-current/30 hover:bg-current/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:ring-offset-2 focus:ring-offset-background ${s.bg}`}
        aria-label={`Go to ${label}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`group relative flex items-center gap-3 rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-current/30 ${s.bg}`}>
      {content}
    </div>
  );
}

// ─── Health banner card ──────────────────────────────────────────────────────

const HEALTH_ICON_ACCENTS: Record<string, string> = {
  cyan:    "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
  blue:    "border-blue-400/20 bg-blue-400/10 text-blue-300",
  emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  purple:  "border-purple-400/20 bg-purple-400/10 text-purple-300"
};

const HEALTH_STATUS_BARS: Record<string, string> = {
  ok:      "from-emerald-500/70",
  warn:    "from-amber-500/70",
  fail:    "from-red-500/70",
  neutral: "from-slate-400/50"
};

export function HealthStatusCard({
  icon: Icon,
  accent = "cyan",
  status = "neutral",
  label,
  value,
  valueClass,
  sub,
  pill,
  footer
}: {
  icon: ElementType;
  accent?: "cyan" | "blue" | "emerald" | "purple";
  status?: "ok" | "warn" | "fail" | "neutral";
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  pill?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-card p-4">
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r to-transparent", HEALTH_STATUS_BARS[status])}
      />
      <div className={cn("shrink-0 rounded-lg border p-2.5", HEALTH_ICON_ACCENTS[accent] ?? HEALTH_ICON_ACCENTS.cyan)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm font-bold text-slate-200", valueClass)}>{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {pill && <div className="ml-auto shrink-0">{pill}</div>}
      {footer && <div className="ml-auto shrink-0">{footer}</div>}
    </div>
  );
}

// ─── Gauges ──────────────────────────────────────────────────────────────────

export function RadialGauge({ pct, centerLabel }: { pct: number; centerLabel: string }) {
  const safePct = Math.min(100, Math.max(0, safeNum(pct)));
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(142,163,184,0.12)" strokeWidth="12" />
        <circle
          cx="60" cy="60" r="48" fill="none"
          stroke={pctStroke(safePct)}
          strokeWidth="12"
          strokeDasharray={`${safePct * 3.016} 301.6`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold tabular-nums ${pctColor(safePct)}`}>{safePct.toFixed(1)}%</span>
        <span className="text-[10px] text-muted-foreground">{centerLabel}</span>
      </div>
    </div>
  );
}

export function LinearGauge({ label, value, max, unit = "%", color }: { label: string; value: number; max?: number; unit?: string; color: string }) {
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

// ─── Charts ──────────────────────────────────────────────────────────────────

export function BackupStatusBadge({ status }: { status?: string | null }) {
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

export function TablespaceBarChart({ rows }: { rows: DashboardTablespaceRow[] }) {
  const data = rows.map((r) => ({
    name: r.tablespace_name,
    used: safeNum(r.used_mb),
    free: safeNum(r.free_mb),
    pct:  safeNum(r.pct_used)
  }));

  return (
    <div className="h-[220px]">
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

export function ArchiveLogChart({ rows }: { rows: DashboardArchiveLogMonthRow[] }) {
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

export function FraDonut({ pct, usedGb, sizeGb }: { pct: number; usedGb: number; sizeGb: number }) {
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

// ─── Empty states ────────────────────────────────────────────────────────────

export function EmptyState({
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

export function NoDatabasesState() {
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
