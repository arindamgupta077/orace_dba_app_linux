"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Terminal,
  Trash2,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { RmanJob } from "@/types/dba";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function elapsed(startedAt: string, completedAt?: string): string {
  const end = completedAt ? new Date(completedAt) : new Date();
  const diffMs = end.getTime() - new Date(startedAt).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const secs = Math.floor((diffMs % 60_000) / 1000);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Single job row                                                       */
/* ------------------------------------------------------------------ */

function JobRow({ job }: { job: RmanJob }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    running: {
      icon: <Loader2 className="h-4 w-4 animate-spin text-amber-400" />,
      label: "Running",
      border: "border-amber-400/25 bg-amber-400/5",
      badge: "text-amber-300 border-amber-400/30 bg-amber-400/10"
    },
    success: {
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
      label: "Completed",
      border: "border-emerald-400/20 bg-emerald-400/5",
      badge: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10"
    },
    error: {
      icon: <XCircle className="h-4 w-4 text-red-400" />,
      label: "Failed",
      border: "border-red-400/20 bg-red-500/5",
      badge: "text-red-300 border-red-400/30 bg-red-500/10"
    }
  }[job.status];

  const backupType = String(job.params.backup_type ?? "FULL");

  return (
    <div className={cn("rounded-xl border p-4 transition-colors", statusConfig.border)}>
      <div className="flex items-center gap-3">
        {statusConfig.icon}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{backupType}</span>
            <span className="text-xs text-muted-foreground">on</span>
            <span className="font-mono text-xs text-cyan-300">{job.db}</span>
            <span
              className={cn(
                "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                statusConfig.badge
              )}
            >
              {statusConfig.label}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Started {shortTime(job.started_at)}
            </span>
            <span>·</span>
            <span>
              {job.status === "running"
                ? `Running for ${elapsed(job.started_at)}`
                : `Took ${elapsed(job.started_at, job.completed_at)}`}
            </span>
          </div>
        </div>

        {/* Expand toggle (only when there is detail to show) */}
        {(job.response || job.error) && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={expanded ? "Collapse" : "Show details"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (job.response || job.error) && (
        <div className="mt-4 space-y-3 border-t border-border/40 pt-4">
          {job.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-500/8 p-3 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p>{job.error}</p>
            </div>
          )}

          {job.response?.ai_summary && (
            <p className="text-sm leading-6 text-muted-foreground">{job.response.ai_summary}</p>
          )}

          {(job.response?.findings ?? []).length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-red-400/25 bg-red-500/8 p-3">
              {job.response!.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-red-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  <div>
                    <p className="font-medium">{f.title}</p>
                    <p className="text-xs text-red-100/70">{f.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {job.response?.raw_output && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Terminal className="h-3 w-3" />
                RMAN Output
              </p>
              <TerminalViewer output={job.response.raw_output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main tracker panel                                                   */
/* ------------------------------------------------------------------ */

export function RmanJobsTracker() {
  const rmanJobs = useAppStore((s) => s.rmanJobs);
  const clearCompletedRmanJobs = useAppStore((s) => s.clearCompletedRmanJobs);

  if (rmanJobs.length === 0) return null;

  const runningCount = rmanJobs.filter((j) => j.status === "running").length;
  const completedCount = rmanJobs.filter((j) => j.status !== "running").length;

  return (
    <div className="mt-6 space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Background Backup Jobs</p>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {runningCount} running
            </span>
          )}
        </div>
        {completedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={clearCompletedRmanJobs}
          >
            <Trash2 className="h-3 w-3" />
            Clear completed
          </Button>
        )}
      </div>

      {/* Job list */}
      <div className="space-y-2">
        {rmanJobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </div>

      {/* Persistence note */}
      <p className="text-[11px] text-muted-foreground">
        Jobs run in the background — results are saved locally. Navigate freely or close this page; the backup continues on the Oracle server.
      </p>
    </div>
  );
}
