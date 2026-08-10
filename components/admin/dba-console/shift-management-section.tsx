"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  LogIn,
  LogOut,
  Pencil,
  RefreshCw,
  Send,
  ShieldAlert,
  UserCheck,
  Users,
  Wallet,
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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeHandover,
  fetchAppUsers,
  fetchCurrentShift,
  fetchHandoverHistory,
  fetchShiftSessionLogs,
  overrideHandoverApi,
  shiftCancel,
  shiftLogin,
  shiftLogout,
  submitHandover
} from "@/services/api";
import { ShiftLogHistorySection } from "@/components/admin/dba-console/shift-log-history-section";
import { useAppStore } from "@/store/use-app-store";
import { cn, formatDateTime, formatTime, toIstDateString } from "@/lib/utils";
import { isLateLogin } from "@/lib/server/shift-utils";
import type { CurrentShiftState, Handover, NotificationPayload, ShiftSession } from "@/types/dba";
// xlsx-js-style: drop-in xlsx replacement with full cell-style support
import XLSXStyle from "xlsx-js-style";

const GENERAL_SHIFT_NUMBER = 4;

const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (07:00 - 15:30)",
  2: "Shift 2 (14:30 - 23:00)",
  3: "Shift 3 (22:30 - 07:00)",
  4: "General Shift"
};

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Computes default date range for Shift Roster and Shift Allowance downloads:
 * - On 1st to 3rd of every month: 1st date of previous month to last date of previous month.
 * - On 4th of the month onwards: 1st date of current month to current date.
 */
function getDefaultDateRange(): { fromDate: string; toDate: string } {
  const istDateStr = toIstDateString();
  const [yearStr, monthStr, dayStr] = istDateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const dayOfMonth = Number(dayStr);

  const pad = (n: number) => String(n).padStart(2, "0");

  if (dayOfMonth >= 1 && dayOfMonth <= 3) {
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const lastDayObj = new Date(year, month - 1, 0);
    const lastDay = lastDayObj.getDate();

    return {
      fromDate: `${prevYear}-${pad(prevMonth)}-01`,
      toDate: `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`
    };
  }

  return {
    fromDate: `${yearStr}-${monthStr}-01`,
    toDate: istDateStr
  };
}

/** Checks if HTML content from rich text editor is empty (stripping tags & non-breaking spaces). */
function isEditorContentEmpty(html: string): boolean {
  if (!html || !html.trim()) return true;
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  return stripped.length === 0;
}

