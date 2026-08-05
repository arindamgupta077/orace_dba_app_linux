"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Database,
  FilterX,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle
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
import { fetchRebootHistory } from "@/services/api";
import type { RebootHistoryItem } from "@/types/dba";

interface RebootHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: string;
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
    return isoDate ?? "N/A";
  }
}

function EventBadge({ eventType }: { eventType: RebootHistoryItem["event_type"] }) {
  if (eventType === "PRE_SHUTDOWN") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 shadow-xs">
        <Clock className="h-3 w-3" />
        Pre-Shutdown
      </span>
    );
  }
  if (eventType === "POST_MOUNT_COMPLIANT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 shadow-xs">
        <CheckCircle2 className="h-3 w-3" />
        Started ✓
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-400 shadow-xs">
      <XCircle className="h-3 w-3" />
      Startup Aborted
    </span>
  );
}

function ComplianceBadge({ compliant }: { compliant: boolean }) {
  return compliant ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
      <ShieldCheck className="h-3 w-3" />
      Compliant
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
      <ShieldAlert className="h-3 w-3" />
      Non-Compliant
    </span>
  );
}

function AuditParamRow({ label, value, compliant }: { label: string; value: string; compliant?: boolean }) {
  const hasFlag = compliant !== undefined;
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/40 last:border-0 text-xs">
      <span className="text-muted-foreground font-mono w-44 shrink-0 font-medium">{label}</span>
      <span className={cn(
        "flex-1 font-mono break-all font-semibold",
        hasFlag
          ? (compliant ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")
          : "text-foreground"
      )}>
        {value || <span className="italic font-normal text-muted-foreground/60">(blank)</span>}
      </span>
      {hasFlag && (
        compliant
          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          : <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      )}
    </div>
  );
}

