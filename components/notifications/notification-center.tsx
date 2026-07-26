"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  FileWarning,
  HardDrive,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  X,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchNotificationHistory } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn, formatAppDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NotificationRecord {
  id: string;
  type: string;
  category: "db" | "console";
  severity: "info" | "warning" | "critical" | "error";
  status?: string;
  db?: string;
  title: string;
  message: string;
  timestamp: string;
  updatedAt?: string;
  targetPath?: string;
  read?: boolean;
  readBy?: string;
  readAt?: string;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "tablespace":
      return <Database className="h-4 w-4" />;
    case "filesystem_drive":
      return <HardDrive className="h-4 w-4" />;
    case "alert_log":
      return <FileWarning className="h-4 w-4" />;
    case "dba_shift":
      return <UserCheck className="h-4 w-4" />;
    case "db_monitoring":
      return <ShieldAlert className="h-4 w-4" />;
    case "approval_workflow":
      return <FileText className="h-4 w-4" />;
    default:
      return <Bell className="h-4 w-4" />;
  }
}

function getSeverityBadge(severity: NotificationRecord["severity"]) {
  switch (severity) {
    case "critical":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-500/30">
          <XCircle className="h-3 w-3" /> Critical
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-semibold text-orange-600 dark:text-orange-400 border border-orange-500/30">
          <AlertTriangle className="h-3 w-3" /> Error
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2.5 py-0.5 text-xs font-semibold text-yellow-700 dark:text-yellow-400 border border-yellow-500/30">
          <AlertTriangle className="h-3 w-3" /> Warning
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/30">
          <Info className="h-3 w-3" /> Information
        </span>
      );
  }
}

function getStatusBadge(status?: string) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "down") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:text-red-400 border border-red-500/30 uppercase tracking-wide">
        <XCircle className="h-3 w-3" /> Down
      </span>
    );
  }
  if (s === "approved" || s === "completed" || s === "acknowledged") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 capitalize">
        <CheckCircle2 className="h-3 w-3" /> {status.replace("_", " ")}
      </span>
    );
  }
  if (s === "pending" || s === "pending_approval" || s === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 border border-amber-500/30 capitalize">
        <Loader2 className="h-3 w-3 animate-spin" /> {status.replace("_", " ")}
      </span>
    );
  }
  if (s === "rejected" || s === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300 border border-red-500/30 capitalize">
        <XCircle className="h-3 w-3" /> {status.replace("_", " ")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/50 capitalize">
      {status.replace("_", " ")}
    </span>
  );
}

function formatDate(isoString: string) {
  try {
    return formatAppDateTime(isoString);
  } catch {
    return isoString;
  }
}

