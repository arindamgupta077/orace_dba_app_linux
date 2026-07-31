"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Loader2,
  Terminal,
  User,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { fetchRmanJobsApi } from "@/services/api";
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
  const requestedBy =
    job.requested_by ||
    (job.params.requested_by as string) ||
    (job.params.requestedBy as string) ||
    "dba";

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

          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1 font-medium text-foreground/90">
              <User className="h-3 w-3 text-cyan-400" />
              Requested by <span className="text-cyan-300 font-semibold">{requestedBy}</span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
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

        {/* Expand toggle */}
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
/* Main tracker & history panel                                          */
/* ------------------------------------------------------------------ */

export function RmanJobsTracker() {
  const rmanJobs = useAppStore((s) => s.rmanJobs);
  const selectedDb = useAppStore((s) => s.selectedDb);
  const upsertRmanJob = useAppStore((s) => s.upsertRmanJob);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "success" | "error">("all");
  const [historyJobs, setHistoryJobs] = useState<RmanJob[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  useEffect(() => {
    let unmounted = false;
    const syncJobs = async () => {
      try {
        const res = await fetchRmanJobsApi(selectedDb || undefined);
        if (unmounted) return;
        if (Array.isArray(res?.active)) {
          res.active.forEach((j) => upsertRmanJob(j));
        }
        if (Array.isArray(res?.history)) {
          setHistoryJobs(res.history);
          res.history.forEach((j) => upsertRmanJob(j));
        }
      } catch {
        // Ignore background fetch error
      }
    };

    void syncJobs();
    const interval = setInterval(syncJobs, 5000);
    return () => {
      unmounted = true;
      clearInterval(interval);
    };
  }, [selectedDb, upsertRmanJob]);

  // Reset to page 1 whenever filter or search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, selectedDb]);

  // Combine store rmanJobs and server historyJobs, avoiding duplicates
  const allCombined = [...rmanJobs];
  for (const hJob of historyJobs) {
    if (!allCombined.some((j) => j.id === hJob.id || (j.request_id && hJob.request_id && j.request_id === hJob.request_id))) {
      allCombined.push(hJob);
    }
  }

  // Filter strictly by selectedDb when selected
  const targetDbNorm = selectedDb ? selectedDb.trim().toUpperCase() : null;
  const dbJobs = allCombined.filter((j) => {
    if (!targetDbNorm) return true;
    return j.db && j.db.trim().toUpperCase() === targetDbNorm;
  });

  const runningJobs = dbJobs.filter((j) => j.status === "running");
  const filteredHistory = dbJobs.filter((j) => {
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const reqId = (j.request_id || j.id).toLowerCase();
    const dbName = (j.db || "").toLowerCase();
    const reqBy = (j.requested_by || (j.params?.requested_by as string) || "").toLowerCase();
    const bType = String(j.params?.backup_type || "").toLowerCase();
    const summary = (j.response?.ai_summary || "").toLowerCase();
    const output = (j.response?.raw_output || "").toLowerCase();
    return reqId.includes(q) || dbName.includes(q) || reqBy.includes(q) || bType.includes(q) || summary.includes(q) || output.includes(q);
  });

  // Pagination calculation
  const totalPages = Math.ceil(filteredHistory.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedHistory = filteredHistory.slice(startIndex, startIndex + pageSize);

  return (
    <div className="mt-8 space-y-6">
      {/* ── Section Header ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-foreground">RMAN Backup History & Activity</h3>
            {targetDbNorm && (
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-300">
                Filtered: {selectedDb}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {targetDbNorm
              ? `Showing RMAN backups and activity strictly for database ${selectedDb}.`
              : "Showing RMAN backups and activity across all databases."}
          </p>
        </div>
      </div>

      {/* ── Active Running Banner Section ────────────────────────── */}
      {runningJobs.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-amber-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              </span>
              <h4 className="text-sm font-bold text-amber-200 uppercase tracking-wide">
                RMAN Backup in Progress ({runningJobs.length})
              </h4>
            </div>
            <span className="text-xs text-amber-300/80 font-mono">
              Database: {selectedDb || "All DBs"}
            </span>
          </div>

          <div className="space-y-2">
            {runningJobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* ── Historical Jobs Controls & Filter ──────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-muted/40 p-1 text-xs">
          {[
            { id: "all", label: `All (${dbJobs.length})` },
            { id: "running", label: `Running (${dbJobs.filter((j) => j.status === "running").length})` },
            { id: "success", label: `Completed (${dbJobs.filter((j) => j.status === "success").length})` },
            { id: "error", label: `Failed (${dbJobs.filter((j) => j.status === "error").length})` }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
              className={cn(
                "rounded-lg px-3 py-1 font-medium transition-colors",
                statusFilter === tab.id
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
          <Terminal className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by ID, user, or output..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border/60 bg-muted/30 pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-cyan-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* ── Historical Job List ───────────────────────────────────── */}
      {filteredHistory.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
          <Clock className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            {targetDbNorm
              ? `No RMAN backups recorded for database ${selectedDb}.`
              : "No RMAN backups recorded."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Launch a backup above or change your search/status filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedHistory.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}

      {/* ── Pagination Controls ──────────────────────────────────── */}
      {filteredHistory.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-xs">
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              Showing <strong className="text-foreground">{startIndex + 1}</strong> to{" "}
              <strong className="text-foreground">{Math.min(startIndex + pageSize, filteredHistory.length)}</strong> of{" "}
              <strong className="text-foreground">{filteredHistory.length}</strong> backups
            </span>

            <div className="flex items-center gap-1.5 ml-2 border-l border-border/60 pl-3">
              <span className="text-muted-foreground">Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-foreground focus:outline-none"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="h-7 px-2 text-xs gap-1 border-border/60"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>

            <span className="px-2 text-xs font-semibold text-cyan-300 font-mono">
              Page {currentPage} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="h-7 px-2 text-xs gap-1 border-border/60"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Note */}
      <p className="text-[11px] text-muted-foreground/70">
        Historical RMAN job execution state is stored persistently in the database table{" "}
        <code className="font-mono text-cyan-400">APP_RMAN_JOB_HISTORY</code> and updated automatically via n8n server webhooks.
      </p>
    </div>
  );
}
