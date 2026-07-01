"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAppDateTime } from "@/lib/utils";

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
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> success
      </span>
    );
  if (s === "error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
        <X className="h-3 w-3" /> error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/20 bg-slate-400/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
      <Clock className="h-3 w-3" /> {status}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScheduleModal({ open, onClose, selectedDb }: ScheduleModalProps) {
  const [schedules, setSchedules]       = useState<DashboardSchedule[]>([]);
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [selectedInterval, setSelectedInterval] = useState(15);

  const existingForDb = schedules.find((s) => s.db_name === selectedDb);

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
    if (open) loadSchedules();
  }, [open, loadSchedules]);

  // Pre-select existing interval when modal opens
  useEffect(() => {
    if (existingForDb) setSelectedInterval(existingForDb.interval_min);
  }, [existingForDb]);

  async function handleSave() {
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
    setError(null);
    try {
      await apiDeleteSchedule(id);
      await loadSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleToggle(id: number, currentlyActive: boolean) {
    setError(null);
    try {
      await apiToggleSchedule(id, !currentlyActive);
      await loadSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg border-border/60 bg-popover text-popover-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-cyan-300" />
            Server-Side Auto-Refresh Schedule
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Set a persistent schedule to automatically refresh the dashboard and send the
          <span className="mx-1 font-mono text-cyan-300">refresh_dashboard</span>
          action to n8n — even when the browser is closed. The Next.js server runs the
          scheduler independently of any active user session.
        </p>

        {/* ── Schedule for current DB ── */}
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">
              Schedule for{" "}
              <span className="font-mono text-cyan-300">{selectedDb}</span>
            </span>
            {existingForDb && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  existingForDb.is_active
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                }`}
              >
                {existingForDb.is_active ? "ACTIVE" : "PAUSED"}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Refresh interval</p>
            <div className="flex flex-wrap gap-1.5">
              {INTERVAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedInterval(opt.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    selectedInterval === opt.value
                      ? "border-cyan-500/60 bg-cyan-600/20 text-cyan-300"
                      : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-border hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="w-full gap-2 bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calendar className="h-4 w-4" />
            )}
            {saving
              ? "Saving…"
              : existingForDb
              ? `Update to every ${INTERVAL_OPTIONS.find((o) => o.value === selectedInterval)?.label ?? `${selectedInterval}m`}`
              : `Schedule every ${INTERVAL_OPTIONS.find((o) => o.value === selectedInterval)?.label ?? `${selectedInterval}m`}`}
          </Button>

          {existingForDb && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/40 bg-secondary/30 p-3 text-xs">
              <span className="text-muted-foreground">Last run</span>
              <span className="font-medium text-slate-300 text-right">
                {existingForDb.last_run_at ? formatAppDateTime(existingForDb.last_run_at) : "—"}
              </span>
              <span className="text-muted-foreground">Next run</span>
              <span className="font-medium text-slate-300 text-right">
                {existingForDb.next_run_at ? formatAppDateTime(existingForDb.next_run_at) : "—"}
              </span>
              <span className="text-muted-foreground">Total runs</span>
              <span className="font-medium tabular-nums text-slate-300 text-right">
                {existingForDb.run_count}
              </span>
              <span className="text-muted-foreground">Last status</span>
              <span className="text-right">
                <StatusBadge status={existingForDb.last_status} />
              </span>
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <X className="h-3.5 w-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── All schedules ── */}
        {loading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading schedules…
          </div>
        ) : schedules.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              All Scheduled Databases
            </p>
            {schedules.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5"
              >
                <div
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${s.is_active ? "bg-emerald-400" : "bg-slate-500"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {s.db_name}
                    </span>
                    <span className="rounded border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                      every {s.interval_min < 60 ? `${s.interval_min}m` : `${s.interval_min / 60}h`}
                    </span>
                    <StatusBadge status={s.last_status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {s.last_run_at
                      ? `Last: ${formatAppDateTime(s.last_run_at)}`
                      : "Never run yet"}
                    {" · "}runs: {s.run_count}
                  </p>
                </div>
                <button
                  onClick={() => handleToggle(s.id, s.is_active)}
                  title={s.is_active ? "Pause schedule" : "Resume schedule"}
                  className="rounded-md border border-border/50 bg-secondary/40 p-1.5 text-muted-foreground transition-colors hover:border-amber-400/40 hover:text-amber-300"
                >
                  {s.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  title="Delete schedule"
                  className="rounded-md border border-border/50 bg-secondary/40 p-1.5 text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <p className="text-[11px] text-muted-foreground/70 leading-relaxed border-t border-border/40 pt-3">
          <RefreshCw className="inline h-3 w-3 mr-1 text-muted-foreground/50" />
          Schedules persist in Oracle DB. The server re-syncs every 5 minutes. Removing a
          schedule or pausing it takes effect within the next sync cycle. No browser session
          is required for the scheduler to run.
        </p>
      </DialogContent>
    </Dialog>
  );
}
