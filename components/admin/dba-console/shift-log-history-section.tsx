"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  History,
  RefreshCw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchShiftSessionLogs } from "@/services/api";
import { cn, formatDateTime, toIstDateString, toIstDateStringOffset } from "@/lib/utils";
import type { NotificationPayload, ShiftSession } from "@/types/dba";

function formatShiftDuration(loginAt: string, logoutAt?: string): string {
  if (!loginAt) return "—";
  const start = new Date(loginAt).getTime();
  const end = logoutAt ? new Date(logoutAt).getTime() : Date.now();
  if (isNaN(start) || isNaN(end) || end < start) return "—";

  const diffMs = end - start;
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  }
  return `${hours}h ${mins}m`;
}

const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (07:00 - 15:30)",
  2: "Shift 2 (14:30 - 23:00)",
  3: "Shift 3 (22:30 - 07:00)",
  4: "General Shift"
};

const AVATAR_COLORS = [
  "border-cyan-500/30 bg-cyan-500/15 text-cyan-300",
  "border-amber-500/30 bg-amber-500/15 text-amber-300",
  "border-green-500/30 bg-green-500/15 text-green-300",
  "border-red-500/30 bg-red-500/15 text-red-300",
  "border-blue-500/30 bg-blue-500/15 text-blue-300",
  "border-purple-500/30 bg-purple-500/15 text-purple-300"
];

function avatarFromName(name: string): { initials: string; color: string } {
  const initials = name.slice(0, 2).toUpperCase();
  const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return { initials, color };
}

function DbaAvatar({ name, className }: { name: string; className?: string }) {
  const { initials, color } = avatarFromName(name);
  return (
    <span className={cn("dba-avatar h-8 w-8 border", color, className)}>
      {initials}
    </span>
  );
}

interface ShiftLogHistorySectionProps {
  className?: string;
  fromDate?: string;
  toDate?: string;
  dbaUserId?: number;
  shiftNumber?: number;
  hideViewFullHistoryButton?: boolean;
  pageSize?: number;
}

type ShiftLogStatusFilter = "ALL" | "ACTIVE" | "CLOSED" | "EMERGENCY" | "FORCE_CLOSED";