function RebootHistoryRow({ item }: { item: RebootHistoryItem }) {
  const [expanded, setExpanded] = useState(false);

  const spfileCompliant = (item.spfile_value ?? "").trim() === "";
  const sysOpsCompliant = (item.audit_sys_ops ?? "").trim().toUpperCase() === "TRUE";
  const trailCompliant  = ["DB, EXTENDED", "DB_EXTENDED"].includes(
    (item.audit_trail ?? "").trim().toUpperCase().replace(/\s+/g, " ")
  );

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200 shadow-2xs",
        item.is_compliant
          ? "border-border/60 bg-card/80 hover:bg-card"
          : "border-red-200 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/5 hover:border-red-300 dark:hover:border-red-500/50"
      )}
    >
      {/* Summary row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex flex-wrap items-center gap-3 p-3.5 text-left cursor-pointer hover:bg-muted/30 rounded-xl transition-colors"
      >
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <EventBadge eventType={item.event_type} />
            <ComplianceBadge compliant={item.is_compliant} />
            {item.shutdown_option && (
              <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono font-medium text-foreground/80">
                {item.shutdown_option}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 font-medium text-foreground/70">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {formatTimestamp(item.created_at)}
            </span>
            <span>Requested by <span className="text-foreground font-semibold">{item.requested_by}</span></span>
            <span className="font-mono text-cyan-700 dark:text-cyan-400 font-semibold">{item.db_name_param || item.db_name}</span>
          </div>
        </div>
        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 shrink-0 bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-1 rounded-md border border-indigo-200 dark:border-indigo-500/30">
          {expanded ? "Hide Details ▲" : "View Details ▼"}
        </span>
      </button>

      {/* Expanded audit params */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/40 mt-1">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Captured Audit Parameters (V$PARAMETER)
            </p>
            <AuditParamRow
              label="Captured At (SYSDATE)"
              value={item.captured_at}
            />
            <AuditParamRow
              label="spfile"
              value={item.spfile_value}
              compliant={spfileCompliant}
            />
            <AuditParamRow
              label="audit_sys_operations"
              value={item.audit_sys_ops}
              compliant={sysOpsCompliant}
            />
            <AuditParamRow
              label="audit_trail"
              value={item.audit_trail}
              compliant={trailCompliant}
            />
            <AuditParamRow
              label="db_name"
              value={item.db_name_param}
            />
          </div>

          {/* Compliance note */}
          <p className="text-[11px] text-muted-foreground/80 italic">
            Note: A blank value of spfile prevents dynamic parameter changes via ALTER SYSTEM.
          </p>

          {/* Failure reasons */}
          {!item.is_compliant && item.failure_reasons && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
              <p className="text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400 mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Compliance Failure Details
              </p>
              <ul className="space-y-1">
                {item.failure_reasons.split(";").map((reason, i) => (
                  <li key={i} className="text-xs text-red-800 dark:text-red-300 flex items-start gap-1.5 font-medium">
                    <span className="text-red-500 mt-0.5">•</span>
                    {reason.trim()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RebootHistoryModal({ open, onOpenChange, db }: RebootHistoryModalProps) {
  const [items, setItems]               = useState<RebootHistoryItem[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Filter and Search states
  const [searchQuery, setSearchQuery]           = useState("");
  const [eventTypeFilter, setEventTypeFilter]   = useState<string>("all");
  const [complianceFilter, setComplianceFilter] = useState<string>("all");

  // Pagination state
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRebootHistory(db, 300);
      setItems(data);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reboot history.");
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, eventTypeFilter, complianceFilter, pageSize]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Event type filter
      if (eventTypeFilter !== "all" && item.event_type !== eventTypeFilter) {
        return false;
      }

      // Compliance filter
      if (complianceFilter === "compliant" && !item.is_compliant) return false;
      if (complianceFilter === "non_compliant" && item.is_compliant) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const searchTarget = [
          item.requested_by,
          item.db_name,
          item.db_name_param,
          item.spfile_value,
          item.audit_sys_ops,
          item.audit_trail,
          item.failure_reasons ?? "",
          item.shutdown_option ?? "",
          item.captured_at
        ]
          .join(" ")
          .toLowerCase();

        if (!searchTarget.includes(query)) return false;
      }

      return true;
    });
  }, [items, eventTypeFilter, complianceFilter, searchQuery]);

  // Pagination calculation
  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage   = Math.min(page, totalPages);

  const startIndex = (safePage - 1) * pageSize;
  const endIndex   = Math.min(startIndex + pageSize, totalItems);
  const currentPageItems = useMemo(() => {
    return filteredItems.slice(startIndex, endIndex);
  }, [filteredItems, startIndex, endIndex]);

  const nonCompliantCount = useMemo(() => {
    return items.filter((i) => !i.is_compliant).length;
  }, [items]);

  const hasActiveFilters = searchQuery !== "" || eventTypeFilter !== "all" || complianceFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setEventTypeFilter("all");
    setComplianceFilter("all");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden p-6 border-border/60">
        {/* Modal Header */}
        <DialogHeader className="shrink-0 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-3 text-lg font-bold">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-md">
                <History className="h-5 w-5" />
              </div>
              <div>
                <span>Reboot History</span>
                <span className="ml-2 font-mono text-sm text-cyan-600 dark:text-cyan-400 font-bold bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-md">
                  {db}
                </span>
              </div>
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin text-indigo-500")} />
              Refresh
            </Button>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Audit compliance snapshots captured before every shutdown and after every startup (PROD only)
          </DialogDescription>
        </DialogHeader>

        {/* Stats & Overview Pills */}
        {!loading && items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{items.length} total records</span>
              </div>

              {nonCompliantCount > 0 ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-400">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>{nonCompliantCount} non-compliant</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>100% Audit Compliant</span>
                </div>
              )}
            </div>

            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="h-7 text-xs border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 font-medium"
              >
                <FilterX className="h-3.5 w-3.5 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
        )}

        {/* Toolbar: Search & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-3 shrink-0">
          {/* Search Input */}
          <div className="relative sm:col-span-6">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search user, param, failure..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8.5 text-xs bg-card border-border/70 focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Event Filter */}
          <div className="sm:col-span-3">
            <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
              <SelectTrigger className="h-8.5 text-xs bg-card border-border/70">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="PRE_SHUTDOWN">Pre-Shutdown</SelectItem>
                <SelectItem value="POST_MOUNT_COMPLIANT">Started (Compliant)</SelectItem>
                <SelectItem value="POST_MOUNT_FAILED">Startup Aborted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Compliance Filter */}
          <div className="sm:col-span-3">
            <Select value={complianceFilter} onValueChange={setComplianceFilter}>
              <SelectTrigger className="h-8.5 text-xs bg-card border-border/70">
                <SelectValue placeholder="Compliance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="compliant">Compliant Only</SelectItem>
                <SelectItem value="non_compliant">Non-Compliant Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Content list */}
        <ScrollArea className="flex-1 min-h-0 pr-1 mt-2">
          <div className="space-y-2.5 py-1">
            {loading && (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                <p className="text-sm font-medium">Loading reboot history…</p>
              </div>
            )}

            {!loading && error && (
              <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 p-6 text-center">
                <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load()} className="mt-3 text-xs">
                  Retry
                </Button>
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <History className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium">No reboot history found for <span className="font-mono text-cyan-600 dark:text-cyan-400">{db}</span></p>
                <p className="text-xs text-muted-foreground/70">
                  Records appear after the first start or stop operation on this PROD database.
                </p>
              </div>
            )}

            {!loading && !error && items.length > 0 && filteredItems.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <FilterX className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">No matching records found</p>
                <p className="text-xs text-muted-foreground/70">Try adjusting your search query or filters.</p>
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2 text-xs">
                  Clear Filters
                </Button>
              </div>
            )}

            {!loading && !error && currentPageItems.map((item) => (
              <RebootHistoryRow key={item.id} item={item} />
            ))}
          </div>
        </ScrollArea>

        {/* Enhanced Pagination Controls */}
        {!loading && !error && filteredItems.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/50 shrink-0">
            {/* Rows info & page size select */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-medium">
                Showing <span className="font-semibold text-foreground">{startIndex + 1}</span>–
                <span className="font-semibold text-foreground">{endIndex}</span> of{" "}
                <span className="font-semibold text-foreground">{totalItems}</span> records
              </span>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground hidden sm:inline">Per page:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(val) => setPageSize(Number(val))}
                >
                  <SelectTrigger className="h-7 w-16 text-xs bg-card border-border/70 px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage <= 1}
                onClick={() => setPage(1)}
                title="First Page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => p - 1)}
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              <span className="px-2 text-xs font-semibold text-foreground">
                {safePage} / {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage(totalPages)}
                title="Last Page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
