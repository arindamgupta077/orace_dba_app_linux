"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAppUsers, fetchShiftReport, fetchShiftReportTimeline } from "@/services/api";
import { ShiftLogHistorySection } from "@/components/admin/dba-console/shift-log-history-section";
import { useAppStore } from "@/store/use-app-store";
import { cn, formatDateTime, formatTime, toIstDateString, toIstDateStringOffset } from "@/lib/utils";
import { exportDataset, exportFullShiftReportPdf, stripHtml, ExportColumn, ExportMeta } from "@/lib/export";
import type {
  AppUser,
  ShiftReportData,
  ShiftReportFilters,
  ShiftReportSessionRow,
  ShiftReportTimelineEntry
} from "@/types/dba";

const TIMELINE_PAGE_SIZE = 15;
const LATE_LOGIN_BUFFER_MIN = 60;

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

function defaultFromDate(): string {
  return toIstDateStringOffset(new Date(), -30);
}

function todayStr(): string {
  return toIstDateString();
}

function shiftLabel(n: number): string {
  if (n === 1) return "Shift 1 (07:00-15:30)";
  if (n === 2) return "Shift 2 (14:30-23:00)";
  if (n === 3) return "Shift 3 (22:30-07:00)";
  if (n === 4) return "General Shift";
  return `Shift ${n}`;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sublabel,
  accent = "cyan"
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: "cyan" | "amber" | "green" | "red";
}) {
  const colors: Record<string, string> = {
    cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    green: "border-green-500/30 bg-green-500/10 text-green-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300"
  };
  return (
    <Card className="transition-all duration-200 hover:border-border/90 hover:shadow-glass">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {sublabel && <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>}
          </div>
          <div className={cn("rounded-lg border p-2 transition-transform duration-200 hover:scale-110", colors[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Renders HTML handover content safely. */
function HandoverContent({ html, className }: { html: string; className?: string }) {
  const isHtml = html.trim().startsWith("<") || /<\/?[a-z][\s\S]*>/i.test(html);
  if (isHtml) {
    return (
      <div
        className={cn("tiptap-content prose prose-sm max-w-none text-sm text-slate-900 dark:text-foreground/90 dark:prose-invert", className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <div className={cn("text-sm whitespace-pre-wrap text-slate-900 dark:text-foreground/90", className)}>{html}</div>;
}

const SESSION_COLORS = [
  { rowBg: "bg-cyan-500/10 hover:bg-cyan-500/15 border-l-4 border-l-cyan-600 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/15 dark:border-l-cyan-400", dot: "bg-cyan-500 dark:bg-cyan-400", badge: "border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300" },
  { rowBg: "bg-amber-500/10 hover:bg-amber-500/15 border-l-4 border-l-amber-600 dark:bg-amber-500/10 dark:hover:bg-amber-500/15 dark:border-l-amber-400", dot: "bg-amber-500 dark:bg-amber-400", badge: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
  { rowBg: "bg-purple-500/10 hover:bg-purple-500/15 border-l-4 border-l-purple-600 dark:bg-purple-500/10 dark:hover:bg-purple-500/15 dark:border-l-purple-400", dot: "bg-purple-500 dark:bg-purple-400", badge: "border-purple-300 bg-purple-100 text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300" },
  { rowBg: "bg-emerald-500/10 hover:bg-emerald-500/15 border-l-4 border-l-emerald-600 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15 dark:border-l-emerald-400", dot: "bg-emerald-500 dark:bg-emerald-400", badge: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" },
  { rowBg: "bg-rose-500/10 hover:bg-rose-500/15 border-l-4 border-l-rose-600 dark:bg-rose-500/10 dark:hover:bg-rose-500/15 dark:border-l-rose-400", dot: "bg-rose-500 dark:bg-rose-400", badge: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" },
  { rowBg: "bg-indigo-500/10 hover:bg-indigo-500/15 border-l-4 border-l-indigo-600 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15 dark:border-l-indigo-400", dot: "bg-indigo-500 dark:bg-indigo-400", badge: "border-indigo-300 bg-indigo-100 text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300" },
  { rowBg: "bg-orange-500/10 hover:bg-orange-500/15 border-l-4 border-l-orange-600 dark:bg-orange-500/10 dark:hover:bg-orange-500/15 dark:border-l-orange-400", dot: "bg-orange-500 dark:bg-orange-400", badge: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300" },
  { rowBg: "bg-sky-500/10 hover:bg-sky-500/15 border-l-4 border-l-sky-600 dark:bg-sky-500/10 dark:hover:bg-sky-500/15 dark:border-l-sky-400", dot: "bg-sky-500 dark:bg-sky-400", badge: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300" },
  { rowBg: "bg-pink-500/10 hover:bg-pink-500/15 border-l-4 border-l-pink-600 dark:bg-pink-500/10 dark:hover:bg-pink-500/15 dark:border-l-pink-400", dot: "bg-pink-500 dark:bg-pink-400", badge: "border-pink-300 bg-pink-100 text-pink-800 dark:border-pink-500/30 dark:bg-pink-500/10 dark:text-pink-300" },
  { rowBg: "bg-teal-500/10 hover:bg-teal-500/15 border-l-4 border-l-teal-600 dark:bg-teal-500/10 dark:hover:bg-teal-500/15 dark:border-l-teal-400", dot: "bg-teal-500 dark:bg-teal-400", badge: "border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300" }
];

function getSessionColor(sessionId?: number, customMap?: Map<number, (typeof SESSION_COLORS)[number]>) {
  if (!sessionId) return SESSION_COLORS[0];
  if (customMap && customMap.has(sessionId)) {
    return customMap.get(sessionId)!;
  }
  const idx = Math.abs(sessionId * 7) % SESSION_COLORS.length;
  return SESSION_COLORS[idx];
}

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" }
];

function getYearOptions(): string[] {
  const current = new Date().getFullYear();
  const years: string[] = [];
  for (let y = current - 5; y <= current + 2; y++) {
    years.push(String(y));
  }
  return years;
}

function getMatchingMonthYear(fromStr: string, toStr: string): { month: string; year: string } {
  if (!fromStr || !toStr) return { month: "all", year: "all" };
  const fromParts = fromStr.split("-");
  const toParts = toStr.split("-");
  if (fromParts.length !== 3 || toParts.length !== 3) return { month: "all", year: "all" };

  const [fromY, fromM, fromD] = fromParts;
  const [toY, toM, toD] = toParts;

  if (fromY === toY && fromM === toM && fromD === "01") {
    const yNum = Number(fromY);
    const mNum = Number(fromM);
    const lastDay = new Date(yNum, mNum, 0).getDate();
    if (Number(toD) === lastDay) {
      return { month: String(mNum), year: String(yNum) };
    }
  }
  return { month: "all", year: "all" };
}

export function ShiftReportSection() {
  const user = useAppStore((s) => s.user);
  const exportedBy = user?.username || "app_admin";

  const [report, setReport] = useState<ShiftReportData | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(todayStr());

  const initialMatch = useMemo(() => getMatchingMonthYear(defaultFromDate(), todayStr()), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(initialMatch.month);
  const [selectedYear, setSelectedYear] = useState<string>(initialMatch.year);

  const [dbaUserId, setDbaUserId] = useState<string>("all");
  const [shiftNumber, setShiftNumber] = useState<string>("all");

  const yearOptions = useMemo(() => getYearOptions(), []);

  const handleMonthYearChange = (mVal: string, yVal: string) => {
    let targetYear = yVal;
    const targetMonth = mVal;

    if (targetMonth !== "all" && targetYear === "all") {
      targetYear = String(new Date().getFullYear());
    }

    setSelectedMonth(targetMonth);
    setSelectedYear(targetYear);

    if (targetMonth !== "all" && targetYear !== "all") {
      const m = Number(targetMonth);
      const y = Number(targetYear);
      const pad = (n: number) => String(n).padStart(2, "0");
      const firstDate = `${y}-${pad(m)}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const lastDate = `${y}-${pad(m)}-${pad(lastDay)}`;
      setFromDate(firstDate);
      setToDate(lastDate);
    } else if (targetMonth === "all" && targetYear !== "all") {
      const y = Number(targetYear);
      const firstDate = `${y}-01-01`;
      const lastDate = `${y}-12-31`;
      setFromDate(firstDate);
      setToDate(lastDate);
    }
  };

  const handleDateInputChange = (newFrom: string, newTo: string) => {
    setFromDate(newFrom);
    setToDate(newTo);
    const match = getMatchingMonthYear(newFrom, newTo);
    setSelectedMonth(match.month);
    setSelectedYear(match.year);
  };

  // Activity timeline — client-driven pagination + filters (server-side)
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineEvent, setTimelineEvent] = useState<string>("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineSearchInput, setTimelineSearchInput] = useState("");
  const [selectedHandoverNote, setSelectedHandoverNote] = useState<ShiftReportTimelineEntry | null>(null);
  const [showAllHandoversModal, setShowAllHandoversModal] = useState(false);
  const [allHandoversPage, setAllHandoversPage] = useState(1);
  const ALL_HANDOVERS_PAGE_SIZE = 5;

  const allHandoversTotalPages = Math.max(1, Math.ceil((report?.handovers.length || 0) / ALL_HANDOVERS_PAGE_SIZE));

  const pagedHandovers = useMemo(() => {
    if (!report?.handovers) return [];
    const start = (allHandoversPage - 1) * ALL_HANDOVERS_PAGE_SIZE;
    return report.handovers.slice(start, start + ALL_HANDOVERS_PAGE_SIZE);
  }, [report, allHandoversPage]);

  const activeHandoverNote = useMemo(() => {
    if (!selectedHandoverNote || !report) return null;
    if (selectedHandoverNote.handover_id) {
      const match = report.handovers.find((h) => h.handover_id === selectedHandoverNote.handover_id);
      if (match) return match;
    }
    return report.handovers.find(
      (h) => h.author_username === selectedHandoverNote.username && h.shift_number === selectedHandoverNote.shift_number
    );
  }, [selectedHandoverNote, report]);

  const activeHandoverText = activeHandoverNote?.handover_text || selectedHandoverNote?.handover_text || selectedHandoverNote?.detail || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: ShiftReportFilters = {
        fromDate,
        toDate,
        dbaUserId: dbaUserId !== "all" ? Number(dbaUserId) : undefined,
        shiftNumber: shiftNumber !== "all" ? Number(shiftNumber) : undefined,
        timelinePage,
        timelinePageSize: TIMELINE_PAGE_SIZE,
        timelineEvent: timelineEvent !== "all" ? timelineEvent : undefined,
        timelineSearch: timelineSearch.trim() || undefined
      };
      const result = await fetchShiftReport(filters);
      setReport(result.report);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shift report.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, dbaUserId, shiftNumber, timelinePage, timelineEvent, timelineSearch]);

  const loadTimelineOnly = useCallback(async () => {
    if (!report) return;
    try {
      const filters: ShiftReportFilters = {
        fromDate,
        toDate,
        dbaUserId: dbaUserId !== "all" ? Number(dbaUserId) : undefined,
        shiftNumber: shiftNumber !== "all" ? Number(shiftNumber) : undefined,
        timelinePage,
        timelinePageSize: TIMELINE_PAGE_SIZE,
        timelineEvent: timelineEvent !== "all" ? timelineEvent : undefined,
        timelineSearch: timelineSearch.trim() || undefined
      };
      const result = await fetchShiftReportTimeline(filters);
      setReport((prev) =>
        prev
          ? {
              ...prev,
              activityTimeline: result.timeline.rows,
              timelineTotal: result.timeline.total
            }
          : prev
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update timeline.");
    }
  }, [fromDate, toDate, dbaUserId, shiftNumber, timelinePage, timelineEvent, timelineSearch, report]);

  // Initial load or main filter changes (dates, dba, shift) -> load full report
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, dbaUserId, shiftNumber]);

  // Timeline filter/pagination changes -> load timeline only (fast)
  useEffect(() => {
    if (report) {
      void loadTimelineOnly();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelinePage, timelineEvent, timelineSearch]);

  useEffect(() => {
    void fetchAppUsers()
      .then((res) => setUsers(res.users || []))
      .catch(() => {});
  }, []);

  const dbaUsers = useMemo(() => users.filter((u) => u.role === "dba_admin" || u.role === "app_admin"), [users]);

  const periodLabel = `${fromDate} to ${toDate}`;
  const filterLabel = `DBA: ${dbaUserId === "all" ? "All" : dbaUsers.find((u) => String(u.userId) === dbaUserId)?.username || dbaUserId} | Shift: ${shiftNumber === "all" ? "All" : shiftLabel(Number(shiftNumber))}`;

  const loginTrendData = useMemo(() => {
    if (!report) return [];
    return report.loginTrend
      .slice()
      .reverse()
      .map((t) => ({
        date: t.shift_date.slice(5),
        Shift1: t.shift_number === 1 ? t.hours : 0,
        Shift2: t.shift_number === 2 ? t.hours : 0,
        Shift3: t.shift_number === 3 ? t.hours : 0
      }))
      .reduce((acc, curr) => {
        const existing = acc.find((a) => a.date === curr.date);
        if (existing) {
          existing.Shift1 = Math.round((existing.Shift1 + curr.Shift1) * 10) / 10;
          existing.Shift2 = Math.round((existing.Shift2 + curr.Shift2) * 10) / 10;
          existing.Shift3 = Math.round((existing.Shift3 + curr.Shift3) * 10) / 10;
        } else {
          acc.push(curr);
        }
        return acc;
      }, [] as Array<{ date: string; Shift1: number; Shift2: number; Shift3: number }>);
  }, [report]);

  const userShiftCounts = useMemo(() => {
    if (!report) return [];

    const workHoursMap = new Map<string, (typeof report.userWorkHours)[number]>();
    report.userWorkHours.forEach((row) => {
      workHoursMap.set(row.username.toLowerCase(), row);
      workHoursMap.set(String(row.user_id), row);
    });

    const userList =
      users.length > 0
        ? users
        : report.userWorkHours.map((u) => ({ userId: u.user_id, username: u.username, role: "dba_admin" }));

    let list = userList
      .map((u) => {
        const stats = workHoursMap.get(String(u.userId)) || workHoursMap.get(u.username.toLowerCase());
        const s1 = stats?.shift1_completed ?? 0;
        const s2 = stats?.shift2_completed ?? 0;
        const s3 = stats?.shift3_completed ?? 0;
        const s4 = stats?.shift4_completed ?? 0;
        return {
          userId: u.userId,
          username: u.username,
          role: u.role,
          shift1_completed: s1,
          shift2_completed: s2,
          shift3_completed: s3,
          shift4_completed: s4,
          total_completed: s1 + s2 + s3 + s4
        };
      })
      .filter((u) => u.total_completed > 0);

    if (dbaUserId !== "all") {
      list = list.filter((u) => String(u.userId) === dbaUserId);
    }

    return list.sort((a, b) => b.total_completed - a.total_completed || a.username.localeCompare(b.username));
  }, [users, report, dbaUserId]);

  const timelineSessionColorMap = useMemo(() => {
    if (!report?.activityTimeline) return new Map<number, (typeof SESSION_COLORS)[number]>();

    const colorMap = new Map<number, (typeof SESSION_COLORS)[number]>();
    let prevIndex = -1;

    report.activityTimeline.forEach((evt) => {
      if (evt.session_id && !colorMap.has(evt.session_id)) {
        let nextIndex = prevIndex === -1 ? Math.abs(evt.session_id * 7) % SESSION_COLORS.length : (prevIndex + 3) % SESSION_COLORS.length;
        if (nextIndex === prevIndex) {
          nextIndex = (nextIndex + 1) % SESSION_COLORS.length;
        }
        colorMap.set(evt.session_id, SESSION_COLORS[nextIndex]);
        prevIndex = nextIndex;
      }
    });

    return colorMap;
  }, [report?.activityTimeline]);

  // ---------- Export definitions ----------
  const baseMeta = (title: string): ExportMeta => ({
    title,
    exportedBy,
    periodLabel,
    filterLabel
  });

  const handleExport = (
    kind: "logins" | "attendance" | "timeline" | "dbChecks" | "backupChecks" | "handovers" | "sessions" | "lateLogins" | "coverage" | "workHours" | "shiftCounts",
    format: "pdf" | "excel"
  ) => {
    if (!report) return;
    switch (kind) {
      case "logins": {
        const cols: ExportColumn<ShiftReportData["loginTrend"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "Logins", value: (r) => r.logins, align: "right" },
          { header: "Login Hours", value: (r) => r.hours, align: "right" }
        ];
        exportDataset(format, cols, report.loginTrend, baseMeta("Shift Login Trend"));
        break;
      }
      case "attendance": {
        const cols: ExportColumn<ShiftReportData["dailyAttendance"][number]>[] = [
          { header: "Date", value: (r) => r.attendance_date, align: "center" },
          { header: "Unique DBAs", value: (r) => r.unique_dbas, align: "right" },
          { header: "Total Logins", value: (r) => r.total_logins, align: "right" }
        ];
        exportDataset(format, cols, report.dailyAttendance, baseMeta("Daily Attendance"));
        break;
      }
      case "timeline": {
        const cols: ExportColumn<ShiftReportTimelineEntry>[] = [
          { header: "Event", value: (r) => r.event, align: "left" },
          { header: "DBA (Username)", value: (r) => r.username, align: "left" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "Timestamp", value: (r) => r.timestamp, align: "center" },
          { header: "Detail", value: (r) => r.detail || "", align: "left" }
        ];
        exportDataset(format, cols, report.activityTimeline, baseMeta("Activity Timeline"));
        break;
      }
      case "dbChecks": {
        const cols: ExportColumn<ShiftReportData["dbStatusChecks"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "Database", value: (r) => r.database_name, align: "left" },
          { header: "Status", value: (r) => r.status, align: "center" },
          { header: "DBA (Username)", value: (r) => r.checked_username, align: "left" },
          { header: "Checked At", value: (r) => r.checked_at, align: "center" },
          { header: "Comment", value: (r) => r.comment_text || "", align: "left" },
          { header: "Realtime Check", value: (r) => (r.is_realtime_check ? "Yes" : "No"), align: "center" }
        ];
        exportDataset(format, cols, report.dbStatusChecks, baseMeta("PROD Database Availability Checklist"));
        break;
      }
      case "backupChecks": {
        const cols: ExportColumn<ShiftReportData["backupStatusChecks"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "Database", value: (r) => r.database_name, align: "left" },
          { header: "Backup", value: (r) => r.backup_name, align: "left" },
          { header: "Status", value: (r) => r.status, align: "center" },
          { header: "DBA (Username)", value: (r) => r.checked_username, align: "left" },
          { header: "Checked At", value: (r) => r.checked_at, align: "center" },
          { header: "Comment", value: (r) => r.comment_text || "", align: "left" }
        ];
        exportDataset(format, cols, report.backupStatusChecks, baseMeta("Backup Status Checklist"));
        break;
      }
      case "handovers": {
        const cols: ExportColumn<ShiftReportData["handovers"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "Author (Username)", value: (r) => r.author_username, align: "left" },
          { header: "Created At", value: (r) => r.created_at, align: "center" },
          { header: "Status", value: (r) => r.status, align: "center" },
          { header: "Acknowledged By", value: (r) => r.ack_username || "", align: "left" },
          { header: "Acknowledged At", value: (r) => r.ack_at || "", align: "center" },
          { header: "Handover Text", value: (r) => stripHtml(r.handover_text || ""), align: "left" }
        ];
        exportDataset(format, cols, report.handovers, baseMeta("Handover (HO) Report"));
        break;
      }
      case "sessions": {
        const cols: ExportColumn<ShiftReportSessionRow>[] = [
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "DBA (Username)", value: (r) => r.username, align: "left" },
          { header: "Login At", value: (r) => r.login_at, align: "center" },
          { header: "Logout At", value: (r) => r.logout_at || "", align: "center" },
          { header: "Status", value: (r) => r.status, align: "center" },
          { header: "Active", value: (r) => (r.is_active ? "Yes" : "No"), align: "center" },
          { header: "Duration (min)", value: (r) => r.duration_min ?? "", align: "right" }
        ];
        exportDataset(format, cols, report.sessions, baseMeta("Login/Logout Sessions"));
        break;
      }
      case "lateLogins": {
        const cols: ExportColumn<ShiftReportData["lateLogins"][number]>[] = [
          { header: "DBA (Username)", value: (r) => r.username, align: "left" },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number), align: "left" },
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Login At", value: (r) => r.login_at, align: "center" },
          { header: "Minutes Late", value: (r) => r.minutes_late, align: "right" },
          { header: "Reason / Comment", value: (r) => r.late_comment || "", align: "left" }
        ];
        exportDataset(format, cols, report.lateLogins, baseMeta("Late Logins"));
        break;
      }
      case "coverage": {
        const cols: ExportColumn<ShiftReportData["coverage"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date, align: "center" },
          { header: "Covered (min)", value: (r) => r.covered_minutes, align: "right" },
          { header: "Gap (min)", value: (r) => r.gap_minutes, align: "right" },
          { header: "Coverage %", value: (r) => `${r.coverage_pct}%`, align: "center" },
          { header: "Uncovered Shifts", value: (r) => (r.uncovered_shifts.length > 0 ? r.uncovered_shifts.map((sn) => `Shift ${sn}`).join(", ") : "—"), align: "left" }
        ];
        exportDataset(format, cols, report.coverage, baseMeta("Shift Coverage"));
        break;
      }
      case "workHours": {
        const cols: ExportColumn<ShiftReportData["userWorkHours"][number]>[] = [
          { header: "DBA (Username)", value: (r) => r.username, align: "left" },
          { header: "Total Worked Hours", value: (r) => `${r.total_hours} hrs (${Math.floor(r.total_minutes / 60)}h ${r.total_minutes % 60}m)`, align: "right" },
          { header: "Total Sessions", value: (r) => r.total_sessions, align: "right" },
          { header: "Completed Sessions", value: (r) => r.completed_sessions, align: "right" },
          { header: "Active Sessions", value: (r) => r.active_sessions, align: "right" },
          { header: "Avg Session (min)", value: (r) => r.avg_session_minutes, align: "right" },
          { header: "Shift 1 Hours", value: (r) => r.shift1_hours, align: "right" },
          { header: "Shift 2 Hours", value: (r) => r.shift2_hours, align: "right" },
          { header: "Shift 3 Hours", value: (r) => r.shift3_hours, align: "right" },
          { header: "General Shift Hours", value: (r) => r.shift4_hours, align: "right" },
          { header: "Last Login At", value: (r) => (r.last_login_at ? formatDateTime(r.last_login_at) : "—"), align: "center" }
        ];
        exportDataset(format, cols, report.userWorkHours, baseMeta("Total Worked Hours per User"));
        break;
      }
      case "shiftCounts": {
        const cols: ExportColumn<(typeof userShiftCounts)[number]>[] = [
          { header: "User / DBA", value: (r) => r.username, align: "left" },
          { header: "Role", value: (r) => r.role || "", align: "left" },
          { header: "Morning Shift Completed", value: (r) => r.shift1_completed, align: "center" },
          { header: "Afternoon Shift Completed", value: (r) => r.shift2_completed, align: "center" },
          { header: "Night Shift Completed", value: (r) => r.shift3_completed, align: "center" },
          { header: "General Shift Completed", value: (r) => r.shift4_completed, align: "center" },
          { header: "Total Completed Shifts", value: (r) => r.total_completed, align: "center" }
        ];
        exportDataset(format, cols, userShiftCounts, baseMeta("User Completed Shifts Breakdown"));
        break;
      }
    }
  };

  // Timeline pagination math
  const timelineTotalPages = report ? Math.max(1, Math.ceil(report.timelineTotal / TIMELINE_PAGE_SIZE)) : 1;
  const timelineStartIdx = report ? (timelinePage - 1) * TIMELINE_PAGE_SIZE + 1 : 0;
  const timelineEndIdx = report ? Math.min(timelinePage * TIMELINE_PAGE_SIZE, report.timelineTotal) : 0;

  const applyTimelineSearch = () => {
    setTimelinePage(1);
    setTimelineSearch(timelineSearchInput);
  };

  if (loading && !report) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-end gap-3">
              <Skeleton className="h-10 w-36 rounded-md" />
              <Skeleton className="h-10 w-32 rounded-md" />
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-44 rounded-md" />
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-24 rounded-md" />
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <Skeleton className="dba-skeleton h-16 w-full rounded-md" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="dba-skeleton h-64 w-full rounded-md" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!report) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Unable to load shift report.
        </CardContent>
      </Card>
    );
  }

  const overallCompliance = report.checklistCompletion.completion_pct;

  return (
    <div className="dba-fade-in space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Month</Label>
              <Select value={selectedMonth} onValueChange={(val) => handleMonthYearChange(val, selectedYear)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Select Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select Month</SelectItem>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Year</Label>
              <Select value={selectedYear} onValueChange={(val) => handleMonthYearChange(selectedMonth, val)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select Year</SelectItem>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => handleDateInputChange(e.target.value, toDate)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={toDate} onChange={(e) => handleDateInputChange(fromDate, e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">DBA</Label>
              <Select value={dbaUserId} onValueChange={setDbaUserId}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All DBAs</SelectItem>
                  {dbaUsers.map((u) => (
                    <SelectItem key={u.userId} value={String(u.userId)}>
                      {u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Shift</Label>
              <Select value={shiftNumber} onValueChange={setShiftNumber}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shifts</SelectItem>
                  <SelectItem value="1">Shift 1 (07:00-15:30)</SelectItem>
                  <SelectItem value="2">Shift 2 (14:30-23:00)</SelectItem>
                  <SelectItem value="3">Shift 3 (22:30-07:00)</SelectItem>
                  <SelectItem value="4">General Shift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Apply
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (report) {
                  exportFullShiftReportPdf(report, userShiftCounts, baseMeta("Full Executive Shift Report"));
                }
              }}
              disabled={loading || !report}
              className="ml-auto gap-1.5 border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300"
            >
              <FileText className="h-4 w-4 text-red-500" />
              Export Full PDF Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary & Operational Health — Combined in a single row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
        {/* Executive summary — 4 columns */}
        <div className="space-y-3 lg:col-span-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Executive Summary</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              icon={Users}
              label="Active DBAs Now"
              value={report.activeDbas.length}
              sublabel={`${report.dailyAttendance[0]?.unique_dbas ?? 0} unique today`}
              accent="green"
            />
            <MetricCard
              icon={Clock}
              label="Avg Login Duration"
              value={`${(report.avgLoginDurationMin / 60).toFixed(1)}h`}
              sublabel="per closed session"
              accent="cyan"
            />
            <MetricCard
              icon={ShieldCheck}
              label="Checklist Compliance"
              value={`${overallCompliance}%`}
              sublabel={`${report.checklistCompletion.completed}/${report.checklistCompletion.total} checks`}
              accent={overallCompliance >= 90 ? "green" : "amber"}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Exceptions"
              value={report.lateLogins.length + report.pendingHandovers.length}
              sublabel={`${report.lateLogins.length} late • ${report.pendingHandovers.length} pending HO`}
              accent="red"
            />
          </div>
        </div>

        {/* Operational health — 2 columns */}
        <div className="space-y-3 lg:col-span-2">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Operational Health</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CompletionCard
              title="DB Availability Checks"
              data={report.dbStatusCompletion}
            />
            <CompletionCard
              title="Backup Completion"
              data={report.backupCompletion}
            />
          </div>
        </div>
      </div>

      {/* Shift coverage + Login trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-cyan-400" />
              Shift Coverage
            </CardTitle>
            <ExportMenu
              label="Coverage"
              onExport={(fmt) => handleExport("coverage", fmt)}
            />
          </CardHeader>
          <CardContent>
            {report.coverage.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No coverage data for the selected period.</p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Covered</TableHead>
                      <TableHead>Gap</TableHead>
                      <TableHead>Coverage</TableHead>
                      <TableHead>Uncovered Shifts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.coverage.slice(0, 30).map((c, i) => {
                      const covH = Math.floor(c.covered_minutes / 60);
                      const covM = c.covered_minutes % 60;
                      const gapH = Math.floor(c.gap_minutes / 60);
                      const gapM = c.gap_minutes % 60;
                      return (
                        <TableRow key={`${c.shift_date}-${i}`}>
                          <TableCell className="font-medium">{c.shift_date}</TableCell>
                          <TableCell>{covH}h {covM}m</TableCell>
                          <TableCell>
                            {c.gap_minutes > 0 ? (
                              <span className="text-amber-300">{gapH}h {gapM}m</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn(
                              c.coverage_pct >= 100
                                ? "border-green-500/30 bg-green-500/10 text-green-300"
                                : c.coverage_pct >= 50
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                  : "border-red-500/30 bg-red-500/10 text-red-300"
                            )}>
                              {c.coverage_pct}%
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {c.uncovered_shifts.length > 0 ? (
                              <Badge className="border-red-500/30 bg-red-500/10 text-red-300">
                                {c.uncovered_shifts.map((sn) => `Shift ${sn}`).join(", ")}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              Login Trend by Shift
            </CardTitle>
            <ExportMenu
              label="Logins"
              onExport={(fmt) => handleExport("logins", fmt)}
            />
          </CardHeader>
          <CardContent>
            {loginTrendData.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                  <BarChart3 className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">No login data for the selected period.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={loginTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,163,184,0.15)" />
                  <XAxis dataKey="date" tick={{ fill: "#8ea3b8", fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: "#8ea3b8", fontSize: 11 }}
                    tickFormatter={(v: number) => `${v}h`}
                    allowDecimals
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(35,211,238,0.06)" }}
                    contentStyle={{
                      background: "linear-gradient(180deg, rgba(18,23,34,0.96), rgba(12,16,24,0.92))",
                      border: "1px solid rgba(35,211,238,0.25)",
                      borderRadius: 10,
                      fontSize: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)"
                    }}
                    labelStyle={{ color: "#8ea3b8", fontWeight: 600 }}
                    formatter={(value: number | string, name: string) => [
                      `${Number(value).toFixed(1)} hrs`,
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Shift1" stackId="a" fill="#18c37e" name="Shift 1" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Shift2" stackId="a" fill="#ffb020" name="Shift 2" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Shift3" stackId="a" fill="#3b82f6" name="Shift 3" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attendance + Active DBAs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-cyan-400" />
              Daily Attendance
            </CardTitle>
            <ExportMenu label="Attendance" onExport={(fmt) => handleExport("attendance", fmt)} />
          </CardHeader>
          <CardContent>
            {report.dailyAttendance.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No attendance data.</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Unique DBAs</TableHead>
                      <TableHead>Total Logins</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.dailyAttendance.slice(0, 30).map((row) => (
                      <TableRow key={row.attendance_date}>
                        <TableCell className="font-medium">{row.attendance_date}</TableCell>
                        <TableCell>{row.unique_dbas}</TableCell>
                        <TableCell>{row.total_logins}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              Monthly Attendance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.monthlyAttendance.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No attendance data.</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead>Unique DBAs</TableHead>
                      <TableHead>Total Logins</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.monthlyAttendance.map((row) => (
                      <TableRow key={row.month}>
                        <TableCell className="font-medium">{row.month}</TableCell>
                        <TableCell>{row.unique_dbas}</TableCell>
                        <TableCell>{row.total_logins}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-4 w-4 text-green-400" />
              Active DBAs Now
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.activeDbas.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No DBAs currently logged in.</p>
            ) : (
              <div className="space-y-2">
                {report.activeDbas.map((d) => (
                  <div key={d.session_id} className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <span className={cn("dba-avatar h-9 w-9 border text-xs", avatarFromName(d.username).color)}>
                      {avatarFromName(d.username).initials}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{d.username}</p>
                      <p className="text-xs text-muted-foreground">
                        {shiftLabel(d.shift_number)} • {formatTime(d.login_at)}
                      </p>
                    </div>
                    <Badge className="border-green-500/30 bg-green-500/10 text-green-300">
                      <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-400" />
                      Active
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Shift Login & Logout Log History */}
      <ShiftLogHistorySection
        fromDate={fromDate}
        toDate={toDate}
        dbaUserId={dbaUserId !== "all" ? Number(dbaUserId) : undefined}
        shiftNumber={shiftNumber !== "all" ? Number(shiftNumber) : undefined}
        hideViewFullHistoryButton={true}
        pageSize={5}
      />

      {/* Exceptions — late logins */}
      {report.lateLogins.length > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Late Logins (&gt;{LATE_LOGIN_BUFFER_MIN} min after shift start)
            </CardTitle>
            <ExportMenu label="Late Logins" onExport={(fmt) => handleExport("lateLogins", fmt)} />
          </CardHeader>
          <CardContent>
            <div className="max-h-[320px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>DBA</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Login Time</TableHead>
                    <TableHead>Minutes Late</TableHead>
                    <TableHead>Reason / Comment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lateLogins.map((l) => (
                    <TableRow key={l.session_id}>
                      <TableCell className="font-medium">{l.username}</TableCell>
                      <TableCell>Shift {l.shift_number}</TableCell>
                      <TableCell>{l.shift_date}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(l.login_at)}
                      </TableCell>
                      <TableCell>
                        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                          +{Math.floor(l.minutes_late / 60) > 0
                            ? `${Math.floor(l.minutes_late / 60)}h ${l.minutes_late % 60}m`
                            : `${l.minutes_late}m`}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[250px] truncate text-sm text-muted-foreground" title={l.late_comment}>
                        {l.late_comment || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Completed Shifts Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserCheck className="h-5 w-5 text-cyan-400" />
              Completed Shifts per User (Morning, Afternoon, Night & General)
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Number of completed Morning, Afternoon, Night, and General shifts per user for period <span className="font-medium text-foreground">{periodLabel}</span>.
            </p>
          </div>
          <ExportMenu label="Completed Shifts" onExport={(fmt) => handleExport("shiftCounts", fmt)} />
        </CardHeader>
        <CardContent>
          {userShiftCounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No user shift data found.</p>
          ) : (
            <div className="max-h-[450px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User / DBA</TableHead>
                    <TableHead className="text-center">Morning Shift</TableHead>
                    <TableHead className="text-center">Afternoon Shift</TableHead>
                    <TableHead className="text-center">Night Shift</TableHead>
                    <TableHead className="text-center">General Shift</TableHead>
                    <TableHead className="text-center">Total Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userShiftCounts.map((u) => {
                    const avatar = avatarFromName(u.username);
                    return (
                      <TableRow key={u.userId} className="hover:bg-muted/40">
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-2.5">
                            <span className={cn("dba-avatar h-8 w-8 border text-xs shrink-0", avatar.color)}>
                              {avatar.initials}
                            </span>
                            <div>
                              <p className="text-sm font-medium leading-none">{u.username}</p>
                              {u.role && (
                                <p className="text-[11px] text-muted-foreground capitalize mt-1">{u.role.replace("_", " ")}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-semibold min-w-[32px] justify-center",
                              u.shift1_completed > 0
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                : "bg-muted/40 text-muted-foreground border border-border/40"
                            )}
                          >
                            {u.shift1_completed}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-semibold min-w-[32px] justify-center",
                              u.shift2_completed > 0
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                                : "bg-muted/40 text-muted-foreground border border-border/40"
                            )}
                          >
                            {u.shift2_completed}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-semibold min-w-[32px] justify-center",
                              u.shift3_completed > 0
                                ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30"
                                : "bg-muted/40 text-muted-foreground border border-border/40"
                            )}
                          >
                            {u.shift3_completed}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-semibold min-w-[32px] justify-center",
                              u.shift4_completed > 0
                                ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30"
                                : "bg-muted/40 text-muted-foreground border border-border/40"
                            )}
                          >
                            {u.shift4_completed}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            className={cn(
                              "px-2.5 py-0.5 text-xs font-bold min-w-[36px] justify-center",
                              u.total_completed > 0
                                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
                                : "border-border bg-muted/30 text-muted-foreground"
                            )}
                          >
                            {u.total_completed}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Total Worked Hours per User */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-cyan-400" />
              Total Worked Hours per User
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Calculated from user shift login and logout times for period <span className="font-medium text-foreground">{periodLabel}</span>.
            </p>
          </div>
          <ExportMenu label="Work Hours" onExport={(fmt) => handleExport("workHours", fmt)} />
        </CardHeader>
        <CardContent>
          {report.userWorkHours.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                <Clock className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">No shift work sessions found for the selected period.</p>
            </div>
          ) : (
            <div className="max-h-[380px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>DBA User</TableHead>
                    <TableHead>Total Hours Worked</TableHead>
                    <TableHead>Sessions (Active / Total)</TableHead>
                    <TableHead>Avg Session</TableHead>
                    <TableHead>Shift Breakdown</TableHead>
                    <TableHead>Last Login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const maxHours = Math.max(...report.userWorkHours.map((u) => u.total_hours), 1);
                    return report.userWorkHours.map((u) => {
                      const avatar = avatarFromName(u.username);
                      const hoursInt = Math.floor(u.total_minutes / 60);
                      const minsRem = u.total_minutes % 60;
                      const pct = Math.min(100, Math.round((u.total_hours / maxHours) * 100));

                      return (
                        <TableRow key={u.user_id} className="hover:bg-muted/40">
                          <TableCell className="font-semibold">
                            <div className="flex items-center gap-2.5">
                              <span className={cn("dba-avatar h-8 w-8 border text-xs shrink-0", avatar.color)}>
                                {avatar.initials}
                              </span>
                              <span>{u.username}</span>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <div className="space-y-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="font-bold text-cyan-400">
                                  {hoursInt}h {minsRem}m
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  ({u.total_hours} hrs)
                                </span>
                              </div>
                              <Progress value={pct} className="h-1.5 dba-progress-cyan" />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="border-slate-300 dark:border-slate-700">
                                {u.completed_sessions} completed
                              </Badge>
                              {u.active_sessions > 0 && (
                                <Badge className="border-green-500/30 bg-green-500/10 text-green-300">
                                  {u.active_sessions} active
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {Math.floor(u.avg_session_minutes / 60) > 0
                              ? `${Math.floor(u.avg_session_minutes / 60)}h ${u.avg_session_minutes % 60}m`
                              : `${u.avg_session_minutes}m`}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 text-xs">
                              {u.shift1_hours > 0 && (
                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  S1: {u.shift1_hours}h
                                </Badge>
                              )}
                              {u.shift2_hours > 0 && (
                                <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  S2: {u.shift2_hours}h
                                </Badge>
                              )}
                              {u.shift3_hours > 0 && (
                                <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  S3: {u.shift3_hours}h
                                </Badge>
                              )}
                              {u.shift4_hours > 0 && (
                                <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                  Gen: {u.shift4_hours}h
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {u.last_login_at ? formatDateTime(u.last_login_at) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity timeline with pagination + filters */}
      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0">
          <div className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Activity Timeline
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300 dark:hover:bg-purple-500/20 dark:hover:text-purple-200"
                onClick={() => setShowAllHandoversModal(true)}
              >
                <FileText className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                View Handover Notes ({report.handovers.length})
              </Button>
              <ExportMenu label="Timeline" onExport={(fmt) => handleExport("timeline", fmt)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={timelineEvent}
              onValueChange={(v) => {
                setTimelineEvent(v);
                setTimelinePage(1);
              }}
            >
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="login">Logins</SelectItem>
                <SelectItem value="logout">Logouts</SelectItem>
                <SelectItem value="handover">Handover Notes</SelectItem>
                <SelectItem value="acknowledge">Acknowledgements</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={timelineSearchInput}
              onChange={(e) => setTimelineSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyTimelineSearch();
              }}
              placeholder="Search DBA username or detail..."
              className="h-9 w-52"
            />
            <Button size="sm" variant="outline" onClick={applyTimelineSearch}>
              Search
            </Button>
            {timelineSearch && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTimelineSearchInput("");
                  setTimelineSearch("");
                  setTimelinePage(1);
                }}
              >
                Clear
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {timelineStartIdx}-{timelineEndIdx} of {report.timelineTotal}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {report.activityTimeline.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30">
                <Activity className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">No activity recorded for the selected period.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>DBA</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.activityTimeline.map((event, i) => {
                    const isHandover = event.event === "handover" || event.event === "handover_notes";
                    const hasHandoverNote = isHandover;
                    const sessionStyle = getSessionColor(event.session_id, timelineSessionColorMap);

                    return (
                      <TableRow
                        key={i}
                        className={cn(
                          "transition-colors",
                          event.session_id ? sessionStyle.rowBg : "hover:bg-muted/40"
                        )}
                      >
                        <TableCell>
                          <Badge
                            className={cn(
                              "font-medium shadow-xs",
                              event.event === "login" && "border-green-300 bg-green-100 text-green-800 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
                              event.event === "logout" && "border-red-300 bg-red-100 text-red-800 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300",
                              isHandover && "border-purple-300 bg-purple-100 text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-300",
                              event.event === "acknowledge" && "border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300",
                              (!["login", "logout", "handover", "handover_notes", "acknowledge"].includes(event.event)) && "border-slate-300 bg-slate-100 text-slate-700 dark:border-muted-foreground/30 dark:bg-muted/20 dark:text-muted-foreground"
                            )}
                          >
                            {event.event === "login" && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400" />}
                            {event.event === "logout" && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-red-500 dark:bg-red-400" />}
                            {isHandover && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-purple-500 dark:bg-purple-400" />}
                            {event.event === "acknowledge" && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400" />}
                            {isHandover ? "handover note" : event.event}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">{event.username}</TableCell>
                        <TableCell className="text-foreground/90 font-medium">Shift {event.shift_number}</TableCell>
                        <TableCell className="text-sm text-foreground/80 dark:text-muted-foreground">
                          {formatDateTime(event.timestamp)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground/80 dark:text-muted-foreground">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate max-w-md">
                              {event.detail || "—"}
                            </span>
                            {hasHandoverNote && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2.5 text-xs font-semibold text-purple-700 hover:text-purple-900 hover:bg-purple-100/80 border border-purple-200 dark:border-transparent dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-500/10 shrink-0"
                                onClick={() => setSelectedHandoverNote(event)}
                              >
                                <FileText className="mr-1 h-3.5 w-3.5" />
                                View Notes
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  Page {timelinePage} of {timelineTotalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={timelinePage <= 1}
                    onClick={() => setTimelinePage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={timelinePage >= timelineTotalPages}
                    onClick={() => setTimelinePage((p) => Math.min(timelineTotalPages, p + 1))}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Audit reports & exports */}
      <Card className="border-cyan-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-cyan-400" />
            Audit Reports & Exports
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Every report includes the DBA username and timestamp for audit. Generated by{" "}
            <span className="font-medium text-foreground">{exportedBy}</span> • Period {periodLabel}.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ExportTile
              icon={ClipboardCheck}
              title="PROD Database Availability Checklist"
              count={report.dbStatusChecks.length}
              onExport={(fmt) => handleExport("dbChecks", fmt)}
            />
            <ExportTile
              icon={ClipboardCheck}
              title="Backup Status Checklist"
              count={report.backupStatusChecks.length}
              onExport={(fmt) => handleExport("backupChecks", fmt)}
            />
            <ExportTile
              icon={UserCheck}
              title="Login / Logout Sessions"
              count={report.sessions.length}
              onExport={(fmt) => handleExport("sessions", fmt)}
            />
            <ExportTile
              icon={Clock}
              title="Late Logins"
              count={report.lateLogins.length}
              onExport={(fmt) => handleExport("lateLogins", fmt)}
            />
            <ExportTile
              icon={Clock}
              title="Total Worked Hours per User"
              count={report.userWorkHours.length}
              onExport={(fmt) => handleExport("workHours", fmt)}
            />
            <ExportTile
              icon={Activity}
              title="Activity Timeline"
              count={report.timelineTotal}
              onExport={(fmt) => handleExport("timeline", fmt)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Dialog for viewing a single timeline entry's Handover Notes */}
      <Dialog open={!!selectedHandoverNote} onOpenChange={(open) => !open && setSelectedHandoverNote(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              Handover Note Details
            </DialogTitle>
            <DialogDescription>
              Recorded for <span className="font-semibold text-foreground">{selectedHandoverNote?.username}</span> (Shift {selectedHandoverNote?.shift_number})
              {selectedHandoverNote?.timestamp && ` on ${formatDateTime(selectedHandoverNote.timestamp)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-slate-50 dark:bg-muted/20 p-3 text-xs">
              <div>
                <span className="text-muted-foreground">DBA User: </span>
                <span className="font-medium text-foreground">{selectedHandoverNote?.username}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Shift: </span>
                <span className="font-medium text-foreground">Shift {selectedHandoverNote?.shift_number}</span>
              </div>
              {activeHandoverNote?.shift_date && (
                <div>
                  <span className="text-muted-foreground">Shift Date: </span>
                  <span className="font-medium text-foreground">{activeHandoverNote.shift_date}</span>
                </div>
              )}
              {activeHandoverNote?.status && (
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant="outline" className={cn(
                    "font-medium shadow-xs",
                    activeHandoverNote.status === "ACKNOWLEDGED" ? "border-green-300 bg-green-100 text-green-800 dark:border-green-500/30 dark:text-green-400 dark:bg-green-500/10" : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:text-amber-400 dark:bg-amber-500/10"
                  )}>
                    {activeHandoverNote.status}
                    {activeHandoverNote.ack_username && ` by ${activeHandoverNote.ack_username}`}
                  </Badge>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border/80 bg-slate-50/50 dark:bg-muted/30 p-4 min-h-[120px]">
              <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Handover Note Content</p>
              <HandoverContent html={activeHandoverText || "No detailed handover note recorded."} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog for viewing all Handover Notes in report period */}
      <Dialog
        open={showAllHandoversModal}
        onOpenChange={(open) => {
          setShowAllHandoversModal(open);
          if (open) setAllHandoversPage(1);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <ArrowLeftRight className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              Shift Handover Notes ({report?.handovers.length || 0})
            </DialogTitle>
            <DialogDescription>
              All recorded shift handover notes for period <span className="font-medium text-foreground">{periodLabel}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {!report?.handovers || report.handovers.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm border border-dashed border-border/60 rounded-lg">
                No handover notes found for the selected filter period.
              </div>
            ) : (
              <>
                {pagedHandovers.map((h, i) => (
                  <div key={h.handover_id || i} className="rounded-lg border border-border/80 bg-card p-4 space-y-3 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30 font-medium">
                          Shift {h.shift_number}
                        </Badge>
                        <span className="font-semibold text-sm">{h.author_username}</span>
                        <span className="text-xs text-muted-foreground">• {h.shift_date}</span>
                      </div>
                      <Badge variant="outline" className={cn(
                        "font-medium shadow-xs",
                        h.status === "ACKNOWLEDGED" ? "border-green-300 bg-green-100 text-green-800 dark:border-green-500/30 dark:text-green-400 dark:bg-green-500/10" : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:text-amber-400 dark:bg-amber-500/10"
                      )}>
                        {h.status}
                        {h.ack_username && ` by ${h.ack_username}`}
                      </Badge>
                    </div>
                    <div className="bg-slate-50 dark:bg-muted/20 rounded-md p-3 border border-border/60">
                      <HandoverContent html={h.handover_text} />
                    </div>
                  </div>
                ))}

                {allHandoversTotalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
                    <div className="text-xs text-muted-foreground">
                      Page {allHandoversPage} of {allHandoversTotalPages} ({report.handovers.length} total handovers)
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={allHandoversPage <= 1}
                        onClick={() => setAllHandoversPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={allHandoversPage >= allHandoversTotalPages}
                        onClick={() => setAllHandoversPage((p) => Math.min(allHandoversTotalPages, p + 1))}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----- Sub-components -----

function CompletionCard({ title, data }: { title: string; data: { total: number; completed: number; completion_pct: number } }) {
  return (
    <Card className="transition-all duration-200 hover:border-border/90">
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <p className={cn(
            "text-2xl font-bold",
            data.completion_pct === 100 ? "text-green-300" : "text-cyan-300"
          )}>
            {data.completion_pct}%
          </p>
          <p className="text-xs text-muted-foreground">
            {data.completed} / {data.total} checks
          </p>
        </div>
        <Progress
          value={data.completion_pct}
          className={cn("mt-2 h-1.5", data.completion_pct === 100 && "dba-progress-cyan")}
        />
      </CardContent>
    </Card>
  );
}

function ExportMenu({ label, onExport }: { label: string; onExport: (fmt: "pdf" | "excel") => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="h-3.5 w-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export {label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onExport("excel")}>
          <FileSpreadsheet className="h-4 w-4 text-green-400" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("pdf")}>
          <FileText className="h-4 w-4 text-red-400" />
          PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExportTile({
  icon: Icon,
  title,
  count,
  onExport
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  onExport: (fmt: "pdf" | "excel") => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{count} record{count === 1 ? "" : "s"}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={count === 0}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onExport("excel")}>
            <FileSpreadsheet className="h-4 w-4 text-green-400" />
            Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport("pdf")}>
            <FileText className="h-4 w-4 text-red-400" />
            PDF (.pdf)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
