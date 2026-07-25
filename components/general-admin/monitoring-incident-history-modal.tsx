"use client";

import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Copy,
  Eye,
  FilterX,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  WifiOff,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchMonitoringIncidentHistory } from "@/services/api";
import type { MonitoringIncident } from "@/types/dba";

interface MonitoringIncidentHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTimestamp(isoDate?: string | null): string {
  if (!isoDate) return "N/A";
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return isoDate;
  }
}

function calculateDuration(startDate: string, endDate?: string | null): string {
  try {
    const start = new Date(startDate).getTime();
    const end = endDate ? new Date(endDate).getTime() : Date.now();
    const diffMs = end - start;
    if (isNaN(diffMs) || diffMs < 0) return "";

    const minutes = Math.floor(diffMs / (1000 * 60));
    if (minutes < 1) return "< 1m";
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    if (hours < 24) return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;

    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  } catch {
    return "";
  }
}

function StatusBadge({ status }: { status: MonitoringIncident["status"] }) {
  if (status === "DOWN") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400 shadow-sm shadow-red-950/20">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
        </span>
        <WifiOff className="h-3 w-3" />
        Down
      </span>
    );
  }
  if (status === "ACKNOWLEDGED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 shadow-sm shadow-amber-950/20">
        <Eye className="h-3 w-3" />
        Acknowledged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 shadow-sm shadow-emerald-950/20">
      <CheckCircle2 className="h-3 w-3" />
      Resolved
    </span>
  );
}

