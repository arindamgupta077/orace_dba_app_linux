"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  History,
  Loader2,
  RefreshCw,
  Search,
  Server,
  User,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { fetchDataPumpJobsApi } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { DataPumpJob } from "@/types/dba";
import { cn } from "@/lib/utils";

interface JobHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JobHistoryModal({ open, onOpenChange }: JobHistoryModalProps) {
  const [historyJobs, setHistoryJobs] = useState<DataPumpJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [operationFilter, setOperationFilter] = useState<"all" | "expdp" | "impdp">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "success" | "error">("all");

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const localJobs = useAppStore.getState().dataPumpJobs || [];
      let serverActive: DataPumpJob[] = [];
      let serverHistory: DataPumpJob[] = [];
      try {
        const res = await fetchDataPumpJobsApi();
        serverActive = res.active || [];
        serverHistory = res.history || [];
      } catch (fetchErr) {
        console.warn("[JobHistoryModal] Failed to fetch server job history, falling back to local store:", fetchErr);
      }

      // Prioritize Oracle DB records (serverHistory & serverActive) over local store
      const combined = [...serverHistory, ...serverActive, ...localJobs];
      const map = new Map<string, DataPumpJob>();
      for (const j of combined) {
        if (!j || !j.id) continue;
        const existing = map.get(j.id);
        if (!existing) {
          map.set(j.id, j);
        } else {
          map.set(j.id, {
            ...j,
            ...existing,
            message: existing.message || j.message,
            dump_file: existing.dump_file || j.dump_file,
            transfer_status: existing.transfer_status || j.transfer_status,
            requested_by: existing.requested_by || j.requested_by
          });
        }
      }
      const unique = Array.from(map.values()).sort(
        (a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()
      );
      setHistoryJobs(unique);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load job history";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  // Filtered jobs
  const filteredJobs = historyJobs.filter((job) => {
    if (operationFilter !== "all" && job.operation !== operationFilter) return false;
    if (statusFilter !== "all") {
      if (statusFilter === "success" && job.status !== "success" && job.status !== "completed") return false;
      if (statusFilter === "running" && job.status !== "running") return false;
      if (statusFilter === "error" && job.status !== "error") return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesId = job.id.toLowerCase().includes(q);
      const matchesDb = job.db.toLowerCase().includes(q);
      const matchesUser = (job.requested_by || "").toLowerCase().includes(q);
      const matchesDump = (job.dump_file || "").toLowerCase().includes(q);
      const matchesMsg = (job.message || "").toLowerCase().includes(q);
      if (!matchesId && !matchesDb && !matchesUser && !matchesDump && !matchesMsg) return false;
    }
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-violet-400/30 bg-violet-400/10 p-2.5">
                <History className="h-5 w-5 text-violet-700 dark:text-violet-300" />
              </div>
              <div>
                <DialogTitle className="text-xl">Data Pump Job History</DialogTitle>
                <DialogDescription>
                  Audit trail of all Data Pump Export (EXPDP) and Import (IMPDP) operations across all users
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistory}
              disabled={loading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </DialogHeader>

        {/* Filter controls */}
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ID, DB, User, Dump file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <Select
            value={operationFilter}
            onValueChange={(v) => setOperationFilter(v as "all" | "expdp" | "impdp")}
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="All Operations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Operations</SelectItem>
              <SelectItem value="expdp">Export (EXPDP)</SelectItem>
              <SelectItem value="impdp">Import (IMPDP)</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as "all" | "running" | "success" | "error")}
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="success">Success / Completed</SelectItem>
              <SelectItem value="error">Error / Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Job list */}
        {loading && historyJobs.length === 0 ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-violet-400" />
            <p className="mt-2 text-xs text-muted-foreground">Loading job history from database…</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-secondary/10 py-12 text-center">
            <History className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No matching Data Pump jobs found</p>
            <p className="mt-1 text-xs text-muted-foreground">Try clearing filters or running an Export/Import job</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredJobs.map((job) => {
              const isRunning = job.status === "running";
              const isError = job.status === "error";
              const isExpdp = job.operation === "expdp";

              return (
                <div
                  key={job.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-4 text-xs transition-colors",
                    isRunning && "border-amber-400/30 bg-amber-400/5",
                    !isRunning && !isError && "border-emerald-400/20 bg-emerald-400/5",
                    isError && "border-red-400/20 bg-red-500/5"
                  )}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      {/* Icon */}
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin text-amber-400 shrink-0" />
                      ) : isError ? (
                        <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      )}

                      {/* Operation Badge */}
                      <span
                        className={cn(
                          "rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          isExpdp
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300"
                            : "border-violet-400/30 bg-violet-400/10 text-violet-700 dark:text-violet-300"
                        )}
                      >
                        {job.operation.toUpperCase()}
                      </span>

                      {/* Job ID */}
                      <span className="font-mono font-semibold text-foreground">{job.id}</span>

                      {/* DB */}
                      <span className="flex items-center gap-1 rounded border border-border/50 bg-background/50 px-2 py-0.5 text-[11px]">
                        <Database className="h-3 w-3 text-muted-foreground" />
                        {job.db || "Default DB"}
                      </span>
                    </div>

                    {/* Meta info right */}
                    <div className="flex items-center gap-3 text-muted-foreground text-[11px]">
                      {job.requested_by && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {job.requested_by}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(job.started_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Dump file & message */}
                  {(job.dump_file || job.message) && (
                    <div className="mt-1 space-y-1 rounded-lg border border-border/30 bg-muted/30 dark:bg-black/20 p-2.5">
                      {job.dump_file && (
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-cyan-700 dark:text-cyan-200">
                          <Server className="h-3 w-3 text-cyan-600 dark:text-cyan-400 shrink-0" />
                          <span>Dump File: {job.dump_file}</span>
                          {job.transfer_status && (
                            <span className="text-amber-700 dark:text-amber-300">({job.transfer_status})</span>
                          )}
                        </div>
                      )}
                      {job.message && (
                        <p className={cn(
                          "text-[11px]",
                          isRunning
                            ? "text-amber-700 dark:text-amber-200/90"
                            : isError
                              ? "text-red-700 dark:text-red-200/90"
                              : "text-emerald-700 dark:text-emerald-200/90"
                        )}>
                          {job.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
