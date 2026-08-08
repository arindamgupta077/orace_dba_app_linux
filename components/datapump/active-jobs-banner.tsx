"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Server, XCircle } from "lucide-react";
import { fetchDataPumpJobsApi } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { DataPumpJob } from "@/types/dba";
import { cn, parseAppTimestamp } from "@/lib/utils";

interface ActiveJobsBannerProps {
  onJobClick?: (job: DataPumpJob) => void;
}

export function ActiveJobsBanner({ onJobClick }: ActiveJobsBannerProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const jobs = useAppStore((s) => s.dataPumpJobs);
  const upsertDataPumpJob = useAppStore((s) => s.upsertDataPumpJob);

  const [isExpanded, setIsExpanded] = useState(false);

  // Periodically sync RUNNING jobs for the selected database from the server.
  useEffect(() => {
    const syncJobs = () => {
      fetchDataPumpJobsApi(selectedDb)
        .then((res) => {
          if (Array.isArray(res?.active)) {
            res.active.forEach((j) => upsertDataPumpJob(j));
          }
          if (Array.isArray(res?.history)) {
            res.history.forEach((j) => upsertDataPumpJob(j));
          }
        })
        .catch(() => {});
    };
    syncJobs();
    const interval = setInterval(syncJobs, 5000);
    return () => clearInterval(interval);
  }, [selectedDb, upsertDataPumpJob]);

  // Open SSE connection for any running jobs matching selectedDb
  useEffect(() => {
    const runningJobs = jobs.filter(
      (j) => j.status === "running" && (!selectedDb || j.db?.toUpperCase() === selectedDb.toUpperCase())
    );
    if (runningJobs.length === 0) return;

    const sources: EventSource[] = [];

    for (const job of runningJobs) {
      const es = new EventSource(`/api/datapump/sse?job_id=${encodeURIComponent(job.id)}`);
      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          upsertDataPumpJob({
            ...job,
            status: payload.status ?? job.status,
            dump_file: payload.dump_file ?? job.dump_file,
            transfer_status: payload.transfer_status ?? job.transfer_status,
            message: payload.message ?? job.message,
            completed_at: payload.status !== "running" ? new Date().toISOString() : job.completed_at
          });
          if (payload.status !== "running") {
            es.close();
          }
        } catch { /* ignore bad frames */ }
      };
      sources.push(es);
    }

    return () => sources.forEach((es) => es.close());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDb, jobs.filter((j) => j.status === "running").length]);

  const filteredJobs = useMemo(() => {
    const list = selectedDb
      ? jobs.filter((j) => !j.db || j.db.toUpperCase() === selectedDb.toUpperCase())
      : jobs;
    return [...list]
      .sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime())
      .slice(0, 5);
  }, [jobs, selectedDb]);

  const runningJobs = useMemo(() => {
    return filteredJobs.filter((j) => j.status === "running");
  }, [filteredJobs]);

  const completedJobs = useMemo(() => {
    return filteredJobs.filter((j) => j.status !== "running");
  }, [filteredJobs]);

  const displayedJobs = isExpanded ? filteredJobs : runningJobs;

  if (filteredJobs.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/5 via-purple-500/5 to-violet-600/10 px-3.5 py-2.5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-violet-300">
            Data Pump Jobs ({selectedDb || "All DBs"})
          </span>
          {runningJobs.length > 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningJobs.length} Running
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/60 font-mono px-1.5 py-0.5 rounded bg-muted/20 border border-border/30">
              0 Running
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {completedJobs.length > 0 && (
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="flex items-center gap-1 rounded-md border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[10.5px] font-medium text-violet-300 transition-colors hover:bg-violet-400/20"
            >
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {isExpanded ? "Hide completed" : `Show completed (${completedJobs.length})`}
            </button>
          )}
        </div>
      </div>

      {displayedJobs.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {displayedJobs.map((job) => (
            <div
              key={job.id}
              onClick={() => onJobClick?.(job)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 text-xs transition-all",
                onJobClick && "cursor-pointer hover:brightness-110",
                job.status === "running" && "border-amber-400/30 bg-amber-400/10",
                (job.status === "success" || job.status === "completed") &&
                  "border-emerald-400/20 bg-emerald-400/5",
                job.status === "error" && "border-red-400/20 bg-red-500/5"
              )}
            >
              {/* Icon */}
              <div className="shrink-0">
                {job.status === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                ) : job.status === "error" ? (
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider shrink-0",
                      job.operation === "expdp"
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                        : "border-violet-400/30 bg-violet-400/10 text-violet-300"
                    )}
                  >
                    {job.operation.toUpperCase()}
                  </span>
                  <span className="font-bold text-foreground truncate text-[11.5px]">{job.db}</span>
                  <span className="font-mono text-muted-foreground/80 text-[10.5px] shrink-0">{job.id}</span>
                  <span className="text-[10.5px] text-muted-foreground truncate hidden sm:inline">
                    · {job.status === "running" ? "In progress — waiting for n8n callback…" : job.message || (job.status === "error" ? "Job failed" : "Completed")}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {job.dump_file && (
                    <span className="hidden md:flex items-center gap-1 font-mono text-[10px] text-muted-foreground truncate max-w-[200px]" title={job.dump_file}>
                      <Server className="h-3 w-3 shrink-0" />
                      {job.dump_file}
                    </span>
                  )}

                  <span className="text-[10px] text-muted-foreground tabular-nums font-mono shrink-0">
                    {(() => {
                      try {
                        if (!job.started_at) return "";
                        const d = parseAppTimestamp(job.started_at);
                        if (isNaN(d.getTime())) return String(job.started_at);
                        return new Intl.DateTimeFormat("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: true,
                          timeZone: "Asia/Kolkata"
                        }).format(d) + " IST";
                      } catch {
                        return String(job.started_at || "");
                      }
                    })()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