export function MonitoringIncidentHistoryModal({
  open,
  onOpenChange
}: MonitoringIncidentHistoryModalProps) {
  const [incidents, setIncidents] = useState<MonitoringIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMonitoringIncidentHistory(500);
      setIncidents(data);
    } catch (err) {
      console.error("[MonitoringIncidentHistoryModal] Error fetching history:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadHistory();
      setCurrentPage(1);
    }
  }, [open, loadHistory]);

  // Reset pagination on search or status filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterStatus, pageSize]);

  const copyIncidentId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Metrics breakdown
  const metrics = useMemo(() => {
    let down = 0;
    let ack = 0;
    let resolved = 0;
    incidents.forEach((inc) => {
      if (inc.status === "DOWN") down++;
      else if (inc.status === "ACKNOWLEDGED") ack++;
      else if (inc.status === "RESOLVED") resolved++;
    });
    return { total: incidents.length, down, ack, resolved };
  }, [incidents]);

  // Filtered items
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === "" ||
        inc.db_name.toLowerCase().includes(q) ||
        inc.incident_id.toLowerCase().includes(q) ||
        (inc.acknowledged_by && inc.acknowledged_by.toLowerCase().includes(q));

      const matchesStatus = filterStatus === "ALL" || inc.status === filterStatus;

      return matchesSearch && matchesStatus;
    });
  }, [incidents, search, filterStatus]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredIncidents.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredIncidents.length);
  const paginatedIncidents = useMemo(() => {
    return filteredIncidents.slice(startIndex, endIndex);
  }, [filteredIncidents, startIndex, endIndex]);

  const hasActiveFilters = search.trim() !== "" || filterStatus !== "ALL";

  const handleClearFilters = () => {
    setSearch("");
    setFilterStatus("ALL");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6 gap-4 bg-background border-border/80 shadow-2xl">
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/60">
          <div>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
              <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <History className="h-5 w-5" />
              </div>
              Database Monitoring History
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Comprehensive log of database outages, alerts, acknowledgments, and resolutions
            </DialogDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadHistory()}
            disabled={loading}
            className="h-8 gap-1.5 text-xs border-border/60 hover:border-border hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-cyan-400")} />
            Refresh
          </Button>
        </DialogHeader>

        {/* Metric Cards summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            onClick={() => setFilterStatus("ALL")}
            className={cn(
              "flex flex-col p-3 rounded-xl border text-left transition-all",
              filterStatus === "ALL"
                ? "border-cyan-500/50 bg-cyan-500/10 shadow-sm"
                : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/30"
            )}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
              <span>Total Logged</span>
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <div className="text-xl font-bold font-mono text-foreground mt-1">{metrics.total}</div>
          </button>

          <button
            onClick={() => setFilterStatus("DOWN")}
            className={cn(
              "flex flex-col p-3 rounded-xl border text-left transition-all",
              filterStatus === "DOWN"
                ? "border-red-500/60 bg-red-500/15 shadow-sm"
                : "border-red-500/20 bg-red-500/5 hover:border-red-500/40"
            )}
          >
            <div className="flex items-center justify-between text-xs text-red-400 font-medium">
              <span>Active Down</span>
              <WifiOff className="h-3.5 w-3.5 text-red-400" />
            </div>
            <div className="text-xl font-bold font-mono text-red-400 mt-1">{metrics.down}</div>
          </button>

          <button
            onClick={() => setFilterStatus("ACKNOWLEDGED")}
            className={cn(
              "flex flex-col p-3 rounded-xl border text-left transition-all",
              filterStatus === "ACKNOWLEDGED"
                ? "border-amber-500/60 bg-amber-500/15 shadow-sm"
                : "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40"
            )}
          >
            <div className="flex items-center justify-between text-xs text-amber-400 font-medium">
              <span>Acknowledged</span>
              <Eye className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold font-mono text-amber-400 mt-1">{metrics.ack}</div>
          </button>

          <button
            onClick={() => setFilterStatus("RESOLVED")}
            className={cn(
              "flex flex-col p-3 rounded-xl border text-left transition-all",
              filterStatus === "RESOLVED"
                ? "border-emerald-500/60 bg-emerald-500/15 shadow-sm"
                : "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40"
            )}
          >
            <div className="flex items-center justify-between text-xs text-emerald-400 font-medium">
              <span>Resolved</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1">{metrics.resolved}</div>
          </button>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by DB name, Incident ID, user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8 h-9 text-xs bg-muted/20 border-border/60 focus:border-cyan-500/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
              {[
                { id: "ALL", label: "All", count: metrics.total },
                { id: "DOWN", label: "Down", count: metrics.down },
                { id: "ACKNOWLEDGED", label: "Ack", count: metrics.ack },
                { id: "RESOLVED", label: "Resolved", count: metrics.resolved }
              ].map((st) => (
                <button
                  key={st.id}
                  onClick={() => setFilterStatus(st.id)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-md transition-all flex items-center gap-1.5",
                    filterStatus === st.id
                      ? "bg-background text-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>{st.label}</span>
                  <span
                    className={cn(
                      "px-1.5 py-0.2 rounded-full text-[9px] font-mono",
                      filterStatus === st.id
                        ? "bg-muted text-foreground"
                        : "bg-muted/40 text-muted-foreground"
                    )}
                  >
                    {st.count}
                  </span>
                </button>
              ))}
            </div>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                title="Reset filters"
              >
                <FilterX className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            )}
          </div>
        </div>

        {/* Incident List */}
        <ScrollArea className="flex-1 min-h-[320px] max-h-[460px] pr-3 -mr-3">
          {loading && incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
              <span>Fetching incident history…</span>
            </div>
          ) : paginatedIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-3">
              <div className="p-3 rounded-full bg-muted/30 border border-border/40">
                <ShieldAlert className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">No monitoring records found</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {hasActiveFilters
                    ? "No incidents match your current search or status filter criteria."
                    : "No database monitoring incidents have been logged yet."}
                </p>
              </div>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={handleClearFilters} className="text-xs mt-2">
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 pt-1 pr-1">
              {paginatedIncidents.map((inc) => {
                const durationStr = calculateDuration(inc.first_reported, inc.resolved_at);

                return (
                  <div
                    key={inc.incident_id}
                    className={cn(
                      "group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all text-xs",
                      inc.status === "DOWN"
                        ? "border-red-500/30 bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent hover:border-red-500/50 shadow-sm shadow-red-950/10"
                        : inc.status === "ACKNOWLEDGED"
                        ? "border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent hover:border-amber-500/50 shadow-sm shadow-amber-950/10"
                        : "border-border/60 bg-card/60 hover:border-border hover:bg-card/90"
                    )}
                  >
                    {/* Left: DB Name & Incident ID */}
                    <div className="space-y-1 min-w-[200px]">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-mono font-bold text-sm text-foreground group-hover:text-cyan-400 transition-colors">
                          {inc.db_name}
                        </span>
                        <StatusBadge status={inc.status} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-muted-foreground/80">
                          {inc.incident_id}
                        </span>
                        <button
                          onClick={(e) => copyIncidentId(inc.incident_id, e)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          title="Copy Incident ID"
                        >
                          {copiedId === inc.incident_id ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Middle: Timestamps & Duration */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-muted-foreground text-[11px] border-y sm:border-y-0 sm:border-x border-border/40 py-2 sm:py-0 sm:px-4">
                      <div>
                        <span className="text-muted-foreground/60 block text-[10px] uppercase tracking-wider font-semibold">
                          First Reported
                        </span>
                        <span className="font-mono text-foreground/90">{formatTimestamp(inc.first_reported)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground/60 block text-[10px] uppercase tracking-wider font-semibold">
                          Last Reported
                        </span>
                        <span className="font-mono text-foreground/90">{formatTimestamp(inc.last_reported)}</span>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <span className="text-muted-foreground/60 block text-[10px] uppercase tracking-wider font-semibold">
                          {inc.status === "RESOLVED" ? "Outage Duration" : "Elapsed Time"}
                        </span>
                        <span className="font-mono text-amber-400 font-medium flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {durationStr || "N/A"}
                        </span>
                      </div>
                    </div>

                    {/* Right: Meta & Acknowledgement Details */}
                    <div className="flex flex-col justify-center sm:items-end text-[11px] text-muted-foreground space-y-1 min-w-[180px]">
                      {inc.report_count > 1 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-medium text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          {inc.report_count} down notifications
                        </span>
                      )}
                      {inc.acknowledged_by ? (
                        <span className="text-[11px]">
                          Ack by <strong className="text-foreground">{inc.acknowledged_by}</strong>{" "}
                          <span className="text-muted-foreground/70">
                            ({formatTimestamp(inc.acknowledged_at)})
                          </span>
                        </span>
                      ) : inc.status === "DOWN" ? (
                        <span className="text-red-400 font-medium text-[10px] italic">
                          Awaiting acknowledgment
                        </span>
                      ) : null}
                      {inc.resolved_at && (
                        <span className="text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Resolved: {formatTimestamp(inc.resolved_at)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer / Pagination Controls */}
        <div className="pt-3 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          {/* Status info */}
          <div className="text-muted-foreground text-xs font-medium">
            Showing <span className="font-semibold text-foreground">{filteredIncidents.length === 0 ? 0 : startIndex + 1}</span> to{" "}
            <span className="font-semibold text-foreground">{endIndex}</span> of{" "}
            <span className="font-semibold text-foreground">{filteredIncidents.length}</span> incidents
          </div>

          {/* Controls */}
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
                  <SelectItem value="25">25</SelectItem>
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
                disabled={currentPage === 1 || filteredIncidents.length === 0}
                className="h-7 w-7 border-border/60"
                title="First Page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1 || filteredIncidents.length === 0}
                className="h-7 w-7 border-border/60"
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              <span className="px-2 font-mono text-xs font-medium text-foreground">
                Page {currentPage} of {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages || filteredIncidents.length === 0}
                className="h-7 w-7 border-border/60"
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || filteredIncidents.length === 0}
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
