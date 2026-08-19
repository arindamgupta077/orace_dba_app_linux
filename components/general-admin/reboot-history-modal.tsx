"use client";

import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  FilterX,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  cn,
  downloadText,
  parseAppTimestamp,
  toCsv,
  toIstDateString,
  toIstDateStringOffset
} from "@/lib/utils";
import { exportDataset, exportRebootHistoryPdf, type ExportColumn } from "@/lib/export";
import { fetchRebootHistory } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { RebootHistoryItem } from "@/types/dba";
import { toast } from "sonner";

interface RebootHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: string;
}

type DatePreset = "all" | "today" | "yesterday" | "last7" | "last30" | "custom";

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
  const user = useAppStore((state) => state.user);

  const [items, setItems]               = useState<RebootHistoryItem[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Filter and Search states
  const [searchQuery, setSearchQuery]           = useState("");
  const [eventTypeFilter, setEventTypeFilter]   = useState<string>("all");
  const [complianceFilter, setComplianceFilter] = useState<string>("all");

  // Date and Date Range filter states
  const [datePreset, setDatePreset]             = useState<DatePreset>("all");
  const [fromDate, setFromDate]                 = useState<string>("");
  const [toDate, setToDate]                     = useState<string>("");

  // Pagination state
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRebootHistory(db, 500);
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

  // Apply Date Preset changes
  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === "all") {
      setFromDate("");
      setToDate("");
    } else if (preset === "today") {
      const today = toIstDateString();
      setFromDate(today);
      setToDate(today);
    } else if (preset === "yesterday") {
      const yesterday = toIstDateStringOffset(new Date(), -1);
      setFromDate(yesterday);
      setToDate(yesterday);
    } else if (preset === "last7") {
      const start = toIstDateStringOffset(new Date(), -6);
      const end = toIstDateString();
      setFromDate(start);
      setToDate(end);
    } else if (preset === "last30") {
      const start = toIstDateStringOffset(new Date(), -29);
      const end = toIstDateString();
      setFromDate(start);
      setToDate(end);
    }
  };

  const handleFromDateChange = (val: string) => {
    setFromDate(val);
    setDatePreset("custom");
  };

  const handleToDateChange = (val: string) => {
    setToDate(val);
    setDatePreset("custom");
  };

  // Reset page when any filter changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, eventTypeFilter, complianceFilter, fromDate, toDate, pageSize]);

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

      // Date / Date range filter (IST-aware calendar date comparison)
      if (fromDate || toDate) {
        let itemDateStr = "";
        if (item.created_at) {
          itemDateStr = toIstDateString(parseAppTimestamp(item.created_at));
        } else if (item.captured_at) {
          itemDateStr = item.captured_at.slice(0, 10);
        }

        if (itemDateStr) {
          if (fromDate && itemDateStr < fromDate) return false;
          if (toDate && itemDateStr > toDate) return false;
        }
      }

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
          item.captured_at,
          item.created_at
        ]
          .join(" ")
          .toLowerCase();

        if (!searchTarget.includes(query)) return false;
      }

      return true;
    });
  }, [items, eventTypeFilter, complianceFilter, fromDate, toDate, searchQuery]);

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

  const hasActiveFilters =
    searchQuery !== "" ||
    eventTypeFilter !== "all" ||
    complianceFilter !== "all" ||
    fromDate !== "" ||
    toDate !== "" ||
    datePreset !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setEventTypeFilter("all");
    setComplianceFilter("all");
    setDatePreset("all");
    setFromDate("");
    setToDate("");
  };

  // Period label for export and badge display
  const periodLabel = useMemo(() => {
    if (fromDate && toDate) {
      return fromDate === toDate ? `Date: ${fromDate}` : `${fromDate} to ${toDate}`;
    }
    if (fromDate) return `From ${fromDate}`;
    if (toDate) return `Up to ${toDate}`;
    return "All Time";
  }, [fromDate, toDate]);

  // ── PDF & File Export Handlers ──────────────────────────────────────────────
  const handleExportPdf = () => {
    if (filteredItems.length === 0) {
      toast.error("No records match the current filters to export.");
      return;
    }

    const activeFiltersList = [];
    if (eventTypeFilter !== "all") activeFiltersList.push(`Event: ${eventTypeFilter}`);
    if (complianceFilter !== "all") activeFiltersList.push(`Compliance: ${complianceFilter}`);
    if (fromDate || toDate) activeFiltersList.push(`Range: ${periodLabel}`);
    if (searchQuery.trim()) activeFiltersList.push(`Search: "${searchQuery.trim()}"`);

    const filterLabel = activeFiltersList.join(", ") || "All Records";

    exportRebootHistoryPdf(filteredItems, {
      title: `Reboot History & Compliance Audit`,
      dbName: db,
      exportedBy: user?.username || "app_admin",
      periodLabel,
      filterLabel
    });
  };

  const handleExportExcel = () => {
    if (filteredItems.length === 0) {
      toast.error("No records to export.");
      return;
    }

    const columns: ExportColumn<RebootHistoryItem>[] = [
      { header: "Timestamp (IST)", value: (row) => row.created_at ? formatTimestamp(row.created_at) : (row.captured_at || "—") },
      { header: "Event Type", value: (row) => row.event_type },
      { header: "Requested By", value: (row) => row.requested_by },
      { header: "Shutdown Option", value: (row) => row.shutdown_option || "—" },
      { header: "Compliance", value: (row) => (row.is_compliant ? "COMPLIANT" : "NON_COMPLIANT") },
      { header: "spfile", value: (row) => row.spfile_value || "(blank) [OK]" },
      { header: "audit_sys_ops", value: (row) => row.audit_sys_ops || "—" },
      { header: "audit_trail", value: (row) => row.audit_trail || "—" },
      { header: "Failure Reasons", value: (row) => row.failure_reasons || "—" }
    ];

    const activeFiltersList = [];
    if (eventTypeFilter !== "all") activeFiltersList.push(`Event: ${eventTypeFilter}`);
    if (complianceFilter !== "all") activeFiltersList.push(`Compliance: ${complianceFilter}`);
    if (fromDate || toDate) activeFiltersList.push(`Date: ${periodLabel}`);
    if (searchQuery.trim()) activeFiltersList.push(`Search: "${searchQuery.trim()}"`);

    exportDataset("excel", columns, filteredItems, {
      title: `Reboot History — ${db}`,
      exportedBy: user?.username || "app_admin",
      periodLabel,
      filterLabel: activeFiltersList.join(", ") || "All Filters"
    });
  };

  const handleExportCsv = () => {
    if (filteredItems.length === 0) {
      toast.error("No records to export.");
      return;
    }
    const cleanDb = db.toLowerCase().replace(/[^a-z0-9]/gi, "_");
    downloadText(`reboot_history_${cleanDb}.csv`, toCsv(filteredItems), "text/csv");
    toast.success("CSV file downloaded successfully.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col overflow-hidden p-6 border-border/60">
        {/* Modal Header */}
        <DialogHeader className="shrink-0 pb-3 border-b border-border/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
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

            <div className="flex items-center gap-2">
              {/* PDF & Data Export Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || items.length === 0}
                    className="h-8 text-xs font-semibold border-indigo-200 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20 shadow-2xs gap-1.5"
                    title="Export Reboot History Report"
                  >
                    <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs">Export Options</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportPdf} className="cursor-pointer text-xs font-medium">
                    <FileText className="mr-2 h-4 w-4 text-rose-500" />
                    <span>Export to PDF (.pdf)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer text-xs font-medium">
                    <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
                    <span>Export to Excel (.xlsx)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportCsv} className="cursor-pointer text-xs font-medium">
                    <FileText className="mr-2 h-4 w-4 text-blue-500" />
                    <span>Export to CSV (.csv)</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Refresh Button */}
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

              {hasActiveFilters && (
                <div className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  <FilterX className="h-3 w-3" />
                  <span>{filteredItems.length} matching</span>
                </div>
              )}

              {(fromDate || toDate) && (
                <div className="flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-800 dark:text-cyan-300">
                  <CalendarRange className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
                  <span>{periodLabel}</span>
                </div>
              )}

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
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
        )}

        {/* Toolbar: Search, Event & Compliance Filters, Date / Date-Range Filter */}
        <div className="space-y-2.5 pt-3 shrink-0">
          {/* Row 1: Search + Event Type + Compliance Status */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            {/* Search Input */}
            <div className="relative sm:col-span-6">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search DBA user, param, failure reason..."
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

          {/* Row 2: Date Filtering (Preset + From Date + To Date + Quick Action) */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-muted/25 p-2 rounded-lg border border-border/50">
            {/* Date Preset Selector */}
            <div className="sm:col-span-3 flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={datePreset} onValueChange={(val) => applyDatePreset(val as DatePreset)}>
                <SelectTrigger className="h-8 text-xs bg-card border-border/70">
                  <SelectValue placeholder="Date Preset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="last7">Last 7 Days</SelectItem>
                  <SelectItem value="last30">Last 30 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* From Date Picker */}
            <div className="sm:col-span-4 flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground shrink-0 w-9">From:</span>
              <div className="relative flex-1">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                  className="h-8 text-xs bg-card border-border/70 px-2 py-1"
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>

            {/* To Date Picker */}
            <div className="sm:col-span-4 flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground shrink-0 w-6">To:</span>
              <div className="relative flex-1">
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => handleToDateChange(e.target.value)}
                  className="h-8 text-xs bg-card border-border/70 px-2 py-1"
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>

            {/* Reset Dates Button */}
            <div className="sm:col-span-1 flex justify-end">
              {(fromDate || toDate) && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => applyDatePreset("all")}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Clear Date Filter"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 min-h-[260px] max-h-[50vh] overflow-y-auto pr-1 mt-2 space-y-2.5 py-1">
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
              <p className="text-xs text-muted-foreground/70">
                Try adjusting your search query, compliance filter, or date range.
              </p>
              <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2 text-xs">
                Clear Filters
              </Button>
            </div>
          )}

          {!loading && !error && currentPageItems.map((item) => (
            <RebootHistoryRow key={item.id} item={item} />
          ))}
        </div>

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
