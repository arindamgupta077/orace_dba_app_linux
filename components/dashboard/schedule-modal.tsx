"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Info,
  Layers,
  Loader2,
  Pause,
  Play,
  Search,
  Sparkles,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, formatAppDateTime } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DashboardSchedule {
  id: number;
  db_name: string;
  interval_min: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_status: string;
}

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  selectedDb: string;
}

// ─── Interval options ─────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
  { label: "1 min",   value: 1   },
  { label: "5 min",   value: 5   },
  { label: "15 min",  value: 15  },
  { label: "30 min",  value: 30  },
  { label: "1 hour",  value: 60  },
  { label: "2 hours", value: 120 },
  { label: "4 hours", value: 240 },
  { label: "6 hours", value: 360 },
  { label: "12 hours",value: 720 },
  { label: "24 hours",value: 1440},
];

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiListSchedules(): Promise<DashboardSchedule[]> {
  const res = await fetch("/api/dashboard/schedules");
  if (!res.ok) throw new Error("Failed to load schedules");
  const data = (await res.json()) as { schedules: DashboardSchedule[] };
  return data.schedules;
}

async function apiSaveSchedule(db_name: string, interval_min: number): Promise<DashboardSchedule> {
  const res = await fetch("/api/dashboard/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ db_name, interval_min }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "Failed to save schedule");
  }
  const data = (await res.json()) as { schedule: DashboardSchedule };
  return data.schedule;
}

async function apiDeleteSchedule(id: number): Promise<void> {
  const res = await fetch(`/api/dashboard/schedules/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "Failed to delete schedule");
  }
}

async function apiToggleSchedule(id: number, is_active: boolean): Promise<void> {
  const res = await fetch(`/api/dashboard/schedules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "Failed to update schedule");
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "success")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3 w-3 shrink-0" /> success
      </span>
    );
  if (s === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300 whitespace-nowrap shrink-0">
        <X className="h-3 w-3 shrink-0" /> error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0">
      <Clock className="h-3 w-3 shrink-0" /> {status || "pending"}
    </span>
  );
}