export function NotificationCenter() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");

  const databases = useAppStore((s) => s.databases);
  const rawNotifications = useAppStore((s) => s.notifications);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);

  // Filter & Pagination States
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [category, setCategory] = useState<"all" | "db" | "console">(() => {
    if (categoryParam === "db" || categoryParam === "console") {
      return categoryParam;
    }
    return "all";
  });
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedDb, setSelectedDbFilter] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Data States
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNotificationHistory({
        page,
        pageSize,
        category,
        type,
        severity,
        status,
        db: selectedDb,
        dateRange,
        startDate: dateRange === "custom" && startDate ? new Date(startDate).toISOString() : undefined,
        endDate: dateRange === "custom" && endDate ? new Date(endDate).toISOString() : undefined,
        search
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notification history.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, category, type, severity, status, selectedDb, dateRange, startDate, endDate, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync category when URL search parameter changes
  useEffect(() => {
    if (categoryParam === "db" || categoryParam === "console") {
      setCategory(categoryParam);
      setPage(1);
    } else if (categoryParam === "all") {
      setCategory("all");
      setPage(1);
    }
  }, [categoryParam]);

  // Re-sync items when real-time SSE notifications arrive or read status changes in store
  useEffect(() => {
    setItems((prevItems) =>
      prevItems.map((item) => {
        const storeMatch = rawNotifications.find((n) => String(n.id) === String(item.id));
        if (storeMatch && storeMatch.read) {
          return {
            ...item,
            read: true,
            readBy: storeMatch.readBy || item.readBy,
            readAt: storeMatch.readAt || item.readAt
          };
        }
        return item;
      })
    );
  }, [rawNotifications]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleCategoryChange = (newCategory: "all" | "db" | "console") => {
    setCategory(newCategory);
    setPage(1);
    const newUrl = newCategory === "all" ? "/notifications" : `/notifications?category=${newCategory}`;
    window.history.replaceState(null, "", newUrl);
  };

  const resetFilters = () => {
    handleCategoryChange("all");
    setType("all");
    setSeverity("all");
    setStatus("all");
    setSelectedDbFilter("");
    setDateRange("all");
    setStartDate("");
    setEndDate("");
    setSearchInput("");
    setSearch("");
  };

  const hasActiveFilters =
    category !== "all" ||
    type !== "all" ||
    severity !== "all" ||
    status !== "all" ||
    selectedDb !== "" ||
    dateRange !== "all" ||
    search !== "";

  // Summary stats
  const criticalCount = items.filter((i) => i.severity === "critical" || i.severity === "error").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;
  const infoCount = items.filter((i) => i.severity === "info").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Notification Center</h1>
              <p className="text-xs text-muted-foreground">
                Historical archive of all database alerts, monitoring incidents & DBA console activities.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              markAllNotificationsRead(category === "all" ? undefined : category);
              setItems((prev) => prev.map((i) => ({ ...i, read: true })));
            }}
            className="gap-1.5 border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Mark All Read</span>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-1.5 border-border/70 text-muted-foreground hover:text-foreground"
          >
            <Link href="/dashboard">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Dashboard</span>
            </Link>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData()}
            disabled={loading}
            className="gap-1.5 border-border/70"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span>Refresh Archive</span>
          </Button>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Total Archived</p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{total}</p>
        </div>

        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 shadow-sm">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">Critical / Error</p>
          <p className="mt-1 text-2xl font-extrabold text-red-600 dark:text-red-400">{criticalCount}</p>
        </div>

        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 shadow-sm">
          <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">Warnings</p>
          <p className="mt-1 text-2xl font-extrabold text-yellow-700 dark:text-yellow-400">{warningCount}</p>
        </div>

        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 shadow-sm">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Information</p>
          <p className="mt-1 text-2xl font-extrabold text-blue-600 dark:text-blue-400">{infoCount}</p>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="rounded-xl border border-border/70 bg-card p-4 space-y-4 shadow-sm">
        {/* Category Tabs */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              onClick={() => handleCategoryChange("all")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-all",
                category === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All Notifications
            </button>
            <button
              onClick={() => handleCategoryChange("db")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                category === "db" ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Database className="h-3.5 w-3.5" />
              Database Alerts
            </button>
            <button
              onClick={() => handleCategoryChange("console")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                category === "console" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UserCheck className="h-3.5 w-3.5" />
              DBA Console Activities
            </button>
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs text-muted-foreground hover:text-foreground gap-1">
              <X className="h-3.5 w-3.5" /> Reset Filters
            </Button>
          )}
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search title, message, DB..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Alert Type */}
          <div>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All Alert Types</option>
              <option value="tablespace">Tablespace Capacity</option>
              <option value="filesystem_drive">Filesystem Usage</option>
              <option value="db_monitoring">Database Monitoring</option>
              <option value="approval_workflow">Approval Requests</option>
              <option value="alert_log">Alert Log Warnings</option>
              <option value="dba_shift">DBA Console Shifts</option>
            </select>
          </div>

          {/* Severity */}
          <div>
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Information</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="DOWN">DB DOWN (Active)</option>
            </select>
          </div>

          {/* Database Selector */}
          <div>
            <select
              value={selectedDb}
              onChange={(e) => {
                setSelectedDbFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">All Databases</option>
              {databases.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div>
            <select
              value={dateRange}
              onChange={(e) => {
                setDateRange(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {/* Custom Date Range Pickers */}
          {dateRange === "custom" && (
            <>
              <div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Content Feed List */}
      <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <XCircle className="h-10 w-10 text-red-500 mb-3" />
            <p className="text-base font-semibold text-foreground">Failed to load notifications</p>
            <p className="text-xs text-muted-foreground max-w-md mt-1">{error}</p>
            <Button variant="outline" size="sm" onClick={() => loadData()} className="mt-4 gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Try Again
            </Button>
          </div>
        ) : loading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-4 p-4 rounded-lg border border-border/40 bg-muted/20 animate-pulse">
                <div className="h-8 w-8 rounded-lg bg-muted shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-1/4 rounded bg-muted" />
                  <div className="h-3 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 mb-3">
              <Bell className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-foreground">No notifications found</p>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              No historical notifications match your current filter selection or search query.
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={resetFilters} className="mt-4 gap-1.5">
                <X className="h-3.5 w-3.5" /> Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {items.map((item) => {
              const ContentWrapper = item.targetPath ? Link : "div";
              return (
                <ContentWrapper
                  key={item.id}
                  href={item.targetPath || "#"}
                  className={cn(
                    "flex flex-col gap-3 p-4 sm:flex-row sm:items-start transition-colors hover:bg-muted/30 cursor-pointer"
                  )}
                >
                  {/* Category / Source Icon */}
                  <div className="flex shrink-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm",
                        item.category === "console"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                          : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30"
                      )}
                    >
                      {getNotificationIcon(item.type)}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!item.read && <span className="h-2 w-2 rounded-full bg-cyan-500 shrink-0" title="Unread" />}
                      {getSeverityBadge(item.severity)}
                      {getStatusBadge(item.status)}
                      {item.db && (
                        <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground border border-border/50">
                          {item.db}
                        </span>
                      )}
                      {item.read ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 dark:bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                          <span>
                            Read by <strong className="font-semibold">{item.readBy || "system"}</strong>
                            {item.readAt && <> at {formatDate(item.readAt)}</>}
                          </span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            markNotificationRead(item.id);
                            const storeUser = useAppStore.getState().user?.username || "system";
                            const nowIso = new Date().toISOString();
                            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true, readBy: i.readBy || storeUser, readAt: i.readAt || nowIso } : i)));
                          }}
                          className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 transition-colors hover:bg-cyan-500/30"
                        >
                          <Check className="h-3 w-3" /> Mark read
                        </button>
                      )}
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {formatDate(item.timestamp)}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.message}</p>
                  </div>
                </ContentWrapper>
              );
            })}
          </div>
        )}

        {/* Server-Side Pagination Footer */}
        {!loading && !error && total > 0 && (
          <div className="flex flex-col gap-3 border-t border-border/70 bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded border border-border/70 bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="ml-2 font-medium">
                Showing {Math.min((page - 1) * pageSize + 1, total)} - {Math.min(page * pageSize, total)} of {total} items
              </span>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-xs font-semibold text-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
