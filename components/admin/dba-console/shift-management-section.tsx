"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  History,
  LogIn,
  LogOut,
  RefreshCw,
  Send,
  ShieldAlert,
  UserCheck,
  Users
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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeHandover,
  fetchCurrentShift,
  fetchHandoverHistory,
  fetchShiftSessionLogs,
  overrideHandoverApi,
  shiftLogin,
  shiftLogout,
  submitHandover
} from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn, formatDateTime, formatTime } from "@/lib/utils";
import type { CurrentShiftState, Handover, NotificationPayload, ShiftSession } from "@/types/dba";

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

const GENERAL_SHIFT_NUMBER = 4;
const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (07:00 - 15:30)",
  2: "Shift 2 (14:30 - 23:00)",
  3: "Shift 3 (22:30 - 07:00)",
  4: "General Shift"
};

const REFRESH_INTERVAL_MS = 30_000;

/** Renders HTML handover content (from TipTap editor) safely. */
function HandoverContent({ html, className }: { html: string; className?: string }) {
  const isHtml = html.trim().startsWith("<") || /<\/?[a-z][\s\S]*>/i.test(html);
  if (isHtml) {
    return (
      <div
        className={cn("tiptap-content prose prose-sm prose-invert max-w-none text-sm", className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // Fallback for legacy plain-text/markdown handovers.
  return <div className={cn("text-sm whitespace-pre-wrap", className)}>{html}</div>;
}

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

function handoverBadge(session: ShiftSession | null | undefined) {
  if (!session) return <Badge variant="outline" className="text-muted-foreground">None</Badge>;
  if (session.handover_status === "ACKNOWLEDGED") {
    return (
      <Badge className="border-green-500/30 bg-green-500/10 text-green-300">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Acknowledged
      </Badge>
    );
  }
  if (session.handover_status === "PENDING") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
        <Clock className="mr-1 h-3 w-3" />
        Pending
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-muted-foreground">None</Badge>;
}

function handoverBadgeForHistory(h: Handover | null | undefined) {
  if (!h) return <Badge variant="outline" className="text-muted-foreground">None</Badge>;
  if (h.status === "ACKNOWLEDGED") {
    return (
      <Badge className={h.is_override ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-green-500/30 bg-green-500/10 text-green-300"}>
        <CheckCircle2 className="mr-1 h-3 w-3" />
        {h.is_override ? "Override" : "Acknowledged"}
      </Badge>
    );
  }
  return (
    <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
      <Clock className="mr-1 h-3 w-3" />
      Pending
    </Badge>
  );
}

export function ShiftManagementSection() {
  const user = useAppStore((s) => s.user);
  const [state, setState] = useState<CurrentShiftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [handoverText, setHandoverText] = useState("");
  const [shiftChoice, setShiftChoice] = useState<string>("");
  const [overrideTarget, setOverrideTarget] = useState<ShiftSession | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [viewHandover, setViewHandover] = useState<ShiftSession | null>(null);
  const [viewedHandoverIds, setViewedHandoverIds] = useState<Set<number>>(new Set());
  const [handoverHistory, setHandoverHistory] = useState<Handover[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewHistoryHandover, setViewHistoryHandover] = useState<Handover | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize] = useState(10);

  const [sessionLogs, setSessionLogs] = useState<ShiftSession[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsSearch, setLogsSearch] = useState("");
  const [logsStatusFilter, setLogsStatusFilter] = useState<"ALL" | "ACTIVE" | "CLOSED">("ALL");
  const [showLogsHistory, setShowLogsHistory] = useState(false);
  const [logsPage, setLogsPage] = useState(0);
  const logsPageSize = 10;

  const load = useCallback(async () => {
    try {
      const data = await fetchCurrentShift();
      setState(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shift state.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (limit = 5) => {
    setHistoryLoading(true);
    try {
      const result = await fetchHandoverHistory(limit);
      setHandoverHistory(result.handovers || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load handover history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadSessionLogs = useCallback(async (limit = 50) => {
    setLogsLoading(true);
    try {
      const result = await fetchShiftSessionLogs(limit);
      setSessionLogs(result.sessions || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shift session logs.");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      void load();
      void loadHistory(5);
      void loadSessionLogs(50);
    };
    tick();
    const interval = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, loadHistory, loadSessionLogs]);

  // Listen to real-time notification stream events to update immediately.
  useEffect(() => {
    const handleNotification = (event: Event) => {
      const customEvent = event as CustomEvent<NotificationPayload>;
      if (customEvent.detail?.type === "dba_shift") {
        console.log("[ShiftManagementSection] Real-time dba_shift event received, reloading shift state and history.");
        void load();
        void loadHistory(5);
        void loadSessionLogs(50);
      }
    };
    window.addEventListener("dba-notification", handleNotification);
    return () => {
      window.removeEventListener("dba-notification", handleNotification);
    };
  }, [load, loadHistory, loadSessionLogs]);

  const sessions = (state?.sessions ?? []).filter(Boolean);
  const mySession = sessions.find((s) => s?.username === user?.username) || null;

  // Auto-select the preferred shift in the dropdown when not logged in.
  useEffect(() => {
    if (!state || mySession) return;
    const preferred = state.preferred_shift ?? GENERAL_SHIFT_NUMBER;
    if (preferred === GENERAL_SHIFT_NUMBER || !state.taken_shifts?.includes(preferred)) {
      setShiftChoice(String(preferred));
    } else {
      const fallback = state.selectable_shifts?.find(
        (n) => n !== GENERAL_SHIFT_NUMBER && !state.taken_shifts?.includes(n)
      );
      setShiftChoice(String(fallback ?? GENERAL_SHIFT_NUMBER));
    }
  }, [state, mySession]);
  const isAdmin = user?.role === "app_admin";
  const canManageShift = user?.role === "app_admin" || user?.role === "dba_admin";
  const isMySessionGeneral = mySession ? mySession.shift_number === GENERAL_SHIFT_NUMBER : false;
  const myHandoverAcknowledged = mySession?.handover_status === "ACKNOWLEDGED";
  const checklistReady = state?.logout_checklist?.is_complete === true;
  // General Shift is exempt from handover, Daily Checklist, and alert clearance requirements.
  const canLogout = isMySessionGeneral || (myHandoverAcknowledged && checklistReady);
  const checklist = state?.logout_checklist;
  const checklistSummary = (() => {
    if (!checklist) return "Daily Checklist completion is being checked.";
    const parts: string[] = [];
    if (checklist.database_status.completed < checklist.database_status.total ||
        checklist.backup_status.completed < checklist.backup_status.total) {
      parts.push(
        `Daily Checklist required for Shift${checklist.required_shifts.length > 1 ? "s" : ""} ${checklist.required_shifts.join(", ")}: PROD database availability ${checklist.database_status.completed}/${checklist.database_status.total}; backup status ${checklist.backup_status.completed}/${checklist.backup_status.total}.`
      );
    }
    if (checklist.alert_clearance && !checklist.alert_clearance.is_clear) {
      parts.push(
        `${checklist.alert_clearance.pending} unacknowledged alert notification${checklist.alert_clearance.pending !== 1 ? "s" : ""} pending.`
      );
    }
    return parts.length > 0 ? parts.join(" ") : "";
  })();

  // Pagination for handover history dialog.
  const historyTotalPages = Math.max(1, Math.ceil(handoverHistory.length / historyPageSize));
  const historyStart = historyPage * historyPageSize;
  const historyEnd = historyStart + historyPageSize;
  const pagedHistory = handoverHistory.slice(historyStart, historyEnd);

  const filteredLogs = sessionLogs.filter((log) => {
    const matchesStatus =
      logsStatusFilter === "ALL" ||
      (logsStatusFilter === "ACTIVE" && log.is_active) ||
      (logsStatusFilter === "CLOSED" && !log.is_active);

    const searchLower = logsSearch.toLowerCase().trim();
    const shiftLabel = SHIFT_LABELS[log.shift_number] || `Shift ${log.shift_number}`;
    const matchesSearch =
      !searchLower ||
      log.username.toLowerCase().includes(searchLower) ||
      (log.email && log.email.toLowerCase().includes(searchLower)) ||
      shiftLabel.toLowerCase().includes(searchLower) ||
      (log.role && log.role.toLowerCase().includes(searchLower)) ||
      (log.shift_date && log.shift_date.toLowerCase().includes(searchLower));

    return matchesStatus && matchesSearch;
  });

  const logsTotalPages = Math.max(1, Math.ceil(filteredLogs.length / logsPageSize));
  const logsStart = logsPage * logsPageSize;
  const logsEnd = logsStart + logsPageSize;
  const pagedLogs = filteredLogs.slice(logsStart, logsEnd);

  const handleOpenHistory = () => {
    setShowHistory(true);
    setHistoryPage(0);
    void loadHistory(100);
  };

  const handleLogin = async () => {
    const shiftNumber = Number(shiftChoice) || (state?.preferred_shift ?? GENERAL_SHIFT_NUMBER);
    setActionLoading(true);
    try {
      await shiftLogin(shiftNumber);
      toast.success(`Logged in to ${SHIFT_LABELS[shiftNumber] || `Shift ${shiftNumber}`}.`);
      await load();
      void loadSessionLogs(50);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    setActionLoading(true);
    try {
      await shiftLogout();
      toast.success("Logged out from shift.");
      await load();
      void loadSessionLogs(50);
      setLogoutConfirm(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logout failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitHandover = async () => {
    if (!handoverText.trim()) {
      toast.error("Handover text cannot be empty.");
      return;
    }
    setActionLoading(true);
    try {
      await submitHandover(handoverText.trim());
      toast.success("Handover submitted. Waiting for acknowledgement.");
      setHandoverText("");
      await load();
      await loadHistory(5);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit handover.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcknowledge = async (session: ShiftSession) => {
    if (!session.handover_id) {
      toast.error("No pending handover for this session.");
      return;
    }
    setActionLoading(true);
    try {
      await acknowledgeHandover(session.handover_id);
      toast.success(`Acknowledged ${session.username}'s handover.`);
      if (viewHandover?.session_id === session.session_id) {
        setViewHandover(null);
      }
      await load();
      await loadHistory(5);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to acknowledge.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOverride = async () => {
    if (!overrideTarget?.handover_id || !overrideReason.trim()) {
      toast.error("A pending handover and reason are required for an override.");
      return;
    }
    setActionLoading(true);
    try {
      await overrideHandoverApi(overrideTarget.handover_id, overrideReason.trim(), true, overrideTarget.session_id);
      toast.success("Handover override completed. Session closed.");
      setOverrideTarget(null);
      setOverrideReason("");
      await load();
      await loadHistory(5);
      void loadSessionLogs(50);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Override failed.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid items-stretch gap-6 2xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Skeleton className="h-6 w-32 rounded-md" />
              <Skeleton className="h-6 w-40 rounded-md" />
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="dba-skeleton h-12 w-full rounded-md" />
              ))}
            </div>
          </CardContent>
          </Card>
          <Card className="h-full">
          <CardHeader>
            <Skeleton className="h-6 w-36" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="dba-skeleton h-10 w-full rounded-md" />
            <Skeleton className="dba-skeleton h-10 w-48 rounded-md" />
          </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Unable to load shift data.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="dba-fade-in space-y-6">
      <div className="grid items-stretch gap-6 2xl:grid-cols-[1.1fr_0.9fr]">
      {/* Current Shift Panel — visible to ALL roles */}
      <Card className="h-full min-w-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-cyan-400" />
            Current Shift
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={actionLoading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className={cn(
            "mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3",
            state.overlap
              ? "border-amber-500/25 bg-amber-500/5"
              : "border-cyan-500/25 bg-cyan-500/5"
          )}>
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg border",
              state.overlap
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
            )}>
              <Clock className="h-5 w-5" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{state.shift_label}</span>
                {state.overlap && (
                  <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                    Overlap window
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Server time: {formatDateTime(state.server_time)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  "border-green-500/30 bg-green-500/10 text-green-300",
                  sessions.length === 0 && "border-muted-foreground/30 bg-muted/20 text-muted-foreground"
                )}
              >
                {sessions.length} DBA{sessions.length !== 1 ? "s" : ""} on shift
              </Badge>
            </div>
          </div>

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                <Users className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">No DBA is currently on shift</p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  {canManageShift ? "Use the Shift Actions panel to log in to a shift." : "Check back later."}
                </p>
              </div>
            </div>
          ) : (
            <Table className="min-w-[760px] whitespace-nowrap text-xs [&_td]:px-2 [&_th]:px-2 [&_td:nth-child(5)]:pr-1 [&_td:nth-child(6)]:pl-1 [&_th:nth-child(5)]:pr-1 [&_th:nth-child(6)]:pl-1">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[13.5rem]">DBA</TableHead>
                  <TableHead className="w-[4.75rem]">Shift</TableHead>
                  <TableHead className="w-[5.25rem]">Login Time</TableHead>
                  <TableHead className="w-[5.5rem]">Status</TableHead>
                  <TableHead className="w-[6.5rem]">Handover</TableHead>
                  <TableHead className="w-[7.5rem] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.session_id}>
                    <TableCell className="font-medium">
                      <div className="flex min-w-[12.5rem] items-center gap-2">
                        <DbaAvatar name={session.username} />
                        <div className="flex flex-col">
                          <span className="text-sm leading-5">
                            {session.username}
                            {session.username === user?.username && (
                              <span className="ml-2 text-xs text-cyan-400">(You)</span>
                            )}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {SHIFT_LABELS[session.shift_number] || `Shift ${session.shift_number}`}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        Shift {session.shift_number}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTime(session.login_at)}
                    </TableCell>
                    <TableCell>
                      <Badge className="border-green-500/30 bg-green-500/10 text-green-300">
                        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell>{handoverBadge(session)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {session.handover_text && (
                          canManageShift &&
                          session.username !== user?.username &&
                          session.handover_status === "PENDING" &&
                          session.handover_id &&
                          !viewedHandoverIds.has(session.handover_id) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                              onClick={() => {
                                setViewHandover(session);
                                setViewedHandoverIds((prev) => {
                                  if (prev.has(session.handover_id!)) return prev;
                                  const next = new Set(prev);
                                  next.add(session.handover_id!);
                                  return next;
                                });
                              }}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              View Handover
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setViewHandover(session)}
                              title="View handover"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                        {canManageShift &&
                          session.username !== user?.username &&
                          session.handover_status === "PENDING" &&
                          session.handover_id &&
                          viewedHandoverIds.has(session.handover_id) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleAcknowledge(session)}
                              disabled={actionLoading}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Acknowledge
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Action Panel — only for dba_admin and app_admin */}
      {canManageShift ? (
        <Card className="h-full min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LogIn className="h-5 w-5 text-cyan-400" />
              Shift Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!mySession ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-background/30 p-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Select Shift</Label>
                    <Select value={shiftChoice} onValueChange={setShiftChoice}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder="Choose shift" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, GENERAL_SHIFT_NUMBER].map((n) => {
                          const isDisabledByBuffer = state.disabled_shifts?.includes(n);
                          const isTaken = state.taken_shifts?.includes(n);
                          const takenByDba = sessions.find((s) => s.shift_number === n && s.is_active);
                          const isGeneral = n === GENERAL_SHIFT_NUMBER;
                          const disabled = (!isGeneral && (isDisabledByBuffer || isTaken));
                          let suffix = "";
                          if (isTaken && takenByDba) suffix = ` (taken by ${takenByDba.username})`;
                          else if (isDisabledByBuffer) suffix = " (not yet available)";
                          return (
                            <SelectItem
                              key={n}
                              value={String(n)}
                              disabled={disabled}
                            >
                              {SHIFT_LABELS[n] || `Shift ${n}`}{suffix}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => void handleLogin()}
                    disabled={actionLoading || (() => {
                      const chosen = Number(shiftChoice);
                      if (chosen === GENERAL_SHIFT_NUMBER) return false;
                      return state.taken_shifts?.includes(chosen) || state.disabled_shifts?.includes(chosen);
                    })()}
                  >
                    {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    Login to Shift
                  </Button>
                </div>
                {state.taken_shifts && state.taken_shifts.length > 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {state.taken_shifts.map((n) => `Shift ${n}`).join(", ")} already taken — choose another shift or General Shift.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border border-green-500/25 bg-green-500/5 px-4 py-3 text-sm text-green-300">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-green-500/30 bg-green-500/10">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium">You are on shift</p>
                    <p className="text-xs text-green-300/70">
                      {SHIFT_LABELS[mySession.shift_number] || `Shift ${mySession.shift_number}`} — logged in at {formatTime(mySession.login_at)}
                    </p>
                  </div>
                </div>

                {/* Existing handover display — not shown for General Shift */}
                {mySession.handover_text && !isMySessionGeneral && (
                  <div className="rounded-md border border-border/70 bg-background/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        Your handover
                      </span>
                      {handoverBadge(mySession)}
                    </div>
                    <HandoverContent html={mySession.handover_text} />
                    {mySession.ack_username && (
                      <p className="mt-2 text-xs text-green-400">
                        Acknowledged by {mySession.ack_username}
                        {mySession.ack_at && ` at ${formatDateTime(mySession.ack_at)}`}
                      </p>
                    )}
                  </div>
                )}

                {/* Handover text area — only for time-based shifts with no handover yet */}
                {mySession.handover_status === "NONE" && !isMySessionGeneral && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      Handover Notes
                      <span className="text-xs text-muted-foreground">(Rich text — bold, colors, lists, alignment)</span>
                    </Label>
                    <RichTextEditor
                      value={handoverText}
                      onChange={setHandoverText}
                      placeholder="Write your handover notes for the next shift DBA..."
                      minHeight={120}
                      disabled={actionLoading}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleSubmitHandover()}
                        disabled={actionLoading || !handoverText.trim() || handoverText === "<p></p>"}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Submit Handover
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const lastHandover = handoverHistory[0];
                          if (lastHandover?.handover_text) {
                            setHandoverText(lastHandover.handover_text);
                            toast.success("Copied last handover notes to editor.");
                          }
                        }}
                        disabled={actionLoading || !handoverHistory.length}
                        title={handoverHistory.length ? `Copy handover from ${handoverHistory[0]?.author_username ?? "previous shift"}` : "No previous handovers available"}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Last Handover
                      </Button>
                    </div>
                  </div>
                )}

                {/* General Shift — no handover needed notice */}
                {isMySessionGeneral && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    General Shift does not require a handover. You can logout directly.
                  </p>
                )}

                {/* Logout */}
                <div className="flex items-center gap-3 border-t border-border/70 pt-4">
                  <Button
                    variant="destructive"
                    onClick={() => setLogoutConfirm(true)}
                    disabled={actionLoading || !canLogout}
                    title={!canLogout ? (!checklistReady ? checklistSummary : "Your handover must be acknowledged before logout") : undefined}
                  >
                    <LogOut className="h-4 w-4" />
                    Logout from Shift
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {isMySessionGeneral
                      ? "General Shift — no handover required. You can logout anytime."
                      : !checklistReady
                        ? `${checklistSummary} Complete all required checks before logout.`
                        : canLogout
                          ? "Your handover has been acknowledged, the required Daily Checklist checks are complete, and all alert notifications are cleared. You can safely logout."
                          : "Logout is disabled until your handover is acknowledged by another DBA."}
                  </p>
                </div>
              </div>
            )}

            {/* Admin override section */}
            {isAdmin && sessions.length > 0 && (
              <div className="space-y-2 border-t border-border/70 pt-4">
                <Label className="flex items-center gap-2 text-amber-400">
                  <ShieldAlert className="h-4 w-4" />
                  Admin Override
                </Label>
                <p className="text-xs text-muted-foreground">
                  Force-acknowledge a pending handover and close a session when a DBA needs to leave
                  but no other DBA is available to acknowledge.
                </p>
                <div className="space-y-1.5">
                  {sessions
                    .filter((s) => s.username !== user?.username && s.handover_status === "PENDING")
                    .map((session) => (
                      <div key={session.session_id} className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
                        <span className="text-sm">
                          {session.username} (Shift {session.shift_number}) — pending handover
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                          onClick={() => setOverrideTarget(session)}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Override & Close
                        </Button>
                      </div>
                    ))}
                  {sessions.filter((s) => s.username !== user?.username && s.handover_status === "PENDING").length === 0 && (
                    <p className="text-xs text-muted-foreground">No pending handovers to override.</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="h-full min-w-0">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                <Users className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                You have read-only access to the shift board.
              </p>
              <p className="text-xs text-muted-foreground/70">
                Contact a DBA admin to manage shift logins and handovers.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      {/* Recent Handovers — visible to all roles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-cyan-400" />
            Recent Handovers
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadHistory(5)}
              disabled={historyLoading}
            >
              <RefreshCw className={cn("h-4 w-4", historyLoading && "animate-spin")} />
            </Button>
            {canManageShift && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenHistory}
              >
                <History className="h-3.5 w-3.5" />
                View All History
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading && handoverHistory.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : handoverHistory.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No handovers recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {handoverHistory.slice(0, 5).map((h) => (
                <div
                  key={h.handover_id}
                  className="flex items-start gap-3 rounded-md border border-border/60 bg-background/30 p-3 transition-colors hover:bg-background/50"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{h.author_username}</span>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {SHIFT_LABELS[h.shift_number] || `Shift ${h.shift_number}`}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(h.created_at)}
                      </span>
                      {handoverBadgeForHistory(h)}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {h.handover_text.replace(/<[^>]*>/g, "").replace(/[#*`_>\-]/g, "").trim().slice(0, 150) || "(empty)"}
                      {h.handover_text.length > 150 ? "..." : ""}
                    </p>
                    {h.ack_username && (
                      <p className="mt-0.5 text-xs text-green-400">
                        Acknowledged by {h.ack_username}
                        {h.is_override && " (admin override)"}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setViewHistoryHandover(h)}
                    title="View full handover"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shift Login & Logout Log History — visible to all roles */}
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
              onClick={() => void loadSessionLogs(50)}
              disabled={logsLoading}
              title="Refresh log history"
            >
              <RefreshCw className={cn("h-4 w-4", logsLoading && "animate-spin")} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLogsPage(0);
                setShowLogsHistory(true);
              }}
            >
              <History className="h-3.5 w-3.5 mr-1" />
              View Full Log History
            </Button>
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
                onValueChange={(val: "ALL" | "ACTIVE" | "CLOSED") => {
                  setLogsStatusFilter(val);
                  setLogsPage(0);
                }}
              >
                <SelectTrigger className="h-8 text-xs w-[130px] bg-background/50 border-border/60">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active Only</SelectItem>
                  <SelectItem value="CLOSED">Closed Only</SelectItem>
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
                  {filteredLogs.slice(0, 5).map((log) => (
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
        </CardContent>
      </Card>

      {/* Logout confirmation dialog */}
      <Dialog open={logoutConfirm} onOpenChange={setLogoutConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to logout from your shift? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogoutConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleLogout()} disabled={actionLoading}>
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override confirmation dialog */}
      <Dialog open={!!overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="h-5 w-5" />
              Admin Override
            </DialogTitle>
            <DialogDescription>
              You are about to force-acknowledge the handover for{" "}
              <strong>{overrideTarget?.username}</strong> and close their session. This will be
              recorded in the audit log with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Explain why this override is necessary..."
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => void handleOverride()}
              disabled={actionLoading || !overrideReason.trim()}
            >
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              Force Acknowledge & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View handover dialog */}
      <Dialog open={!!viewHandover} onOpenChange={(open) => !open && setViewHandover(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Handover from {viewHandover?.username}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {viewHandover && (
                  <>
                    Shift {viewHandover.shift_number} — {handoverBadge(viewHandover)}
                    {viewHandover.ack_username && ` — Acknowledged by ${viewHandover.ack_username}`}
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto rounded-md border border-border/70 bg-background/40 p-4">
            <HandoverContent html={viewHandover?.handover_text || ""} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewHandover(null)}>
              Close
            </Button>
            {viewHandover &&
              canManageShift &&
              viewHandover.username !== user?.username &&
              viewHandover.handover_status === "PENDING" &&
              viewHandover.handover_id && (
                <Button
                  onClick={() => void handleAcknowledge(viewHandover)}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Acknowledge Handover
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full handover history dialog — dba_admin/app_admin only */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-cyan-400" />
              Handover History
            </DialogTitle>
            <DialogDescription>
              All historical handovers, most recent first. Click any entry to view the full text.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[500px] overflow-y-auto">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : handoverHistory.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No handovers recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Author</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Acknowledged By</TableHead>
                    <TableHead className="text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedHistory.map((h) => (
                    <TableRow key={h.handover_id}>
                      <TableCell className="font-medium">{h.author_username}</TableCell>
                      <TableCell>{SHIFT_LABELS[h.shift_number] || `Shift ${h.shift_number}`}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(h.created_at)}
                      </TableCell>
                      <TableCell>{handoverBadgeForHistory(h)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {h.ack_username || "—"}
                        {h.is_override && <span className="ml-1 text-xs text-amber-400">(override)</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setViewHistoryHandover(h)}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          {/* Pagination controls */}
          {!historyLoading && handoverHistory.length > 0 && (
            <div className="flex items-center justify-between border-t border-border/70 pt-3">
              <span className="text-xs text-muted-foreground">
                Showing {historyStart + 1}–{Math.min(historyEnd, handoverHistory.length)} of {handoverHistory.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                  disabled={historyPage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {historyPage + 1} / {historyTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistoryPage((p) => Math.min(historyTotalPages - 1, p + 1))}
                  disabled={historyPage >= historyTotalPages - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View historical handover dialog */}
      <Dialog open={!!viewHistoryHandover} onOpenChange={(open) => !open && setViewHistoryHandover(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Handover from {viewHistoryHandover?.author_username}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {viewHistoryHandover && (
                  <>
                    {SHIFT_LABELS[viewHistoryHandover.shift_number] || `Shift ${viewHistoryHandover.shift_number}`}
                    {" — "}
                    {handoverBadgeForHistory(viewHistoryHandover)}
                    {viewHistoryHandover.ack_username && ` — Acknowledged by ${viewHistoryHandover.ack_username}`}
                    {viewHistoryHandover.is_override && ` (admin override: ${viewHistoryHandover.override_reason || "no reason given"})`}
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto rounded-md border border-border/70 bg-background/40 p-4">
            <HandoverContent html={viewHistoryHandover?.handover_text || ""} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Full Shift Login & Logout Log History Dialog */}
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

          {/* Search & Filter Controls in Dialog */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between py-2 border-b border-border/60">
            <div className="relative flex-1 max-w-sm">
              <Input
                placeholder="Search logs by DBA, role, or shift..."
                value={logsSearch}
                onChange={(e) => {
                  setLogsSearch(e.target.value);
                  setLogsPage(0);
                }}
                className="h-8 text-xs pl-8 bg-background/50 border-border/60"
              />
              <Clock className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Filter:</span>
                <Select
                  value={logsStatusFilter}
                  onValueChange={(val: "ALL" | "ACTIVE" | "CLOSED") => {
                    setLogsStatusFilter(val);
                    setLogsPage(0);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs w-[130px] bg-background/50 border-border/60">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="ACTIVE">Active Only</SelectItem>
                    <SelectItem value="CLOSED">Closed Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadSessionLogs(100)}
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

          {/* Pagination controls */}
          {!logsLoading && filteredLogs.length > 0 && (
            <div className="flex items-center justify-between border-t border-border/70 pt-3">
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
    </div>
  );
}
