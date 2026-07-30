"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  RefreshCw,
  Search,
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
import { formatAppDateTime } from "@/lib/utils";
import { fetchDashboardSnapshotHistory } from "@/services/api";
import type { DashboardHistoryRow, DashboardMetrics } from "@/types/dba";

function getSnapshotHealth(metrics: DashboardMetrics | null): {
  status: "healthy" | "warning" | "critical";
  label: string;
  color: string;
} {
  if (!metrics) return { status: "healthy", label: "Unknown", color: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400" };

  const blocking = metrics.blocking_sessions?.length ?? 0;
  const fraUsed = metrics.fra?.pct_used ?? 0;
  const cpuUsed = metrics.os_resources?.cpu_usage_pct ?? 0;
  const tsMax = Math.max(0, ...(metrics.tablespaces ?? []).map((t) => t.pct_used ?? 0));

  if (blocking > 0 || fraUsed > 85 || tsMax > 90 || cpuUsed > 85) {
    return { status: "critical", label: "CRITICAL", color: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" };
  }
  if (fraUsed > 70 || tsMax > 80 || cpuUsed > 70) {
    return { status: "warning", label: "WARNING", color: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  }
  return { status: "healthy", label: "HEALTHY", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
}

export function HistoricalSnapshotsModal({
  open,
  onClose,
  selectedDb,
  activeSnapshotId,
  onSelectSnapshot
}: {
  open: boolean;
  onClose: () => void;
  selectedDb: string;
  activeSnapshotId: number | null;
  onSelectSnapshot: (snapshot: DashboardHistoryRow) => void;
}) {
  const [snapshots, setSnapshots] = useState<DashboardHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDashboardSnapshotHistory(selectedDb, { page, pageSize });
      setSnapshots(res.snapshots || []);
      setTotalCount(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load historical snapshots.");
    } finally {
      setLoading(false);
    }
  }, [selectedDb, page, pageSize]);

  useEffect(() => {
    if (open) {
      loadData();
    } else {
      setSearchQuery("");
      setPage(1);
    }
  }, [open, loadData]);

  // Reset to page 1 when selectedDb or pageSize changes
  useEffect(() => {
    setPage(1);
  }, [selectedDb, pageSize]);

  const filteredSnapshots = snapshots.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const timeStr = formatAppDateTime(s.refresh_timestamp).toLowerCase();
    const userStr = (s.refreshed_by || "").toLowerCase();
    const envStr = (s.environment || "").toLowerCase();
    return timeStr.includes(q) || userStr.includes(q) || envStr.includes(q);
  });

  const startRecord = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col bg-background text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-1.5 text-cyan-600 dark:text-cyan-300">
              <Clock className="h-5 w-5" />
            </div>
            Historical Snapshots — <span className="text-cyan-600 dark:text-cyan-300 font-mono">{selectedDb}</span>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs sm:text-sm">
            Browse and inspect historical database state snapshots captured by manual refreshes or scheduled monitoring runs.
          </DialogDescription>
        </DialogHeader>

        {/* Search Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search page results by time, user..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs bg-background text-foreground border-input"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              className="gap-1.5 text-xs border-border"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Snapshot Cards List */}
        <div className="flex-1 overflow-y-auto min-h-[300px] pr-1 space-y-2.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-600 dark:text-cyan-400" />
              <p className="text-sm text-muted-foreground">Fetching snapshots for {selectedDb}...</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300 my-4">
              <XCircle className="h-5 w-5 flex-shrink-0" />
              {error}
            </div>
          ) : filteredSnapshots.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <Clock className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No historical snapshots found</p>
              <p className="text-xs text-muted-foreground">
                {searchQuery ? "No snapshots on this page match your search term." : "No snapshots recorded yet for this database."}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredSnapshots.map((snapshot) => {
                const health = getSnapshotHealth(snapshot.metrics);
                const isSelected = activeSnapshotId === snapshot.id;
                const cpu = snapshot.metrics?.os_resources?.cpu_usage_pct ?? 0;
                const active = snapshot.metrics?.active_sessions ?? 0;
                const blockers = snapshot.metrics?.blocking_sessions?.length ?? 0;
                const fra = snapshot.metrics?.fra?.pct_used ?? 0;

                return (
                  <div
                    key={snapshot.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 transition-all ${
                      isSelected
                        ? "border-cyan-500/60 bg-cyan-500/10 dark:bg-cyan-950/30 ring-1 ring-cyan-500/40 shadow-sm"
                        : "border-border bg-card hover:bg-accent/40"
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex items-center gap-1 font-mono text-xs font-semibold text-foreground">
                          <Clock className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                          {formatAppDateTime(snapshot.refresh_timestamp)}
                        </span>

                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${health.color}`}>
                          {health.label}
                        </span>

                        {isSelected && (
                          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Active View
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          Refreshed by: <strong className="text-foreground font-mono">{snapshot.refreshed_by || "SYSTEM"}</strong>
                        </span>
                        {snapshot.environment && (
                          <span className="text-muted-foreground font-mono">
                            Env: {snapshot.environment}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                        <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-foreground">
                          CPU: <strong className={cpu >= 80 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>{cpu}%</strong>
                        </span>
                        <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-foreground">
                          Sessions: <strong className="text-cyan-600 dark:text-cyan-400">{active} active</strong>
                        </span>
                        {blockers > 0 && (
                          <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-300 font-semibold flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {blockers} Blocker{blockers > 1 ? "s" : ""}
                          </span>
                        )}
                        <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-foreground">
                          FRA: <strong className={fra >= 80 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}>{fra}%</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:self-center">
                      <Button
                        size="sm"
                        variant={isSelected ? "secondary" : "default"}
                        onClick={() => {
                          onSelectSnapshot(snapshot);
                          onClose();
                        }}
                        className={
                          isSelected
                            ? "bg-muted text-foreground hover:bg-accent text-xs gap-1.5 border border-border"
                            : "bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-xs gap-1.5"
                        }
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {isSelected ? "Active View" : "View Snapshot"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with Pagination Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              Showing <strong className="text-foreground">{startRecord}</strong> to <strong className="text-foreground">{endRecord}</strong> of <strong className="text-foreground">{totalCount}</strong> snapshots
            </span>

            <div className="flex items-center gap-1.5 ml-2">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded border border-input bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs mr-1">
              Page <strong className="text-foreground">{page}</strong> of <strong className="text-foreground">{totalPages}</strong>
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="h-8 px-2 text-xs border-border"
              title="Previous Page"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Prev</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="h-8 px-2 text-xs border-border"
              title="Next Page"
            >
              <span className="hidden sm:inline mr-1">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
