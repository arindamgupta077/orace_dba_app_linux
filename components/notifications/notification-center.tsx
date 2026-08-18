"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  DatabaseZap,
  FileClock,
  FileText,
  FileWarning,
  Filter,
  HardDrive,
  Info,
  Inbox,
  Layers,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  StopCircle,
  Tag,
  UserCheck,
  X,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchNotificationHistory } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn, formatAppDateTime, stripHtmlText } from "@/lib/utils";
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
    case "database_start":
      return <Play className="h-4 w-4" />;
    case "database_stop":
      return <StopCircle className="h-4 w-4" />;
    case "listener_start":
    case "listener_stop":
      return <Radio className="h-4 w-4" />;
    case "approval_workflow":
      return <FileText className="h-4 w-4" />;
    case "datapump":
      return <DatabaseZap className="h-4 w-4" />;
    case "rman":
      return <Archive className="h-4 w-4" />;
    default:
      return <Bell className="h-4 w-4" />;
  }
}

function getTypeLabel(t: string) {
  switch (t) {
    case "tablespace":
      return "Tablespace Capacity";
    case "filesystem_drive":
      return "Filesystem Usage";
    case "db_monitoring":
      return "DB Monitoring";
    case "database_start":
      return "Database Start";
    case "database_stop":
      return "Database Stop";
    case "listener_start":
      return "Listener Start";
    case "listener_stop":
      return "Listener Stop";
    case "approval_workflow":
      return "Approval Request";
    case "alert_log":
      return "Alert Log Warning";
    case "dba_shift":
      return "DBA Shift Activity";
    case "expdp":
      return "EXPDP";
    case "impdp":
      return "IMPDP";
    case "datapump":
      return "Data Pump";
    case "rman":
      return "RMAN Backup";
    default:
      return t;
  }
}