export function ShiftLogHistorySection({
  className,
  fromDate,
  toDate,
  dbaUserId,
  shiftNumber,
  hideViewFullHistoryButton = false,
  pageSize = 5
}: ShiftLogHistorySectionProps) {
  const [sessionLogs, setSessionLogs] = useState<ShiftSession[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsSearch, setLogsSearch] = useState("");
  const [logsStatusFilter, setLogsStatusFilter] = useState<ShiftLogStatusFilter>("ALL");
  const [showLogsHistory, setShowLogsHistory] = useState(false);
  const [selectedEmergencySession, setSelectedEmergencySession] = useState<ShiftSession | null>(null);
  const [selectedForceClosedSession, setSelectedForceClosedSession] = useState<ShiftSession | null>(null);
  const [logsPage, setLogsPage] = useState(0);
  const logsPageSize = hideViewFullHistoryButton ? pageSize : 10;
  const defaultFromDate = useMemo(() => toIstDateStringOffset(new Date(), -30), []);
  const defaultToDate = useMemo(() => toIstDateString(), []);

  const [logsDateFrom, setLogsDateFrom] = useState<string>(() => defaultFromDate);
  const [logsDateTo, setLogsDateTo] = useState<string>(() => defaultToDate);

  const loadSessionLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const effectiveFromDate = fromDate || logsDateFrom;
      const effectiveToDate = toDate || logsDateTo;
      const limit = 500;
      const result = await fetchShiftSessionLogs(limit, {
        fromDate: effectiveFromDate || undefined,
        toDate: effectiveToDate || undefined,
        dbaUserId,
        shiftNumber
      });
      setSessionLogs(result.sessions || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shift session logs.");
    } finally {
      setLogsLoading(false);
    }
  }, [fromDate, toDate, logsDateFrom, logsDateTo, dbaUserId, shiftNumber]);

  useEffect(() => {
    setLogsPage(0);
    void loadSessionLogs();
  }, [loadSessionLogs]);

  // Listen to real-time notification stream events to update immediately on shift changes
  useEffect(() => {
    const handleNotification = (event: Event) => {
      const customEvent = event as CustomEvent<NotificationPayload>;
      if (customEvent.detail?.type === "dba_shift") {
        void loadSessionLogs();
      }
    };
    window.addEventListener("dba-notification", handleNotification);
    return () => {
      window.removeEventListener("dba-notification", handleNotification);
    };
  }, [loadSessionLogs]);

  const filteredLogs = useMemo(() => {
    return sessionLogs.filter((log) => {
      const matchesStatus =
        logsStatusFilter === "ALL" ||
        (logsStatusFilter === "ACTIVE" && log.is_active) ||
        (logsStatusFilter === "CLOSED" && !log.is_active && !log.emergency_comment && !log.force_close_comment) ||
        (logsStatusFilter === "EMERGENCY" && !log.is_active && Boolean(log.emergency_comment)) ||
        (logsStatusFilter === "FORCE_CLOSED" && !log.is_active && Boolean(log.force_close_comment));

      const searchLower = logsSearch.toLowerCase().trim();
      const shiftLabelStr = SHIFT_LABELS[log.shift_number] || `Shift ${log.shift_number}`;
      const matchesSearch =
        !searchLower ||
        log.username.toLowerCase().includes(searchLower) ||
        (log.email && log.email.toLowerCase().includes(searchLower)) ||
        shiftLabelStr.toLowerCase().includes(searchLower) ||
        (log.role && log.role.toLowerCase().includes(searchLower)) ||
        (log.shift_date && log.shift_date.toLowerCase().includes(searchLower));

      // Date range filter (uses shift_date in YYYY-MM-DD format)
      const logDate = log.shift_date || (log.login_at ? log.login_at.slice(0, 10) : "");
      const matchesDateFrom = !logsDateFrom || logDate >= logsDateFrom;
      const matchesDateTo = !logsDateTo || logDate <= logsDateTo;

      return matchesStatus && matchesSearch && matchesDateFrom && matchesDateTo;
    });
  }, [sessionLogs, logsStatusFilter, logsSearch, logsDateFrom, logsDateTo]);

  const logsTotalPages = Math.max(1, Math.ceil(filteredLogs.length / logsPageSize));
  const logsStart = logsPage * logsPageSize;
  const logsEnd = logsStart + logsPageSize;
  const pagedLogs = filteredLogs.slice(logsStart, logsEnd);

  return (
    <div className={className}>
      {/* Shift Login & Logout Log History Card */}
      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-indigo-400" />
              Shift Login &amp; Logout Log History
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Audit log history of DBA shift logins, logouts, active sessions, and shift durations
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadSessionLogs()}
              disabled={logsLoading}
              title="Refresh log history"
            >
              <RefreshCw className={cn("h-4 w-4", logsLoading && "animate-spin")} />
            </Button>
            {!hideViewFullHistoryButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLogsPage(0);
                  setLogsDateFrom(toIstDateStringOffset(new Date(), -30));
                  setLogsDateTo(toIstDateString());
                  setShowLogsHistory(true);
                }}
              >
                <History className="h-3.5 w-3.5 mr-1" />
                View Full Log History
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Input
                placeholder="Search by DBA, role, or shift..."
                value={logsSearch}
                onChange={(e) => {
                  setLogsSearch(e.target.value);
                  setLogsPage(0);
                }}
                className="h-8 text-xs pl-8 bg-background/50 border-border/60"
              />
              <Clock className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Select
                value={logsStatusFilter}
                onValueChange={(val: ShiftLogStatusFilter) => {
                  setLogsStatusFilter(val);
                  setLogsPage(0);
                }}
              >
                <SelectTrigger className="h-8 text-xs w-[160px] bg-background/50 border-border/60">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active Only</SelectItem>
                  <SelectItem value="CLOSED">Closed (Normal)</SelectItem>
                  <SelectItem value="EMERGENCY">Emergency Logout</SelectItem>
                  <SelectItem value="FORCE_CLOSED">Force Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {logsLoading && sessionLogs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No shift login/logout logs found.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 overflow-hidden bg-background/30">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[180px]">DBA</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Shift Date</TableHead>
                    <TableHead>Login Time (IST)</TableHead>
                    <TableHead>Logout Time (IST)</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Handover Status</TableHead>
                    <TableHead className="text-right">Session Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(hideViewFullHistoryButton ? pagedLogs : filteredLogs.slice(0, 5)).map((log) => (
                    <TableRow key={log.session_id} className="hover:bg-background/50 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DbaAvatar name={log.username} className="h-7 w-7 text-xs" />
                          <div className="flex flex-col">
                            <span className="font-medium text-xs">{log.username}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{log.role}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium">
                          {SHIFT_LABELS[log.shift_number] || `Shift ${log.shift_number}`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {log.shift_date || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {formatDateTime(log.login_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {log.logout_at ? (
                          formatDateTime(log.logout_at)
                        ) : (
                          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-sans font-medium">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Active Now
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        <span className={cn(log.is_active ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-slate-700 dark:text-slate-300")}>
                          {formatShiftDuration(log.login_at, log.logout_at)}
                          {log.is_active && <span className="text-[10px] text-muted-foreground ml-1">(ongoing)</span>}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.handover_status === "ACKNOWLEDGED" ? (
                          <Badge variant="outline" className="text-[11px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                            Acknowledged
                          </Badge>
                        ) : log.handover_status === "PENDING" ? (
                          <Badge variant="outline" className="text-[11px] border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                            Pending
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/60 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {log.is_active ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-xs font-medium">
                            ACTIVE
                          </Badge>
                        ) : log.force_close_comment ? (
                          <button
                            type="button"
                            onClick={() => setSelectedForceClosedSession(log)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-rose-500/50"
                            title="Click to view admin force close reason"
                          >
                            <ShieldAlert className="h-3 w-3 text-rose-500" />
                            FORCE CLOSED
                          </button>
                        ) : log.emergency_comment ? (
                          <button
                            type="button"
                            onClick={() => setSelectedEmergencySession(log)}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                            title="Click to view emergency logout comment"
                          >
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                            EMERGENCY LOGOUT
                          </button>
                        ) : (
                          <Badge variant="outline" className="bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 text-xs font-medium">
                            CLOSED
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Inline Pagination controls when hideViewFullHistoryButton is true */}
          {hideViewFullHistoryButton && !logsLoading && filteredLogs.length > 0 && (
            <div className="flex items-center justify-between border-t border-border/70 pt-3 mt-4">
              <span className="text-xs text-muted-foreground">
                Showing {logsStart + 1}–{Math.min(logsEnd, filteredLogs.length)} of {filteredLogs.length} logs
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLogsPage((p) => Math.max(0, p - 1))}
                  disabled={logsPage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {logsPage + 1} / {logsTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLogsPage((p) => Math.min(logsTotalPages - 1, p + 1))}
                  disabled={logsPage >= logsTotalPages - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Shift Login & Logout Log History Dialog */}
      {!hideViewFullHistoryButton && (
        <Dialog open={showLogsHistory} onOpenChange={setShowLogsHistory}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-indigo-400" />
                Full Shift Login &amp; Logout Log History
              </DialogTitle>
              <DialogDescription>
                Complete history of DBA shift logins, logouts, active sessions, and shift durations.
              </DialogDescription>
            </DialogHeader>

            {/* Search & Filter Controls in Dialog - All Side by Side */}
            <div className="flex flex-wrap items-end gap-3 border-b border-border/60 pb-3">
              {/* Search */}
              <div className="space-y-1 min-w-[200px] flex-1 max-w-xs">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Filter className="h-3 w-3" />
                  Search
                </Label>
                <div className="relative">
                  <Input
                    placeholder="DBA, role, or shift..."
                    value={logsSearch}
                    onChange={(e) => {
                      setLogsSearch(e.target.value);
                      setLogsPage(0);
                    }}
                    className="h-8 text-xs pl-8 bg-background/50 border-border/60"
                  />
                  <Clock className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>

              {/* From Date */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  From Date
                </Label>
                <Input
                  type="date"
                  value={logsDateFrom}
                  onChange={(e) => {
                    setLogsDateFrom(e.target.value);
                    setLogsPage(0);
                  }}
                  className="h-8 w-[145px] text-xs bg-background/50 border-border/60"
                />
              </div>

              {/* To Date */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  To Date
                </Label>
                <Input
                  type="date"
                  value={logsDateTo}
                  onChange={(e) => {
                    setLogsDateTo(e.target.value);
                    setLogsPage(0);
                  }}
                  className="h-8 w-[145px] text-xs bg-background/50 border-border/60"
                />
              </div>

              {/* Status Filter */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Status
                </Label>
                <Select
                  value={logsStatusFilter}
                  onValueChange={(val: ShiftLogStatusFilter) => {
                    setLogsStatusFilter(val);
                    setLogsPage(0);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs w-[160px] bg-background/50 border-border/60">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="ACTIVE">Active Only</SelectItem>
                    <SelectItem value="CLOSED">Closed (Normal)</SelectItem>
                    <SelectItem value="EMERGENCY">Emergency Logout</SelectItem>
                    <SelectItem value="FORCE_CLOSED">Force Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Clear Filters */}
              {(logsSearch || logsStatusFilter !== "ALL" || logsDateFrom !== defaultFromDate || logsDateTo !== defaultToDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setLogsSearch("");
                    setLogsStatusFilter("ALL");
                    setLogsDateFrom(toIstDateStringOffset(new Date(), -30));
                    setLogsDateTo(toIstDateString());
                    setLogsPage(0);
                  }}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Clear Filters
                </Button>
              )}

              {/* Refresh Button */}
              <div className="ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void loadSessionLogs()}
                  disabled={logsLoading}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1", logsLoading && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </div>

            <div className="max-h-[500px] overflow-y-auto">
              {logsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredLogs.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No shift logs found matching your criteria.</p>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10">
                    <TableRow>
                      <TableHead>DBA</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Login Time (IST)</TableHead>
                      <TableHead>Logout Time (IST)</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Handover Status</TableHead>
                      <TableHead className="text-right">Session Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLogs.map((log) => (
                      <TableRow key={log.session_id} className="hover:bg-background/50 transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <DbaAvatar name={log.username} className="h-7 w-7 text-xs" />
                            <div className="flex flex-col">
                              <span className="font-medium text-xs">{log.username}</span>
                              <span className="text-[10px] text-muted-foreground uppercase">{log.role}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium">
                            {SHIFT_LABELS[log.shift_number] || `Shift ${log.shift_number}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {log.shift_date || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {formatDateTime(log.login_at)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {log.logout_at ? (
                            formatDateTime(log.logout_at)
                          ) : (
                            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-sans font-medium">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                              Active Now
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          <span className={cn(log.is_active ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-slate-700 dark:text-slate-300")}>
                            {formatShiftDuration(log.login_at, log.logout_at)}
                            {log.is_active && <span className="text-[10px] text-muted-foreground ml-1">(ongoing)</span>}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.handover_status === "ACKNOWLEDGED" ? (
                            <Badge variant="outline" className="text-[11px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                              Acknowledged
                            </Badge>
                          ) : log.handover_status === "PENDING" ? (
                            <Badge variant="outline" className="text-[11px] border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                              Pending
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/60 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {log.is_active ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-xs font-medium">
                              ACTIVE
                            </Badge>
                          ) : log.force_close_comment ? (
                            <button
                              type="button"
                              onClick={() => setSelectedForceClosedSession(log)}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-rose-500/50"
                              title="Click to view admin force close reason"
                            >
                              <ShieldAlert className="h-3 w-3 text-rose-500" />
                              FORCE CLOSED
                            </button>
                          ) : log.emergency_comment ? (
                            <button
                              type="button"
                              onClick={() => setSelectedEmergencySession(log)}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                              title="Click to view emergency logout comment"
                            >
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                              EMERGENCY LOGOUT
                            </button>
                          ) : (
                            <Badge variant="outline" className="bg-slate-200/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 text-xs font-medium">
                              CLOSED
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Pagination in Dialog */}
            {!logsLoading && filteredLogs.length > 0 && (
              <div className="flex items-center justify-between border-t border-border/70 pt-3 mt-2">
                <span className="text-xs text-muted-foreground">
                  Showing {logsStart + 1}–{Math.min(logsEnd, filteredLogs.length)} of {filteredLogs.length} logs
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLogsPage((p) => Math.max(0, p - 1))}
                    disabled={logsPage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {logsPage + 1} / {logsTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLogsPage((p) => Math.min(logsTotalPages - 1, p + 1))}
                    disabled={logsPage >= logsTotalPages - 1}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Emergency Logout Reason Details Dialog */}
      <Dialog
        open={!!selectedEmergencySession}
        onOpenChange={(open) => !open && setSelectedEmergencySession(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500 text-base">
              <AlertTriangle className="h-5 w-5" />
              Emergency Logout Details
            </DialogTitle>
            <DialogDescription className="text-xs">
              Session #{selectedEmergencySession?.session_id} &mdash;{" "}
              <strong className="text-foreground">{selectedEmergencySession?.username}</strong>
            </DialogDescription>
          </DialogHeader>

          {selectedEmergencySession && (
            <div className="space-y-3.5 py-1">
              {/* Shift summary details */}
              <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 rounded-lg p-3 border border-border/60">
                <div>
                  <span className="text-muted-foreground block text-[11px]">DBA:</span>
                  <span className="font-semibold">{selectedEmergencySession.username} ({selectedEmergencySession.role})</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Shift:</span>
                  <span className="font-semibold">{SHIFT_LABELS[selectedEmergencySession.shift_number] || `Shift ${selectedEmergencySession.shift_number}`}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Shift Date:</span>
                  <span className="font-mono">{selectedEmergencySession.shift_date || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Duration:</span>
                  <span className="font-medium">{formatShiftDuration(selectedEmergencySession.login_at, selectedEmergencySession.logout_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Login Time (IST):</span>
                  <span className="font-mono">{formatDateTime(selectedEmergencySession.login_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Logout Time (IST):</span>
                  <span className="font-mono">{selectedEmergencySession.logout_at ? formatDateTime(selectedEmergencySession.logout_at) : "—"}</span>
                </div>
              </div>

              {/* Emergency Comment Box */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Emergency Logout Reason / Comment:
                </Label>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                  {selectedEmergencySession.emergency_comment || "No comment recorded."}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedEmergencySession(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Close Details Dialog */}
      <Dialog
        open={!!selectedForceClosedSession}
        onOpenChange={(open) => {
          if (!open) setSelectedForceClosedSession(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-500">
              <ShieldAlert className="h-5 w-5" />
              Admin Force Close Details
            </DialogTitle>
            <DialogDescription className="pt-1">
              This shift session was force closed by an administrator without prerequisite logout conditions.
            </DialogDescription>
          </DialogHeader>

          {selectedForceClosedSession && (
            <div className="space-y-4 pt-1 text-xs">
              <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-border/60 bg-background/50 p-3">
                <div>
                  <span className="text-muted-foreground block text-[11px]">DBA:</span>
                  <span className="font-semibold text-foreground">{selectedForceClosedSession.username}</span>
                  <span className="text-muted-foreground ml-1 uppercase text-[10px]">({selectedForceClosedSession.role})</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Shift:</span>
                  <span className="font-semibold">{SHIFT_LABELS[selectedForceClosedSession.shift_number] || `Shift ${selectedForceClosedSession.shift_number}`}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Shift Date:</span>
                  <span className="font-mono">{selectedForceClosedSession.shift_date || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Duration:</span>
                  <span className="font-medium">{formatShiftDuration(selectedForceClosedSession.login_at, selectedForceClosedSession.logout_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Login Time (IST):</span>
                  <span className="font-mono">{formatDateTime(selectedForceClosedSession.login_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Closed At (IST):</span>
                  <span className="font-mono">{selectedForceClosedSession.logout_at ? formatDateTime(selectedForceClosedSession.logout_at) : "—"}</span>
                </div>
                {selectedForceClosedSession.force_closed_by && (
                  <div className="col-span-2 pt-1 border-t border-border/40">
                    <span className="text-muted-foreground block text-[11px]">Force Closed By:</span>
                    <span className="font-semibold text-rose-400">{selectedForceClosedSession.force_closed_by}</span>
                  </div>
                )}
              </div>

              {/* Force Close Comment Box */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Admin Force Close Reason / Comment:
                </Label>
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                  {selectedForceClosedSession.force_close_comment || "No comment recorded."}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedForceClosedSession(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