/** Renders HTML handover content (from TipTap editor) safely. */
function HandoverContent({ html, className }: { html: string; className?: string }) {
  const isHtml = html.trim().startsWith("<") || /<\/?[a-z][\s\S]*>/i.test(html);
  if (isHtml) {
    return (
      <div
        className={cn("tiptap-content prose prose-sm dark:prose-invert max-w-none text-sm", className)}
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
  const [lateComment, setLateComment] = useState<string>("");
  const [overrideTarget, setOverrideTarget] = useState<ShiftSession | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [cancelConfirmSession, setCancelConfirmSession] = useState<ShiftSession | null>(null);
  const [viewHandover, setViewHandover] = useState<ShiftSession | null>(null);
  // Tracks handovers the current user has already viewed, mapped to the handover_text at the time
  // of viewing. If the author edits the handover (same handover_id, updated text), the stored text
  // won't match the live text, causing the "View Handover" button to re-appear immediately.
  const [viewedHandoverIds, setViewedHandoverIds] = useState<Map<number, string>>(new Map());
  const [handoverHistory, setHandoverHistory] = useState<Handover[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewHistoryHandover, setViewHistoryHandover] = useState<Handover | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize] = useState(10);
  const [historyAuthorFilter, setHistoryAuthorFilter] = useState<string>("ALL");
  const [historyDateFilter, setHistoryDateFilter] = useState<string>("");
  // Controls whether the author's handover edit panel is expanded (for PENDING / ACKNOWLEDGED states).
  const [isEditingHandover, setIsEditingHandover] = useState(false);
  // Shift Roster Download state
  const [rosterFromDate, setRosterFromDate] = useState<string>(() => getDefaultDateRange().fromDate);
  const [rosterToDate, setRosterToDate] = useState<string>(() => getDefaultDateRange().toDate);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Shift Allowance Download state
  const [allowanceFromDate, setAllowanceFromDate] = useState<string>(() => getDefaultDateRange().fromDate);
  const [allowanceToDate, setAllowanceToDate] = useState<string>(() => getDefaultDateRange().toDate);
  const [allowanceLoading, setAllowanceLoading] = useState(false);

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

  const loadHistory = useCallback(async (limit = 100) => {
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

  useEffect(() => {
    // Initial load on mount
    void load();
    void loadHistory(100);

    // Periodic refresh for active shift state only (session logs refresh via real-time events)
    const interval = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, loadHistory]);

  // Listen to real-time notification stream events to update immediately.
  useEffect(() => {
    const handleNotification = (event: Event) => {
      const customEvent = event as CustomEvent<NotificationPayload>;
      if (customEvent.detail?.type === "dba_shift") {
        console.log("[ShiftManagementSection] Real-time dba_shift event received, reloading shift state and history.");
        void load();
        void loadHistory(100);
      }
    };
    window.addEventListener("dba-notification", handleNotification);
    return () => {
      window.removeEventListener("dba-notification", handleNotification);
    };
  }, [load, loadHistory]);

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
  const isDbaAdmin = user?.role === "dba_admin";
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

  // Unique authors for the handover history filter dropdown.
  const historyAuthors = useMemo(
    () => Array.from(new Set(handoverHistory.map((h) => h.author_username))).sort(),
    [handoverHistory]
  );

  // Filtered handover history based on author and date filters.
  const filteredHistory = useMemo(() => {
    return handoverHistory.filter((h) => {
      const matchesAuthor =
        historyAuthorFilter === "ALL" || h.author_username === historyAuthorFilter;
      const matchesDate =
        !historyDateFilter ||
        (h.created_at && h.created_at.slice(0, 10) === historyDateFilter) ||
        (h.shift_date && h.shift_date === historyDateFilter);
      return matchesAuthor && matchesDate;
    });
  }, [handoverHistory, historyAuthorFilter, historyDateFilter]);

  // Pagination for handover history dialog.
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const historyStart = historyPage * historyPageSize;
  const historyEnd = historyStart + historyPageSize;
  const pagedHistory = filteredHistory.slice(historyStart, historyEnd);



  const handleOpenHistory = () => {
    setShowHistory(true);
    setHistoryPage(0);
    setHistoryAuthorFilter("ALL");
    setHistoryDateFilter("");
    void loadHistory(100);
  };

  const handleLogin = async () => {
    const shiftNumber = Number(shiftChoice) || (state?.preferred_shift ?? GENERAL_SHIFT_NUMBER);
    const lateCheck = isLateLogin(shiftNumber);
    if (lateCheck.isLate && !lateComment.trim()) {
      toast.error("Reason for late login is required as you are logging in more than 1 hour after shift start.");
      return;
    }
    setActionLoading(true);
    try {
      await shiftLogin(shiftNumber, lateComment.trim() || undefined);
      toast.success(`Logged in to ${SHIFT_LABELS[shiftNumber] || `Shift ${shiftNumber}`}.`);
      setLateComment("");
      await load();
      window.dispatchEvent(new CustomEvent("dba-notification", { detail: { type: "dba_shift" } as NotificationPayload }));
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
      window.dispatchEvent(new CustomEvent("dba-notification", { detail: { type: "dba_shift" } as NotificationPayload }));
      setLogoutConfirm(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logout failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelShift = async () => {
    if (!cancelConfirmSession) return;
    setActionLoading(true);
    try {
      await shiftCancel(cancelConfirmSession.session_id);
      toast.success(`Canceled shift for ${cancelConfirmSession.username}. Record deleted from database.`);
      setCancelConfirmSession(null);
      await load();
      window.dispatchEvent(new CustomEvent("dba-notification", { detail: { type: "dba_shift" } as NotificationPayload }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel shift.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitHandover = async (isUpdate = false) => {
    if (isEditorContentEmpty(handoverText)) {
      toast.error("Handover text cannot be empty.");
      return;
    }
    setActionLoading(true);
    try {
      await submitHandover(handoverText.trim());
      if (isUpdate) {
        toast.success("Handover updated. Pending acknowledgement.");
      } else {
        toast.success("Handover submitted. Waiting for acknowledgement.");
      }
      setHandoverText("");
      setIsEditingHandover(false);
      await load();
      await loadHistory(100);
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
      await loadHistory(100);
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
      await loadHistory(100);
      window.dispatchEvent(new CustomEvent("dba-notification", { detail: { type: "dba_shift" } as NotificationPayload }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Override failed.");
    } finally {
      setActionLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Shift Roster Download
  // ---------------------------------------------------------------------------
  const handleDownloadRoster = async () => {
    if (!rosterFromDate || !rosterToDate) {
      toast.error("Please select both From Date and To Date.");
      return;
    }
    if (rosterFromDate > rosterToDate) {
      toast.error("From Date must be before or equal to To Date.");
      return;
    }
    const maxDays = 62;
    const fromMs  = new Date(rosterFromDate).getTime();
    const toMs    = new Date(rosterToDate).getTime();
    const daysDiff = Math.round((toMs - fromMs) / 86_400_000) + 1;
    if (daysDiff > maxDays) {
      toast.error(`Date range is too large. Maximum ${maxDays} days per download.`);
      return;
    }
    setRosterLoading(true);
    try {
      const { sessions } = await fetchShiftSessionLogs(1000, {
        fromDate: rosterFromDate,
        toDate: rosterToDate
      });

      // -----------------------------------------------------------------------
      // 1.  Build date → shift → usernames[] map
      // -----------------------------------------------------------------------
      const dateShiftMap: Record<string, Record<number, string[]>> = {};
      for (const s of sessions) {
        const date = s.shift_date ?? s.login_at?.slice(0, 10);
        if (!date) continue;
        if (!dateShiftMap[date]) dateShiftMap[date] = {};
        if (!dateShiftMap[date][s.shift_number]) dateShiftMap[date][s.shift_number] = [];
        if (!dateShiftMap[date][s.shift_number].includes(s.username))
          dateShiftMap[date][s.shift_number].push(s.username);
      }

      // -----------------------------------------------------------------------
      // 2.  Assign a distinct pastel colour to every unique DBA username
      // -----------------------------------------------------------------------
      const USER_PALETTE = [
        "C9DAF8", // cornflower blue
        "D9EAD3", // sage green
        "FFF2CC", // pale yellow
        "F4CCCC", // rose
        "EAD1DC", // mauve
        "D9D2E9", // lavender
        "B7D7A8", // mint
        "9FC5E8", // sky blue
        "EA9999", // salmon
        "FFE5CC", // peach
        "A9C4D4", // steel blue
        "B4A7D6", // purple
        "F9CB9C", // apricot
        "FFE599", // lemon
        "CDEAE3", // aqua
        "F6B26B", // orange
        "76A5AF", // teal
        "E6B8A2", // tan
      ];
      const uniqueUsers = Array.from(
        new Set(sessions.map(s => s.username))
      ).sort();
      const userColorMap: Record<string, string> = {};
      uniqueUsers.forEach((u, i) => {
        userColorMap[u] = USER_PALETTE[i % USER_PALETTE.length];
      });

      // -----------------------------------------------------------------------
      // 3.  Calendar dates list
      // -----------------------------------------------------------------------
      const dates: string[] = [];
      const cur = new Date(rosterFromDate);
      const end = new Date(rosterToDate);
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }

      const DAY_ABBR    = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const MONTH_NAMES = ["January","February","March","April","May","June",
        "July","August","September","October","November","December"];

      const fromD = new Date(rosterFromDate);
      const toD   = new Date(rosterToDate);
      const titleMonths =
        fromD.getMonth() === toD.getMonth() && fromD.getFullYear() === toD.getFullYear()
          ? `${MONTH_NAMES[fromD.getMonth()]} ${fromD.getFullYear()}`
          : `${MONTH_NAMES[fromD.getMonth()]} – ${MONTH_NAMES[toD.getMonth()]} ${toD.getFullYear()}`;
      const title = `${titleMonths} Roaster - DBA Team`;

      // -----------------------------------------------------------------------
      // 4.  Build rows (AoA)  — simplified shift labels
      // -----------------------------------------------------------------------
      const SHIFT_ROW_LABELS: Record<number, string> = {
        1: "Morning Shift",
        2: "Afternoon Shift",
        3: "Night Shift",
        4: "General Shift",
      };
      // Label column background per shift (keeps row identity readable)
      const SHIFT_LABEL_BG: Record<number, string> = {
        1: "C6EFCE", // green
        2: "FFEB9C", // yellow
        3: "E2CFEE", // purple
        4: "DCE6F1", // blue
      };
      const SHIFT_LABEL_FG: Record<number, string> = {
        1: "006100",
        2: "9C5700",
        3: "5C3C7A",
        4: "1F3864",
      };

      const LABEL_COL = "";
      const titleRow   = [title,    ...dates.map(() => "")];
      const dayNumRow  = [LABEL_COL,...dates.map(d => new Date(d).getDate())];
      const weekdayRow = [LABEL_COL,...dates.map(d => DAY_ABBR[new Date(d).getDay()])];

      const shiftDataRow = (shiftNum: number) => [
        SHIFT_ROW_LABELS[shiftNum],
        ...dates.map(d => {
          const names = dateShiftMap[d]?.[shiftNum];
          return names && names.length > 0 ? names.join(" / ") : "";
        })
      ];

      // Only 4 shift rows — footer rows (Off, Leave, etc.) removed
      const aoa = [
        titleRow,
        dayNumRow,
        weekdayRow,
        shiftDataRow(1),   // row 3
        shiftDataRow(2),   // row 4
        shiftDataRow(3),   // row 5
        shiftDataRow(4),   // row 6
      ];

      const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

      // -----------------------------------------------------------------------
      // 5.  Column widths & row heights
      // -----------------------------------------------------------------------
      ws["!cols"] = [
        { wch: 18 },
        ...dates.map(() => ({ wch: 13 }))
      ];
      ws["!rows"] = [
        { hpt: 22 }, // title
        { hpt: 20 }, // day numbers / Shift Name label
        { hpt: 16 }, // weekday abbr
        { hpt: 28 }, // Morning
        { hpt: 28 }, // Afternoon
        { hpt: 28 }, // Night
        { hpt: 28 }, // General
      ];

      // -----------------------------------------------------------------------
      // 6.  Merge title across all columns  +  merge "Shift Name" label (rows 1-2, col 0)
      // -----------------------------------------------------------------------
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: dates.length } }, // title row
        { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }            // "Shift Name" label
      ];

      // -----------------------------------------------------------------------
      // 7.  Helper: ensure cell exists, then apply style
      // -----------------------------------------------------------------------
      const enc = (r: number, c: number) => XLSXStyle.utils.encode_cell({ r, c });
      const applyStyle = (r: number, c: number, style: Record<string, unknown>) => {
        const addr = enc(r, c);
        if (!ws[addr]) ws[addr] = { t: "s", v: "" };
        (ws[addr] as Record<string, unknown>).s = style;
      };
      // Write "Shift Name" text into the merged label cell (col 0, rows 1-2)
      ws[enc(1, 0)] = { t: "s", v: "Shift Name" };

      // -----------------------------------------------------------------------
      // 8.  Style: Title row
      // -----------------------------------------------------------------------
      const sTitle = {
        font: { bold: true, sz: 13, color: { rgb: "1F3864" } },
        fill: { patternType: "solid", fgColor: { rgb: "BDD7EE" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "AAAAAA" } } }
      };
      for (let c = 0; c <= dates.length; c++) applyStyle(0, c, sTitle);

      // -----------------------------------------------------------------------
      // 9.  Style: Day-number row (row 1) & Weekday row (row 2)
      // -----------------------------------------------------------------------
      // Shared thin border used by every cell in the table
      const thinBorder = {
        top:    { style: "thin", color: { rgb: "AAAAAA" } },
        bottom: { style: "thin", color: { rgb: "AAAAAA" } },
        left:   { style: "thin", color: { rgb: "AAAAAA" } },
        right:  { style: "thin", color: { rgb: "AAAAAA" } }
      };
      const sDayLabel = {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      };
      const sDayWeekend = {
        font: { bold: true, sz: 9, color: { rgb: "9C0006" } },
        fill: { patternType: "solid", fgColor: { rgb: "F2DCDB" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      };
      // "Shift Name" merged label (col 0, rows 1-2)
      applyStyle(1, 0, {
        font: { bold: true, sz: 9, color: { rgb: "1F3864" } },
        fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      });
      for (let c = 1; c <= dates.length; c++) {
        const dow = new Date(dates[c - 1]).getDay();
        const isWeekend = dow === 0 || dow === 6;
        applyStyle(1, c, isWeekend ? sDayWeekend : sDayLabel);
        applyStyle(2, c, isWeekend ? sDayWeekend : sDayLabel);
      }

      // -----------------------------------------------------------------------
      // 10.  Style: Shift data rows (3-6)
      //       • Label column  → shift-type colour
      //       • Data cells    → user's personal colour (or empty-cell style)
      // -----------------------------------------------------------------------
      const sEmptyCell = {
        fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      };
      const shiftRowMap: [number, number][] = [[1, 3], [2, 4], [3, 5], [4, 6]];
      for (const [shiftNum, rowIdx] of shiftRowMap) {
        // Label cell
        applyStyle(rowIdx, 0, {
          font: { bold: true, sz: 9, color: { rgb: SHIFT_LABEL_FG[shiftNum] } },
          fill: { patternType: "solid", fgColor: { rgb: SHIFT_LABEL_BG[shiftNum] } },
          alignment: { vertical: "center" },
          border: thinBorder
        });
        // Data cells
        for (let c = 1; c <= dates.length; c++) {
          const date  = dates[c - 1];
          const names = dateShiftMap[date]?.[shiftNum];
          if (names && names.length > 0) {
            const firstUser = names[0];
            const userBg    = userColorMap[firstUser] ?? "FFFFFF";
            applyStyle(rowIdx, c, {
              font: { bold: true, sz: 9, color: { rgb: "000000" } },
              fill: { patternType: "solid", fgColor: { rgb: userBg } },
              alignment: { horizontal: "center", vertical: "center", wrapText: true },
              border: thinBorder
            });
          } else {
            applyStyle(rowIdx, c, sEmptyCell);
          }
        }
      }

      // -----------------------------------------------------------------------
      // 11.  Write workbook (single sheet — no DBA Legend)
      // -----------------------------------------------------------------------
      const wb = XLSXStyle.utils.book_new();
      XLSXStyle.utils.book_append_sheet(wb, ws, "Shift Roster");
      XLSXStyle.writeFile(wb, `Shift_Roster_${rosterFromDate}_to_${rosterToDate}.xlsx`);
      toast.success(`Shift Roster downloaded — ${dates.length} days, ${sessions.length} sessions, ${uniqueUsers.length} DBA(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate roster.");
    } finally {
      setRosterLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Shift Allowance Download
  // ---------------------------------------------------------------------------
  const handleDownloadAllowance = async () => {
    if (!allowanceFromDate || !allowanceToDate) {
      toast.error("Please select both From Date and To Date.");
      return;
    }
    if (allowanceFromDate > allowanceToDate) {
      toast.error("From Date must be before or equal to To Date.");
      return;
    }
    const maxDays = 62;
    const fromMs  = new Date(allowanceFromDate).getTime();
    const toMs    = new Date(allowanceToDate).getTime();
    const daysDiff = Math.round((toMs - fromMs) / 86_400_000) + 1;
    if (daysDiff > maxDays) {
      toast.error(`Date range is too large. Maximum ${maxDays} days per download.`);
      return;
    }
    setAllowanceLoading(true);
    try {
      // Fetch shift sessions and user list in parallel
      const [{ sessions: allSessions }, { users: appUsers }] = await Promise.all([
        fetchShiftSessionLogs(2000, { fromDate: allowanceFromDate, toDate: allowanceToDate }),
        fetchAppUsers()
      ]);

      // Only Shift 2 (Afternoon) and Shift 3 (Night) qualify for allowance
      const qualifyingSessions = allSessions.filter(
        (s) => s.shift_number === 2 || s.shift_number === 3
      );

      if (qualifyingSessions.length === 0) {
        toast.error("No Afternoon or Night shift sessions found for the selected date range.");
        return;
      }

      // Build username → AppUser map for PSID lookup
      const userMap = new Map(appUsers.map((u) => [u.username, u]));

      // Aggregate days per (username, shift_number) — count distinct shift_dates
      const shiftDayMap: Record<string, Record<number, Set<string>>> = {};
      for (const s of qualifyingSessions) {
        const date = s.shift_date ?? s.login_at?.slice(0, 10) ?? "";
        if (!date) continue;
        if (!shiftDayMap[s.username]) shiftDayMap[s.username] = {};
        if (!shiftDayMap[s.username][s.shift_number]) shiftDayMap[s.username][s.shift_number] = new Set();
        shiftDayMap[s.username][s.shift_number].add(date);
      }

      // Helper: format date as DD-MM-YYYY
      const fmtDate = (iso: string) => {
        const [y, m, d] = iso.split("-");
        return `${d}-${m}-${y}`;
      };
      const startFmt = fmtDate(allowanceFromDate);
      const endFmt   = fmtDate(allowanceToDate);

      // Title text
      const MONTH_NAMES = ["January","February","March","April","May","June",
        "July","August","September","October","November","December"];
      const fromD = new Date(allowanceFromDate);
      const toD   = new Date(allowanceToDate);
      const titleMonths =
        fromD.getMonth() === toD.getMonth() && fromD.getFullYear() === toD.getFullYear()
          ? `${MONTH_NAMES[fromD.getMonth()]} ${fromD.getFullYear()}`
          : `${MONTH_NAMES[fromD.getMonth()]} – ${MONTH_NAMES[toD.getMonth()]} ${toD.getFullYear()}`;
      const sheetTitle = `Shift Allowance - ${titleMonths} - DBA Team`;

      // Column headers
      const HEADERS = [
        "PSID",
        "Name of employee",
        "Project-Account",
        "Department",
        "Start Date",
        "End Date",
        "Shift Start Time",
        "Shift End Time",
        "Total no. of Days",
        "Allowance Type",
        "Total"
      ];
      const NUM_COLS = HEADERS.length;
      const ALLOWANCE_PER_DAY = 350;

      // Build data rows sorted by username
      const usernames = Object.keys(shiftDayMap).sort();
      const dataRows: (string | number)[][] = [];
      for (const uname of usernames) {
        const appUser  = userMap.get(uname);
        const psid     = appUser?.psid ?? "";
        const name     = uname; // use username as name (no separate full_name field)
        const afternoonDays = shiftDayMap[uname]?.[2]?.size ?? 0;
        const nightDays     = shiftDayMap[uname]?.[3]?.size ?? 0;
        if (afternoonDays > 0) {
          dataRows.push([
            psid, name, "ITC", "ITCSMG",
            startFmt, endFmt,
            "2:30 PM", "11:00 PM",
            afternoonDays,
            "Shift Allowance",
            afternoonDays * ALLOWANCE_PER_DAY
          ]);
        }
        if (nightDays > 0) {
          dataRows.push([
            psid, name, "ITC", "ITCSMG",
            startFmt, endFmt,
            "10:30 PM", "7:00 AM",
            nightDays,
            "Shift Allowance",
            nightDays * ALLOWANCE_PER_DAY
          ]);
        }
      }

      // Build AoA: [title, headers, ...dataRows]
      const aoa: (string | number)[][] = [
        [sheetTitle, ...Array(NUM_COLS - 1).fill("")],
        HEADERS,
        ...dataRows
      ];

      const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

      // Column widths
      ws["!cols"] = [
        { wch: 10 },  // PSID
        { wch: 26 },  // Name
        { wch: 16 },  // Project-Account
        { wch: 12 },  // Department
        { wch: 13 },  // Start Date
        { wch: 13 },  // End Date
        { wch: 16 },  // Shift Start Time
        { wch: 14 },  // Shift End Time
        { wch: 18 },  // Total no. of Days
        { wch: 18 },  // Allowance Type
        { wch: 10 },  // Total
      ];

      // Row heights
      ws["!rows"] = [
        { hpt: 24 }, // title
        { hpt: 20 }, // headers
        ...dataRows.map(() => ({ hpt: 18 }))
      ];

      // Merge title across all columns
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: NUM_COLS - 1 } }
      ];

      // Helpers
      const enc = (r: number, c: number) => XLSXStyle.utils.encode_cell({ r, c });
      const applyStyle = (r: number, c: number, style: Record<string, unknown>) => {
        const addr = enc(r, c);
        if (!ws[addr]) ws[addr] = { t: "s", v: "" };
        (ws[addr] as Record<string, unknown>).s = style;
      };

      // Shared thin border
      const thinBorder = {
        top:    { style: "thin", color: { rgb: "AAAAAA" } },
        bottom: { style: "thin", color: { rgb: "AAAAAA" } },
        left:   { style: "thin", color: { rgb: "AAAAAA" } },
        right:  { style: "thin", color: { rgb: "AAAAAA" } }
      };

      // --- Row 0: Title ---
      applyStyle(0, 0, {
        font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "1F3864" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      });
      // Apply same style to remaining merged cells
      for (let c = 1; c < NUM_COLS; c++) {
        applyStyle(0, c, {
          fill: { patternType: "solid", fgColor: { rgb: "1F3864" } },
          border: thinBorder
        });
      }

      // --- Row 1: Header row ---
      const sHeader = {
        font: { bold: true, sz: 10, color: { rgb: "1F3864" } },
        fill: { patternType: "solid", fgColor: { rgb: "BDD7EE" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder
      };
      for (let c = 0; c < NUM_COLS; c++) applyStyle(1, c, sHeader);

      // --- Data rows ---
      // Afternoon rows: light yellow; Night rows: light purple
      const sAfternoon = {
        font: { sz: 10, color: { rgb: "000000" } },
        fill: { patternType: "solid", fgColor: { rgb: "FFF2CC" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      };
      const sAfternoonBold = {
        ...sAfternoon,
        font: { bold: true, sz: 10, color: { rgb: "7E4B00" } }
      };
      const sNight = {
        font: { sz: 10, color: { rgb: "000000" } },
        fill: { patternType: "solid", fgColor: { rgb: "EAD1DC" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: thinBorder
      };
      const sNightBold = {
        ...sNight,
        font: { bold: true, sz: 10, color: { rgb: "4B1265" } }
      };
      const sNameCell = (isNight: boolean) => ({
        font: { sz: 10, color: { rgb: "000000" } },
        fill: { patternType: "solid", fgColor: { rgb: isNight ? "EAD1DC" : "FFF2CC" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: thinBorder
      });

      for (let i = 0; i < dataRows.length; i++) {
        const rowArr  = dataRows[i];
        const rowIdx  = i + 2; // offset by title + header
        // Detect if this row is Night shift by checking Shift Start Time column (index 6)
        const isNight = rowArr[6] === "10:30 PM";
        const baseStyle = isNight ? sNight : sAfternoon;
        const boldStyle = isNight ? sNightBold : sAfternoonBold;
        for (let c = 0; c < NUM_COLS; c++) {
          // Bold: Days, Allowance Type, Total columns (8,9,10)
          if (c === 1) {
            applyStyle(rowIdx, c, sNameCell(isNight));
          } else if (c >= 8) {
            applyStyle(rowIdx, c, boldStyle);
          } else {
            applyStyle(rowIdx, c, baseStyle);
          }
        }
      }

      // Write workbook
      const wb = XLSXStyle.utils.book_new();
      XLSXStyle.utils.book_append_sheet(wb, ws, "Shift Allowance");
      XLSXStyle.writeFile(wb, `Shift_Allowance_${allowanceFromDate}_to_${allowanceToDate}.xlsx`);

      const totalAmt = dataRows.reduce((sum, r) => sum + (r[10] as number), 0);
      toast.success(`Shift Allowance downloaded — ${dataRows.length} row(s), ₹${totalAmt.toLocaleString("en-IN")} total allowance.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate allowance sheet.");
    } finally {
      setAllowanceLoading(false);
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
                          // Show "View Handover" if: never viewed, OR author has updated the text since last view
                          viewedHandoverIds.get(session.handover_id) !== session.handover_text ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                              onClick={() => {
                                setViewHandover(session);
                                setViewedHandoverIds((prev) => {
                                  const next = new Map(prev);
                                  // Store the current handover_text so edits are detected later
                                  next.set(session.handover_id!, session.handover_text ?? "");
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
                          // Only show Acknowledge once the current handover text has been viewed
                          viewedHandoverIds.get(session.handover_id) === session.handover_text &&
                          // Must be on an active shift to acknowledge
                          !!mySession && (
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
                        {!isDbaAdmin && (session.username === user?.username || isAdmin) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            onClick={() => setCancelConfirmSession(session)}
                            disabled={actionLoading}
                            title={`Cancel shift for ${session.username} (Mistaken login)`}
                          >
                            <XCircle className="h-4 w-4" />
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
                <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/30 p-4">
                  <div className="flex flex-wrap items-end gap-3">
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
                        const chosen = Number(shiftChoice) || (state?.preferred_shift ?? GENERAL_SHIFT_NUMBER);
                        if (chosen !== GENERAL_SHIFT_NUMBER && (state?.taken_shifts?.includes(chosen) || state?.disabled_shifts?.includes(chosen))) {
                          return true;
                        }
                        const lateCheck = isLateLogin(chosen);
                        if (lateCheck.isLate && !lateComment.trim()) {
                          return true;
                        }
                        return false;
                      })()}
                    >
                      {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      Login to Shift
                    </Button>
                  </div>

                  {(() => {
                    const chosen = Number(shiftChoice) || (state?.preferred_shift ?? GENERAL_SHIFT_NUMBER);
                    const lateCheck = isLateLogin(chosen);
                    if (!lateCheck.isLate) return null;
                    const hrs = Math.floor(lateCheck.minutesLate / 60);
                    const mins = lateCheck.minutesLate % 60;
                    const timeLabel = hrs > 0
                      ? `${hrs} ${hrs === 1 ? "hour" : "hours"}${mins > 0 ? ` ${mins} mins` : ""}`
                      : `${mins} mins`;
                    return (
                      <div className="mt-2 space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                          Late Login Notice ({timeLabel} past shift start)
                        </div>
                        <p className="text-muted-foreground">
                          You are logging in more than 1 hour after shift start. A reason/comment is mandatory.
                        </p>
                        <Label className="mt-2 block text-xs font-medium text-foreground">
                          Reason / Comment for Late Login <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          value={lateComment}
                          onChange={(e) => setLateComment(e.target.value)}
                          placeholder="Enter reason for late login..."
                          className="border-amber-500/40 bg-background/50 focus-visible:ring-amber-500/50"
                        />
                      </div>
                    );
                  })()}
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
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-emerald-900 dark:text-emerald-100">You are on shift</p>
                        <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          Active
                        </span>
                      </div>
                      <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                        {SHIFT_LABELS[mySession.shift_number] || `Shift ${mySession.shift_number}`} — logged in at {formatTime(mySession.login_at)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 gap-1.5 shrink-0 px-3 text-xs font-medium"
                    onClick={() => setCancelConfirmSession(mySession)}
                    disabled={actionLoading}
                    title="Cancel Shift (Mistaken Login) — Delete record from database"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel Shift
                  </Button>
                </div>

                {/* Existing handover display — not shown for General Shift */}
                {mySession.handover_text && !isMySessionGeneral && (
                  <div className="rounded-md border border-border/70 bg-background/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        Your handover
                      </span>
                      <div className="flex items-center gap-2">
                        {handoverBadge(mySession)}
                        {/* Edit button — opens modal for author to edit notes */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                          onClick={() => {
                            setHandoverText(mySession.handover_text ?? "");
                            setIsEditingHandover(true);
                          }}
                          disabled={actionLoading}
                          title="Edit your handover notes"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                      </div>
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

                {/* Handover text area — only for time-based shifts with no handover yet (first submit) */}
                {mySession.handover_status === "NONE" && !isMySessionGeneral && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      Handover Notes
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
                        onClick={() => void handleSubmitHandover(false)}
                        disabled={actionLoading || isEditorContentEmpty(handoverText)}
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
              onClick={() => void loadHistory(100)}
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

      {/* Shift Login & Logout Log History */}
      <ShiftLogHistorySection />

      {/* ----------------------------------------------------------------- */}
      {/* Shift Roster & Shift Allowance Downloads (Side-by-side)           */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Shift Roster Download */}
        <Card className="h-full flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                Shift Roster Download
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Date range inputs */}
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    From Date
                  </Label>
                  <Input
                    type="date"
                    value={rosterFromDate}
                    onChange={(e) => setRosterFromDate(e.target.value)}
                    className="h-9 w-44 text-xs"
                    max={rosterToDate || undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    To Date
                  </Label>
                  <Input
                    type="date"
                    value={rosterToDate}
                    onChange={(e) => setRosterToDate(e.target.value)}
                    className="h-9 w-44 text-xs"
                    min={rosterFromDate || undefined}
                  />
                </div>
                <Button
                  onClick={() => void handleDownloadRoster()}
                  disabled={rosterLoading || !rosterFromDate || !rosterToDate}
                  className="h-9 gap-2 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {rosterLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {rosterLoading ? "Generating…" : "Download Shift Roster"}
                </Button>
              </div>
            </CardContent>
          </div>
        </Card>

        {/* Shift Allowance Download */}
        <Card className="h-full flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wallet className="h-5 w-5 text-amber-400" />
                Shift Allowance Download
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Date range inputs */}
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    From Date
                  </Label>
                  <Input
                    type="date"
                    value={allowanceFromDate}
                    onChange={(e) => setAllowanceFromDate(e.target.value)}
                    className="h-9 w-44 text-xs"
                    max={allowanceToDate || undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    To Date
                  </Label>
                  <Input
                    type="date"
                    value={allowanceToDate}
                    onChange={(e) => setAllowanceToDate(e.target.value)}
                    className="h-9 w-44 text-xs"
                    min={allowanceFromDate || undefined}
                  />
                </div>
                <Button
                  onClick={() => void handleDownloadAllowance()}
                  disabled={allowanceLoading || !allowanceFromDate || !allowanceToDate}
                  className="h-9 gap-2 bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  {allowanceLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {allowanceLoading ? "Generating…" : "Download Shift Allowance"}
                </Button>
              </div>
            </CardContent>
          </div>
        </Card>
      </div>


      {/* Edit Handover Notes dialog — opens when author clicks Edit on an existing handover */}
      <Dialog open={isEditingHandover && !!mySession} onOpenChange={(open) => {
        if (!open) {
          setIsEditingHandover(false);
          setHandoverText("");
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-cyan-400" />
              Edit Handover Notes
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {mySession && (
                  <>
                    {SHIFT_LABELS[mySession.shift_number] || `Shift ${mySession.shift_number}`}
                    {" — "}
                    {handoverBadge(mySession)}
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {/* Contextual banner based on current handover status */}
          {mySession?.handover_status === "ACKNOWLEDGED" && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Re-submitting will <strong>reset the acknowledgement</strong>. Another DBA will need to acknowledge your handover again before you can logout.
              </span>
            </div>
          )}
          {mySession?.handover_status === "PENDING" && (
            <div className="flex items-start gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-xs text-cyan-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Updating will keep this handover <strong>pending</strong> — another DBA still needs to acknowledge it.
              </span>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Handover Notes</Label>
            <RichTextEditor
              value={handoverText}
              onChange={setHandoverText}
              placeholder="Write your handover notes for the next shift DBA..."
              minHeight={200}
              disabled={actionLoading}
              hideExpand
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsEditingHandover(false);
                setHandoverText("");
              }}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSubmitHandover(true)}
              disabled={actionLoading || isEditorContentEmpty(handoverText)}
            >
              {actionLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
              {mySession?.handover_status === "ACKNOWLEDGED" ? "Edit & Resubmit" : "Update Handover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Cancel shift confirmation dialog */}
      <Dialog open={!!cancelConfirmSession} onOpenChange={(open) => !open && setCancelConfirmSession(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <XCircle className="h-5 w-5" />
              Cancel Shift (Mistaken Login)
            </DialogTitle>
            <DialogDescription className="pt-1">
              Are you sure you want to cancel the shift for{" "}
              <strong className="text-foreground">{cancelConfirmSession?.username}</strong> (
              {SHIFT_LABELS[cancelConfirmSession?.shift_number ?? 1] || `Shift ${cancelConfirmSession?.shift_number}`})?
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300 space-y-1">
            <p className="font-semibold">Warning: Database Record Deletion</p>
            <p>
              This action will permanently delete this shift session record from the database and free up the shift.
              Use this option if you logged into the wrong shift by mistake and cannot satisfy logout requirements.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelConfirmSession(null)} disabled={actionLoading}>
              Keep Shift
            </Button>
            <Button variant="destructive" onClick={() => void handleCancelShift()} disabled={actionLoading}>
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Yes, Cancel Shift
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
              viewHandover.handover_id &&
              // Must be on an active shift to acknowledge
              (mySession ? (
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
              ) : (
                <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Login to a shift to acknowledge
                </div>
              ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full handover history dialog — dba_admin/app_admin only */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-cyan-400" />
              Handover History
            </DialogTitle>
            <DialogDescription>
              All historical handovers, most recent first. Click any entry to view the full text.
            </DialogDescription>
          </DialogHeader>
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 border-b border-border/60 pb-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Filter className="h-3 w-3" />
                Author
              </Label>
              <Select
                value={historyAuthorFilter}
                onValueChange={(val) => {
                  setHistoryAuthorFilter(val);
                  setHistoryPage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs bg-background/50 border-border/60">
                  <SelectValue placeholder="All Authors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Authors</SelectItem>
                  {historyAuthors.map((author) => (
                    <SelectItem key={author} value={author}>
                      {author}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                Date
              </Label>
              <Input
                type="date"
                value={historyDateFilter}
                onChange={(e) => {
                  setHistoryDateFilter(e.target.value);
                  setHistoryPage(0);
                }}
                className="h-8 w-[160px] text-xs bg-background/50 border-border/60"
              />
            </div>
            {(historyAuthorFilter !== "ALL" || historyDateFilter) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setHistoryAuthorFilter("ALL");
                  setHistoryDateFilter("");
                  setHistoryPage(0);
                }}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {handoverHistory.length === 0
                  ? "No handovers recorded."
                  : "No handovers match the selected filters."}
              </p>
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
          {!historyLoading && filteredHistory.length > 0 && (
            <div className="flex items-center justify-between border-t border-border/70 pt-3">
              <span className="text-xs text-muted-foreground">
                Showing {historyStart + 1}–{Math.min(historyEnd, filteredHistory.length)} of {filteredHistory.length}
                {(historyAuthorFilter !== "ALL" || historyDateFilter) && (
                  <span className="ml-1 text-muted-foreground/60">(filtered from {handoverHistory.length})</span>
                )}
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


    </div>
  );
}
