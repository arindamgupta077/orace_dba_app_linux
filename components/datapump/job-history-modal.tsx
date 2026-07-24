"use client";

import { useEffect, useState, useMemo } from "react";
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
  XCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Check,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Layers
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

  // Pagination & Copy state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, operationFilter, statusFilter, pageSize]);

  // Calculate quick statistics
  const stats = useMemo(() => {
    const total = historyJobs.length;
    const running = historyJobs.filter((j) => j.status === "running").length;
    const success = historyJobs.filter((j) => j.status === "success" || j.status === "completed").length;
    const error = historyJobs.filter((j) => j.status === "error").length;
    return { total, running, success, error };
  }, [historyJobs]);

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    return historyJobs.filter((job) => {
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
  }, [historyJobs, operationFilter, statusFilter, searchQuery]);

  // Pagination logic
  const totalPages = Math.ceil(filteredJobs.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredJobs.length);
  const paginatedJobs = useMemo(() => {
    return filteredJobs.slice(startIndex, endIndex);
  }, [filteredJobs, startIndex, endIndex]);

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setOperationFilter("all");
    setStatusFilter("all");
  };

  /**
   * Converts and formats date timestamp into IST (Indian Standard Time).
   * Adjusts for -5h 30m offset shift in stored timestamps.
   */
  function formatJobTimeIST(dateVal: string | number | Date | undefined | null): string {
    if (!dateVal) return "—";
    try {
      const dateObj = new Date(dateVal);
      if (isNaN(dateObj.getTime())) return String(dateVal);

      // Add 5 hours 30 minutes (330 mins) to correct for (IST - 5h 30m) offset
      const istMs = dateObj.getTime() + 330 * 60 * 1000;
      const istDate = new Date(istMs);

      const formatted = new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
      }).format(istDate);

      return `${formatted} IST`;
    } catch {
      return String(dateVal);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl flex flex-col p-6 overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/20 via-purple-500/10 to-indigo-500/20 p-3 shadow-inner">
                <History className="h-6 w-6 text-violet-600 dark:text-violet-300" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">Data Pump Job History</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Audit trail and execution logs for Data Pump Export (EXPDP) and Import (IMPDP) operations
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistory}
              disabled={loading}
              className="mr-8 gap-2 text-xs font-medium border-border/60 hover:bg-violet-500/10 hover:text-violet-600 hover:border-violet-500/40 transition-all"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-violet-500")} />
              Refresh
            </Button>
          </div>
        </DialogHeader>

        {/* Quick Stat Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 py-2">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={cn(
              "flex items-center justify-between rounded-xl border p-2.5 text-xs transition-all text-left",
              statusFilter === "all"
                ? "border-violet-500/50 bg-violet-500/10 shadow-sm"
                : "border-border/50 bg-secondary/20 hover:bg-secondary/40"
            )}
          >
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-500" />
              <span className="font-medium">Total Jobs</span>
            </div>
            <span className="font-mono font-bold text-sm text-foreground">{stats.total}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("running")}
            className={cn(
              "flex items-center justify-between rounded-xl border p-2.5 text-xs transition-all text-left",
              statusFilter === "running"
                ? "border-amber-500/50 bg-amber-500/15 shadow-sm"
                : "border-border/50 bg-secondary/20 hover:bg-amber-500/5"
            )}
          >
            <div className="flex items-center gap-2">
              <Loader2 className={cn("h-4 w-4 text-amber-500", stats.running > 0 && "animate-spin")} />
              <span className="font-medium text-amber-700 dark:text-amber-300">Running</span>
            </div>
            <span className="font-mono font-bold text-sm text-amber-700 dark:text-amber-300">{stats.running}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("success")}
            className={cn(
              "flex items-center justify-between rounded-xl border p-2.5 text-xs transition-all text-left",
              statusFilter === "success"
                ? "border-emerald-500/50 bg-emerald-500/15 shadow-sm"
                : "border-border/50 bg-secondary/20 hover:bg-emerald-500/5"
            )}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="font-medium text-emerald-700 dark:text-emerald-300">Success</span>
            </div>
            <span className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-300">{stats.success}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("error")}
            className={cn(
              "flex items-center justify-between rounded-xl border p-2.5 text-xs transition-all text-left",
              statusFilter === "error"
                ? "border-red-500/50 bg-red-500/15 shadow-sm"
                : "border-border/50 bg-secondary/20 hover:bg-red-500/5"
            )}
          >
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="font-medium text-red-700 dark:text-red-300">Failed</span>
            </div>
            <span className="font-mono font-bold text-sm text-red-700 dark:text-red-300">{stats.error}</span>
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/60 bg-muted/20 p-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by Job ID, DB, User, Dump file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-8 h-8 text-xs bg-background/80 border-border/60 focus-visible:ring-violet-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select
            value={operationFilter}
            onValueChange={(v) => setOperationFilter(v as "all" | "expdp" | "impdp")}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs bg-background/80 border-border/60">
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
            <SelectTrigger className="h-8 w-[160px] text-xs bg-background/80 border-border/60">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="success">Success / Completed</SelectItem>
              <SelectItem value="error">Error / Failed</SelectItem>
            </SelectContent>
          </Select>

          {(searchQuery || operationFilter !== "all" || statusFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
            >
              <X className="h-3 w-3" />
              Clear Filters
            </Button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Job List Container */}
        <div className="flex-1 overflow-y-auto pr-1 my-2 space-y-2.5 min-h-[300px]">
          {loading && historyJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="h-9 w-9 animate-spin text-violet-500" />
              <p className="mt-3 text-xs text-muted-foreground font-medium">Fetching Data Pump history records…</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/10 py-16 text-center">
              <History className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-semibold text-foreground">No matching Data Pump jobs found</p>
              <p className="mt-1 text-xs text-muted-foreground">Try broadening your search query or resetting filters</p>
              {(searchQuery || operationFilter !== "all" || statusFilter !== "all") && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4 text-xs gap-1.5">
                  Reset All Filters
                </Button>
              )}
            </div>
          ) : (
            paginatedJobs.map((job) => {
              const isRunning = job.status === "running";
              const isError = job.status === "error";
              const isExpdp = job.operation === "expdp";

              return (
                <div
                  key={job.id}
                  className={cn(
                    "group relative flex flex-col gap-2.5 rounded-xl border p-3.5 text-xs transition-all duration-200 shadow-sm hover:shadow-md",
                    isRunning && "border-amber-500/40 bg-amber-500/[0.04] hover:border-amber-500/60",
                    !isRunning && !isError && "border-emerald-500/30 bg-emerald-500/[0.03] hover:border-emerald-500/50",
                    isError && "border-red-500/30 bg-red-500/[0.04] hover:border-red-500/50"
                  )}
                >
                  {/* Top Bar: Icon, Badges, ID, User, IST Timestamp */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Status Icon */}
                      {isRunning ? (
                        <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[11px] font-semibold">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>RUNNING</span>
                        </div>
                      ) : isError ? (
                        <div className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-red-600 dark:text-red-400 border border-red-500/30 text-[11px] font-semibold">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>FAILED</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>SUCCESS</span>
                        </div>
                      )}

                      {/* Operation Badge */}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border shadow-2xs",
                          isExpdp
                            ? "border-amber-500/40 bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-700 dark:text-amber-300"
                            : "border-violet-500/40 bg-gradient-to-r from-violet-500/20 to-indigo-500/20 text-violet-700 dark:text-violet-300"
                        )}
                      >
                        {isExpdp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                        {job.operation.toUpperCase()}
                      </span>

                      {/* Job ID & Copy */}
                      <div className="flex items-center gap-1 rounded-md bg-background/80 px-2 py-0.5 border border-border/60">
                        <span className="font-mono font-semibold text-foreground text-[11px]">{job.id}</span>
                        <button
                          type="button"
                          onClick={(e) => handleCopyId(job.id, e)}
                          title="Copy Job ID"
                          className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {copiedId === job.id ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>

                      {/* DB Badge */}
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground font-medium">
                        <Database className="h-3 w-3 text-violet-500" />
                        {job.db || "DEFAULT"}
                      </span>
                    </div>

                    {/* Meta info right: User & IST Timestamp */}
                    <div className="flex items-center gap-3 text-muted-foreground text-[11px] flex-wrap">
                      {job.requested_by && (
                        <span className="flex items-center gap-1.5 font-medium">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {job.requested_by}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 font-mono font-medium bg-background/60 px-2 py-0.5 rounded-md border border-border/40 text-foreground/90">
                        <Clock className="h-3 w-3 text-amber-500 dark:text-amber-400 shrink-0" />
                        {formatJobTimeIST(job.started_at)}
                      </span>
                    </div>
                  </div>

                  {/* Details Container: Dump File & Message */}
                  {(job.dump_file || job.message) && (
                    <div className="rounded-lg border border-border/40 bg-background/70 dark:bg-black/20 p-2.5 space-y-1.5">
                      {job.dump_file && (
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px] flex-wrap">
                          <div className="flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300 font-semibold">
                            <Server className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                            <span>Dump File: {job.dump_file}</span>
                          </div>
                          {job.transfer_status && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.2 rounded border font-sans",
                              job.transfer_status.toLowerCase().includes("transfer")
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            )}>
                              {job.transfer_status}
                            </span>
                          )}
                        </div>
                      )}

                      {job.message && (
                        <p
                          className={cn(
                            "text-[11px] font-medium leading-relaxed",
                            isRunning
                              ? "text-amber-700 dark:text-amber-200"
                              : isError
                                ? "text-red-700 dark:text-red-300"
                                : "text-emerald-700 dark:text-emerald-300"
                          )}
                        >
                          {job.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer / Pagination Controls */}
        <div className="pt-3 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          {/* Item count status */}
          <div className="text-muted-foreground text-xs font-medium">
            Showing <span className="font-semibold text-foreground">{filteredJobs.length === 0 ? 0 : startIndex + 1}</span> to{" "}
            <span className="font-semibold text-foreground">{endIndex}</span> of{" "}
            <span className="font-semibold text-foreground">{filteredJobs.length}</span> jobs
          </div>

          {/* Page Size & Navigation */}
          <div className="flex items-center gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground hidden sm:inline">Rows per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="h-7 w-[70px] text-xs bg-background border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Pagination buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1 || filteredJobs.length === 0}
                className="h-7 w-7 border-border/60"
                title="First Page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1 || filteredJobs.length === 0}
                className="h-7 w-7 border-border/60"
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              <span className="px-2 font-mono font-medium text-xs text-foreground">
                Page {currentPage} of {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages || filteredJobs.length === 0}
                className="h-7 w-7 border-border/60"
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || filteredJobs.length === 0}
                className="h-7 w-7 border-border/60"
                title="Last Page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