function getSeverityBadge(severity: NotificationRecord["severity"]) {
  switch (severity) {
    case "critical":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-500/25 shadow-xs">
          <XCircle className="h-3 w-3" /> Critical
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-semibold text-orange-600 dark:text-orange-400 border border-orange-500/25 shadow-xs">
          <AlertTriangle className="h-3 w-3" /> Error
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 border border-amber-500/25 shadow-xs">
          <AlertTriangle className="h-3 w-3" /> Warning
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/25 shadow-xs">
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
  if (s === "up") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 uppercase tracking-wide">
        <CheckCircle2 className="h-3 w-3" /> Up
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

  const user = useAppStore((s) => s.user);
  const databases = useAppStore((s) => s.databases);
  const rawNotifications = useAppStore((s) => s.notifications);
  const setSelectedDb = useAppStore((s) => s.setSelectedDb);
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

  const activeFilterCount =
    (category !== "all" ? 1 : 0) +
    (type !== "all" ? 1 : 0) +
    (severity !== "all" ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (selectedDb !== "" ? 1 : 0) +
    (dateRange !== "all" ? 1 : 0) +
    (search !== "" ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-background via-card to-background p-6 shadow-xs">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-cyan-500/5 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20 ring-4 ring-cyan-500/10">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Notification Center</h1>
                <span className="rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                  Live Archive
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/80 px-2.5 py-0.5 text-xs font-medium text-foreground border border-border/60">
                  <Archive className="h-3 w-3 text-cyan-500" />
                  <span>Total Archived: <strong className="font-semibold text-cyan-600 dark:text-cyan-400">{total}</strong></span>
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-2xl">
                Comprehensive audit trail and live telemetry stream for database capacity alerts, system health anomalies & DBA console shift events.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                markAllNotificationsRead(category === "all" ? undefined : category);
                setItems((prev) => prev.map((i) => ({ ...i, read: true })));
              }}
              className="gap-1.5 border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all shadow-xs"
            >
              <Check className="h-4 w-4" />
              <span>Mark All Read</span>
            </Button>

            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5 border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            >
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" />
                <span>Dashboard</span>
              </Link>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData()}
              disabled={loading}
              className="gap-1.5 border-border/80 text-foreground hover:bg-muted/50 transition-all"
            >
              <RefreshCw className={cn("h-4 w-4 text-cyan-500", loading && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Control & Filter Panel */}
      <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 space-y-4 shadow-xs">
        {/* Category Tabs Header & Filter Summary */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted/70 p-1 border border-border/40">
            <button
              onClick={() => handleCategoryChange("all")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer",
                category === "all"
                  ? "bg-background text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <Layers className="h-3.5 w-3.5 opacity-70" />
              <span>All Notifications</span>
            </button>

            <button
              onClick={() => handleCategoryChange("db")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer",
                category === "db"
                  ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 ring-1 ring-cyan-500/30 shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <Database className="h-3.5 w-3.5 text-cyan-500" />
              <span>Database Alerts</span>
            </button>

            <button
              onClick={() => handleCategoryChange("console")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer",
                category === "console"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30 shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <UserCheck className="h-3.5 w-3.5 text-amber-500" />
              <span>DBA Console Activities</span>
            </button>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:text-rose-700 gap-1.5 self-start sm:self-auto border border-rose-500/20"
            >
              <X className="h-3.5 w-3.5" />
              <span>Reset All ({activeFilterCount})</span>
            </Button>
          )}
        </div>

        {/* Search Bar & Dropdown Controls */}
        <div className="space-y-3">
          {/* Top Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/70" />
            <input
              type="text"
              placeholder="Search by title, error message, database SID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-background/80 pl-9 pr-9 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 transition-all duration-200 focus:border-cyan-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/20 shadow-xs"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-3 top-2.5 rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter Bar for APP_ADMIN */}
          {user?.role === "app_admin" && category === "db" && (
            <div className="flex flex-wrap items-center gap-2 mb-3.5 border-b border-border/40 pb-3">
              <span className="text-xs font-semibold text-muted-foreground">Quick Filter:</span>
              <button
                type="button"
                onClick={() => {
                  setType("all");
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border transition-all",
                  type === "all"
                    ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-semibold shadow-xs"
                    : "border-border/60 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                All Database Alerts
              </button>
              <button
                type="button"
                onClick={() => {
                  setType("approval_workflow");
                  setPage(1);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-all",
                  type === "approval_workflow"
                    ? "border-amber-500/60 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold shadow-xs"
                    : "border-border/60 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <FileClock className="h-3.5 w-3.5 text-amber-500" />
                <span>Approval Workflow Only</span>
              </button>
            </div>
          )}

          {/* Filter Inputs Grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {/* Alert Type */}
            <div className="relative">
              <SlidersHorizontal className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-border/80 bg-background/80 pl-8 pr-3 py-1.5 text-xs text-foreground transition-all focus:border-cyan-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              >
                <option value="all">All Alert Types</option>
                <option value="tablespace">Tablespace Capacity</option>
                <option value="filesystem_drive">Filesystem Usage</option>
                <option value="db_monitoring">Database Monitoring</option>
                <option value="database_start">Database Start</option>
                <option value="database_stop">Database Stop</option>
                <option value="listener_start">Listener Start</option>
                <option value="listener_stop">Listener Stop</option>
                <option value="approval_workflow">Approval Requests</option>
                <option value="alert_log">Alert Log Warnings</option>
                <option value="expdp">Data Pump (EXPDP)</option>
                <option value="impdp">Data Pump (IMPDP)</option>
                <option value="rman">RMAN Backups</option>
                <option value="dba_shift">DBA Console Shifts</option>
              </select>
            </div>

            {/* Severity */}
            <div className="relative">
              <ShieldAlert className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
              <select
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-border/80 bg-background/80 pl-8 pr-3 py-1.5 text-xs text-foreground transition-all focus:border-cyan-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Information</option>
              </select>
            </div>

            {/* Status */}
            <div className="relative">
              <Tag className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-border/80 bg-background/80 pl-8 pr-3 py-1.5 text-xs text-foreground transition-all focus:border-cyan-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
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
            <div className="relative">
              <Database className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
              <select
                value={selectedDb}
                onChange={(e) => {
                  setSelectedDbFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-border/80 bg-background/80 pl-8 pr-3 py-1.5 text-xs text-foreground transition-all focus:border-cyan-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
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
            <div className="relative">
              <Calendar className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
              <select
                value={dateRange}
                onChange={(e) => {
                  setDateRange(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-border/80 bg-background/80 pl-8 pr-3 py-1.5 text-xs text-foreground transition-all focus:border-cyan-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>
          </div>

          {/* Custom Date Range Pickers */}
          {dateRange === "custom" && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
              <span className="text-xs font-medium text-muted-foreground">Custom Range:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-border/80 bg-background/80 px-3 py-1 text-xs text-foreground focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-border/80 bg-background/80 px-3 py-1 text-xs text-foreground focus:border-cyan-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Active Filter Chips Bar */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/50">
            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3 text-cyan-500" /> Active Filters:
            </span>

            {category !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300 border border-cyan-500/25">
                <span>Category: {category === "db" ? "Database Alerts" : "DBA Console"}</span>
                <button onClick={() => handleCategoryChange("all")} className="hover:opacity-70 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {search && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-foreground border border-border/60">
                <span>Search: &quot;{search}&quot;</span>
                <button
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                  }}
                  className="hover:opacity-70 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {type !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300 border border-blue-500/25">
                <span>Type: {getTypeLabel(type)}</span>
                <button onClick={() => { setType("all"); setPage(1); }} className="hover:opacity-70 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {severity !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 border border-amber-500/25">
                <span className="capitalize">Severity: {severity}</span>
                <button onClick={() => { setSeverity("all"); setPage(1); }} className="hover:opacity-70 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {status !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                <span className="capitalize">Status: {status.replace("_", " ")}</span>
                <button onClick={() => { setStatus("all"); setPage(1); }} className="hover:opacity-70 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {selectedDb && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-medium text-purple-700 dark:text-purple-300 border border-purple-500/25">
                <span>DB: {selectedDb}</span>
                <button onClick={() => { setSelectedDbFilter(""); setPage(1); }} className="hover:opacity-70 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}

            {dateRange !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 border border-indigo-500/25">
                <span className="capitalize">Time: {dateRange}</span>
                <button
                  onClick={() => {
                    setDateRange("all");
                    setStartDate("");
                    setEndDate("");
                    setPage(1);
                  }}
                  className="hover:opacity-70 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Content Feed List */}
      <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
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
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-4 p-4 rounded-xl border border-border/40 bg-muted/20 animate-pulse">
                <div className="h-9 w-9 rounded-xl bg-muted shrink-0" />
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
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 mb-3 shadow-xs">
              <Inbox className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-foreground">No notifications found</p>
            <p className="text-xs text-muted-foreground max-w-sm mt-1 leading-relaxed">
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
              const lowerTitle = (item.title || "").toLowerCase();
              const lowerMsg = (item.message || "").toLowerCase();
              const isDp = item.type === "datapump" || lowerTitle.includes("expdp") || lowerTitle.includes("impdp") || lowerMsg.includes("expdp") || lowerMsg.includes("impdp");
              const isRman = item.type === "rman" || lowerTitle.includes("rman") || lowerMsg.includes("rman");
              const isLifecycle = item.type === "database_start" || item.type === "database_stop" || item.type === "listener_start" || item.type === "listener_stop" || item.type === "db_monitoring";
              const resolvedTarget = isDp ? "/data-pump" : isRman ? "/backups" : isLifecycle ? "/general-admin" : (item.targetPath || "#");
              const ContentWrapper = resolvedTarget && resolvedTarget !== "#" ? Link : "div";
              const isConsole = item.category === "console";
              return (
                <ContentWrapper
                  key={item.id}
                  href={resolvedTarget}
                  onClick={() => {
                    if (item.db) setSelectedDb(item.db);
                  }}
                  className={cn(
                    "flex flex-col gap-3 p-4 sm:flex-row sm:items-start transition-all duration-150 hover:bg-muted/30 cursor-pointer group relative",
                    !item.read && (isConsole ? "bg-amber-500/[0.03] border-l-4 border-l-amber-500" : "bg-cyan-500/[0.03] border-l-4 border-l-cyan-500")
                  )}
                >
                  {/* Category / Source Icon */}
                  <div className="flex shrink-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl border shadow-xs transition-transform duration-200 group-hover:scale-105",
                        isConsole
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                          : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30"
                      )}
                    >
                      {getNotificationIcon(item.type)}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {!item.read && <span className="h-2 w-2 rounded-full bg-cyan-500 shrink-0 animate-pulse" title="Unread" />}
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border border-border/50">
                        {getTypeLabel(item.type)}
                      </span>
                      {getSeverityBadge(item.severity)}
                      {getStatusBadge(item.status)}
                      {item.db && (
                        <span className="rounded-md bg-muted/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground border border-border/50">
                          {item.db}
                        </span>
                      )}

                      {/* Read status without highlighted background */}
                      {item.read ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-normal">
                          <Check className="h-3 w-3 text-emerald-500/80 shrink-0" />
                          <span>
                            Read by <span className="font-medium text-foreground/80">{item.readBy || "system"}</span>
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
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 transition-all hover:bg-cyan-500/20 hover:border-cyan-500/50 shadow-xs"
                        >
                          <Check className="h-3 w-3" /> Mark read
                        </button>
                      )}

                      <span className="text-[11px] text-muted-foreground/80 ml-auto font-medium">
                        {formatDate(item.timestamp)}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-foreground group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{stripHtmlText(item.message)}</p>
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
                className="rounded-lg border border-border/70 bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
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