function formatDateTimeParts(value: string | number | Date | null | undefined): { date: string; time: string } | null {
  if (!value) return null;
  const str = formatAppDateTime(value);
  if (str === "—" || !str) return null;
  const parts = str.split(", ");
  if (parts.length >= 2) {
    return { date: parts[0], time: parts.slice(1).join(", ") };
  }
  return { date: str, time: "" };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScheduleModal({ open, onClose, selectedDb }: ScheduleModalProps) {
  const [schedules, setSchedules]               = useState<DashboardSchedule[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [saving, setSaving]                     = useState(false);
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);
  const [error, setError]                       = useState<string | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<number | null>(null);
  const [viewFilter, setViewFilter]             = useState<"current" | "all">("current");
  const [searchQuery, setSearchQuery]           = useState("");

  const existingForDb = schedules.find(
    (s) => s.db_name.toLowerCase() === selectedDb.toLowerCase()
  );

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiListSchedules();
      setSchedules(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setViewFilter("current");
      setSearchQuery("");
      loadSchedules();
    }
  }, [open, loadSchedules]);

  // Pre-select existing interval when modal opens or DB changes
  useEffect(() => {
    if (existingForDb) {
      setSelectedInterval(existingForDb.interval_min);
    } else {
      setSelectedInterval(null);
    }
  }, [existingForDb]);

  async function handleSave() {
    if (!selectedInterval) return;
    setSaving(true);
    setError(null);
    try {
      await apiSaveSchedule(selectedDb, selectedInterval);
      await loadSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setActionInProgressId(id);
    setError(null);
    try {
      await apiDeleteSchedule(id);
      await loadSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setActionInProgressId(null);
    }
  }

  async function handleToggle(id: number, currentlyActive: boolean) {
    setActionInProgressId(id);
    setError(null);
    try {
      await apiToggleSchedule(id, !currentlyActive);
      await loadSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setActionInProgressId(null);
    }
  }

  const currentDbSchedules = useMemo(
    () => schedules.filter((s) => s.db_name.toLowerCase() === selectedDb.toLowerCase()),
    [schedules, selectedDb]
  );

  const filteredSchedules = useMemo(() => {
    const base = viewFilter === "current" ? currentDbSchedules : schedules;
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase().trim();
    return base.filter(
      (s) =>
        s.db_name.toLowerCase().includes(q) ||
        (s.created_by && s.created_by.toLowerCase().includes(q)) ||
        (s.last_status && s.last_status.toLowerCase().includes(q))
    );
  }, [viewFilter, currentDbSchedules, schedules, searchQuery]);

  const selectedIntervalObj = INTERVAL_OPTIONS.find((o) => o.value === selectedInterval);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden border-border/80 bg-background text-foreground shadow-2xl rounded-2xl">
        {/* ── Modal Header ── */}
        <div className="relative border-b border-border/60 bg-gradient-to-r from-secondary/40 via-background to-secondary/20 p-5 sm:p-6">
          <DialogHeader className="space-y-1.5 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/20 to-teal-500/10 text-cyan-600 dark:text-cyan-300 shadow-sm">
                  <Calendar className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    Server-Side Auto-Refresh Schedule
                  </DialogTitle>
                  <DialogDescription className="text-xs sm:text-[13px] text-muted-foreground mt-0.5">
                    Runs continuously even when the browser is closed.
                  </DialogDescription>
                </div>
              </div>

              {/* Status Badge in Header */}
              {existingForDb && (
                <div className="hidden sm:flex items-center shrink-0">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-xs whitespace-nowrap shrink-0",
                      existingForDb.is_active
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        existingForDb.is_active
                          ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                          : "bg-amber-500"
                      )}
                    />
                    <span>{existingForDb.is_active ? "Active" : "Paused"}</span>
                    <span className="opacity-70 whitespace-nowrap">
                      · {existingForDb.interval_min < 60 ? `${existingForDb.interval_min}m` : `${existingForDb.interval_min / 60}h`}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </DialogHeader>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* ── Error Banner ── */}
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in zoom-in-95">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              <p className="flex-1 font-medium">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded p-1 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* ── Target Database Schedule Configurator Card ── */}
          <div className="relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-secondary/40 via-secondary/20 to-background p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                  <Database className="h-4 w-4" />
                </span>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Target Database:
                </span>
                <span className="font-mono text-sm font-bold text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-0.5 rounded-md">
                  {selectedDb}
                </span>
              </div>

              {existingForDb ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap shrink-0",
                    existingForDb.is_active
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", existingForDb.is_active ? "bg-emerald-500" : "bg-amber-500")} />
                  <span>{existingForDb.is_active ? "SCHEDULE ACTIVE" : "SCHEDULE PAUSED"}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/30 bg-slate-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground whitespace-nowrap shrink-0">
                  NOT SCHEDULED
                </span>
              )}
            </div>

            {/* Interval Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                  Select Refresh Frequency:
                </span>
                <span className={cn("font-semibold", selectedIntervalObj ? "text-cyan-600 dark:text-cyan-300" : "text-muted-foreground italic")}>
                  {selectedIntervalObj ? `Every ${selectedIntervalObj.label}` : "None selected"}
                </span>
              </div>

              <div className="grid grid-cols-5 sm:grid-cols-5 gap-1.5">
                {INTERVAL_OPTIONS.map((opt) => {
                  const isSelected = selectedInterval === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSelectedInterval(opt.value)}
                      className={cn(
                        "relative flex items-center justify-center gap-1 rounded-lg border py-2 text-xs font-semibold transition-all duration-150 active:scale-[0.98]",
                        isSelected
                          ? "border-cyan-500 bg-cyan-600 text-white shadow-sm shadow-cyan-500/30 dark:bg-cyan-600 font-bold"
                          : "border-border/60 bg-card hover:border-cyan-500/40 hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-white shrink-0 -ml-0.5" />}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action CTA Button */}
            <Button
              onClick={handleSave}
              disabled={saving || loading || !selectedInterval}
              className={cn(
                "w-full gap-2 text-sm font-semibold shadow-md transition-all duration-200 active:scale-[0.99]",
                "bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white shadow-cyan-500/10",
                (!selectedInterval || saving || loading) && "opacity-60 cursor-not-allowed"
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving Schedule Configuration…
                </>
              ) : !selectedInterval ? (
                <>
                  <Sparkles className="h-4 w-4 text-cyan-200" />
                  Select a Frequency to Enable Schedule
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-cyan-200" />
                  {existingForDb
                    ? `Update Schedule to Every ${selectedIntervalObj?.label ?? `${selectedInterval}m`}`
                    : `Enable Auto-Refresh Schedule (Every ${selectedIntervalObj?.label ?? `${selectedInterval}m`})`}
                </>
              )}
            </Button>

            {/* Metrics Telemetry Grid (if configured) */}
            {existingForDb && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-border/50">
                <div className="rounded-lg border border-border/50 bg-background/80 p-2.5 flex flex-col justify-between min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last Run</p>
                  {existingForDb.last_run_at ? (
                    (() => {
                      const dt = formatDateTimeParts(existingForDb.last_run_at);
                      return dt ? (
                        <div className="font-mono mt-0.5 leading-tight">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{dt.date}</p>
                          <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-0.5">{dt.time}</p>
                        </div>
                      ) : (
                        <p className="font-mono text-xs font-medium text-muted-foreground mt-0.5">—</p>
                      );
                    })()
                  ) : (
                    <p className="font-mono text-xs font-medium text-muted-foreground mt-0.5">Never</p>
                  )}
                </div>

                <div className="rounded-lg border border-border/50 bg-background/80 p-2.5 flex flex-col justify-between min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Next Scheduled</p>
                  {existingForDb.is_active && existingForDb.next_run_at ? (
                    (() => {
                      const dt = formatDateTimeParts(existingForDb.next_run_at);
                      return dt ? (
                        <div className="font-mono mt-0.5 leading-tight">
                          <p className="text-xs font-bold text-cyan-600 dark:text-cyan-300">{dt.date}</p>
                          <p className="text-[11px] font-semibold text-cyan-700/90 dark:text-cyan-400 mt-0.5">{dt.time}</p>
                        </div>
                      ) : (
                        <p className="font-mono text-xs font-medium text-muted-foreground mt-0.5">—</p>
                      );
                    })()
                  ) : (
                    <p className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5">Paused</p>
                  )}
                </div>

                <div className="rounded-lg border border-border/50 bg-background/80 p-2.5 flex flex-col justify-between min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Runs</p>
                  <div className="mt-0.5">
                    <p className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                      {existingForDb.run_count}
                    </p>
                    <p className="text-[10px] text-muted-foreground">executions</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 bg-background/80 p-2.5 flex flex-col justify-between min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Health Status</p>
                  <div className="mt-1">
                    <StatusBadge status={existingForDb.last_status} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Configured Schedules List Section ── */}
          <div className="space-y-3 pt-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  {viewFilter === "current" ? "Active Schedule for Current Target" : "All Configured Database Schedules"}
                </h3>
                <span className="rounded-full bg-secondary px-2 py-0.2 font-mono text-[11px] font-bold text-muted-foreground">
                  {viewFilter === "current" ? currentDbSchedules.length : schedules.length}
                </span>
              </div>

              {/* Segmented Filter Control */}
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-border/70 bg-secondary/40 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewFilter("current")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150",
                      viewFilter === "current"
                        ? "bg-cyan-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    )}
                    title={`View schedule for ${selectedDb}`}
                  >
                    <Database className="h-3.5 w-3.5" />
                    <span>Current DB</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.2 text-[10px] font-bold",
                        viewFilter === "current" ? "bg-white/20 text-white" : "bg-background/80 text-muted-foreground"
                      )}
                    >
                      {currentDbSchedules.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setViewFilter("all")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150",
                      viewFilter === "all"
                        ? "bg-cyan-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    )}
                    title="View all database schedules"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>All Databases</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.2 text-[10px] font-bold",
                        viewFilter === "all" ? "bg-white/20 text-white" : "bg-background/80 text-muted-foreground"
                      )}
                    >
                      {schedules.length}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Optional Search Toolbar when in All Databases mode */}
            {viewFilter === "all" && schedules.length > 2 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter schedules by database name, user, or status..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 text-xs h-8 bg-secondary/20 border-border/60"
                />
              </div>
            )}

            {/* List Content */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2.5 rounded-xl border border-dashed border-border/60 bg-secondary/10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-600 dark:text-cyan-400" />
                <p className="text-xs font-medium">Loading database schedules…</p>
              </div>
            ) : filteredSchedules.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-secondary/10 p-7 text-center space-y-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-secondary/30 text-muted-foreground">
                  <Calendar className="h-5 w-5 opacity-60" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {viewFilter === "current"
                      ? `No schedule configured for ${selectedDb}`
                      : searchQuery
                      ? "No schedules match your search"
                      : "No scheduled databases found"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                    {viewFilter === "current"
                      ? "Select a frequency above and click Enable Auto-Refresh Schedule to start background data collection."
                      : "Create a schedule using the configuration form above."}
                  </p>
                </div>
                {viewFilter === "current" && schedules.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewFilter("all")}
                    className="mt-2 text-xs gap-1.5 border-border hover:border-cyan-500/50"
                  >
                    <Layers className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                    View All Configured Databases ({schedules.length})
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {filteredSchedules.map((s) => {
                  const isCurrentDb = s.db_name.toLowerCase() === selectedDb.toLowerCase();
                  const isActionBusy = actionInProgressId === s.id;

                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl border p-3 transition-all duration-200 hover:shadow-xs",
                        isCurrentDb
                          ? "border-cyan-500/40 bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent dark:from-cyan-950/40 dark:via-cyan-950/20"
                          : "border-border/60 bg-card hover:border-border hover:bg-secondary/20"
                      )}
                    >
                      {/* Active / Paused Indicator Dot */}
                      <div className="flex flex-col items-center justify-center pl-0.5">
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full transition-all",
                            s.is_active
                              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                              : "bg-slate-400 dark:bg-slate-600"
                          )}
                          title={s.is_active ? "Schedule Active" : "Schedule Paused"}
                        />
                      </div>

                      {/* Main Info */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                            {s.db_name}
                          </span>

                          {isCurrentDb && (
                            <span className="rounded bg-cyan-500/20 px-1.5 py-0.2 font-mono text-[9px] font-extrabold text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                              CURRENT
                            </span>
                          )}

                          <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                            <Clock className="h-2.5 w-2.5" />
                            every {s.interval_min < 60 ? `${s.interval_min}m` : `${s.interval_min / 60}h`}
                          </span>

                          <StatusBadge status={s.last_status} />
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            Last run:{" "}
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {s.last_run_at ? formatAppDateTime(s.last_run_at) : "Never"}
                            </span>
                          </span>
                          {s.next_run_at && s.is_active && (
                            <span>
                              Next:{" "}
                              <span className="font-medium text-cyan-600 dark:text-cyan-400">
                                {formatAppDateTime(s.next_run_at)}
                              </span>
                            </span>
                          )}
                          <span className="opacity-80">· {s.run_count} runs</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isActionBusy}
                          onClick={() => handleToggle(s.id, s.is_active)}
                          title={s.is_active ? "Pause scheduled refresh" : "Resume scheduled refresh"}
                          className={cn(
                            "h-8 w-8 rounded-lg border border-border/50 bg-secondary/30 transition-colors",
                            s.is_active
                              ? "hover:border-amber-500/40 hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-400"
                              : "hover:border-emerald-500/40 hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400"
                          )}
                        >
                          {isActionBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : s.is_active ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isActionBusy}
                          onClick={() => handleDelete(s.id)}
                          title="Remove schedule"
                          className="h-8 w-8 rounded-lg border border-border/50 bg-secondary/30 text-muted-foreground hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer Information Banner ── */}
        <div className="border-t border-border/60 bg-secondary/30 p-3.5 sm:px-6">
          <div className="flex items-start gap-2.5 text-[11px] text-muted-foreground leading-relaxed">
            <Info className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400 mt-0.5" />
            <p>
              Schedules are orchestrated by the Next.js server scheduler. Changes sync immediately.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
