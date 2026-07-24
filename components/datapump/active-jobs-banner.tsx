"use client";

import { useEffect } from "react";
import { CheckCircle2, Loader2, Server, Trash2, XCircle } from "lucide-react";
import { fetchDataPumpJobsApi } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { DataPumpJob } from "@/types/dba";
import { cn } from "@/lib/utils";

interface ActiveJobsBannerProps {
  onJobClick?: (job: DataPumpJob) => void;
}

export function ActiveJobsBanner({ onJobClick }: ActiveJobsBannerProps) {
  const jobs = useAppStore((s) => s.dataPumpJobs);
  const upsertDataPumpJob = useAppStore((s) => s.upsertDataPumpJob);
  const clearCompletedDataPumpJobs = useAppStore((s) => s.clearCompletedDataPumpJobs);

  // Periodically sync RUNNING jobs from the server only. We deliberately do
  // NOT upsert `res.history` here — that would resurrect completed rows the
  // user just cleared with "Clear completed". History rows are fetched
  // on-demand from the Job History modal.
  useEffect(() => {
    const syncJobs = () => {
      fetchDataPumpJobsApi()
        .then((res) => {
          // Only the running rows belong in the banner; merging fresh
          // completions in here is fine since they transitioned the UX.
          const active = Array.isArray(res.active) ? res.active : [];
          active.forEach((j) => upsertDataPumpJob(j));
        })
        .catch(() => {});
    };
    syncJobs();
    const interval = setInterval(syncJobs, 5000);
    return () => clearInterval(interval);
  }, [upsertDataPumpJob]);

  // Open SSE connection for any running jobs
  useEffect(() => {
    const runningJobs = jobs.filter((j) => j.status === "running");
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
  }, [jobs.filter((j) => j.status === "running").length]);

  if (jobs.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-violet-600/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">
          Data Pump Jobs
        </p>
        <button
          type="button"
          onClick={clearCompletedDataPumpJobs}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash2 className="h-3 w-3" />
          Clear completed
        </button>
      </div>

      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            onClick={() => onJobClick?.(job)}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-xs transition-all",
              onJobClick && "cursor-pointer hover:brightness-110",
              job.status === "running" && "border-amber-400/20 bg-amber-400/5",
              (job.status === "success" || job.status === "completed") &&
                "border-emerald-400/20 bg-emerald-400/5",
              job.status === "error" && "border-red-400/20 bg-red-500/5"
            )}
          >
            {/* Icon */}
            <div className="mt-0.5 shrink-0">
              {job.status === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              ) : job.status === "error" ? (
                <XCircle className="h-4 w-4 text-red-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    job.operation === "expdp"
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                      : "border-violet-400/30 bg-violet-400/10 text-violet-300"
                  )}
                >
                  {job.operation.toUpperCase()}
                </span>
                <span className="font-semibold text-foreground">{job.db}</span>
                <span className="font-mono text-muted-foreground">{job.id}</span>
                {job.requested_by && (
                  <span className="text-[10px] text-muted-foreground">· By {job.requested_by}</span>
                )}
              </div>

              {/* Status message */}
              <p className={cn(
                "mt-0.5",
                job.status === "running" ? "text-amber-200/80" :
                job.status === "error" ? "text-red-200/80" : "text-emerald-200/80"
              )}>
                {job.status === "running"
                  ? "In progress — waiting for n8n callback…"
                  : job.message || (job.status === "error" ? "Job failed" : "Completed successfully")}
              </p>

              {/* Dump file / transfer info */}
              {job.dump_file && (
                <p className="mt-0.5 flex items-center gap-1 font-mono text-muted-foreground">
                  <Server className="h-3 w-3" />
                  {job.dump_file}
                  {job.transfer_status && <> → {job.transfer_status}</>}
                </p>
              )}
            </div>

            {/* Time */}
            <div className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {new Date(job.started_at).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
