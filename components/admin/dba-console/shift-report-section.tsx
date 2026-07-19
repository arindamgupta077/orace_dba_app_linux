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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAppUsers, fetchShiftReport } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn, formatDateTime, formatTime, toIstDateString, toIstDateStringOffset } from "@/lib/utils";
import { exportDataset, ExportColumn, ExportMeta } from "@/lib/export";
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

export function ShiftReportSection() {
  const user = useAppStore((s) => s.user);
  const exportedBy = user?.username || "app_admin";

  const [report, setReport] = useState<ShiftReportData | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(todayStr());
  const [dbaUserId, setDbaUserId] = useState<string>("all");
  const [shiftNumber, setShiftNumber] = useState<string>("all");

  // Activity timeline — client-driven pagination + filters (server-side)
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineEvent, setTimelineEvent] = useState<string>("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineSearchInput, setTimelineSearchInput] = useState("");

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchAppUsers()
      .then((res) => setUsers(res.users || []))
      .catch(() => {});
  }, []);

  const dbaUsers = useMemo(() => users.filter((u) => u.role === "dba_admin" || u.role === "app_admin"), [users]);

  const periodLabel = `${fromDate} → ${toDate}`;
  const filterLabel = `DBA: ${dbaUserId === "all" ? "All" : dbaUsers.find((u) => String(u.userId) === dbaUserId)?.username || dbaUserId} • Shift: ${shiftNumber === "all" ? "All" : shiftLabel(Number(shiftNumber))}`;

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

  // ---------- Export definitions ----------
  const baseMeta = (title: string): ExportMeta => ({
    title,
    exportedBy,
    periodLabel,
    filterLabel
  });

  const handleExport = (
    kind: "logins" | "attendance" | "timeline" | "dbChecks" | "backupChecks" | "handovers" | "sessions" | "lateLogins" | "coverage",
    format: "pdf" | "excel"
  ) => {
    if (!report) return;
    switch (kind) {
      case "logins": {
        const cols: ExportColumn<ShiftReportData["loginTrend"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "Logins", value: (r) => r.logins },
          { header: "Login Hours", value: (r) => r.hours }
        ];
        exportDataset(format, cols, report.loginTrend, baseMeta("Shift Login Trend"));
        break;
      }
      case "attendance": {
        const cols: ExportColumn<ShiftReportData["dailyAttendance"][number]>[] = [
          { header: "Date", value: (r) => r.attendance_date },
          { header: "Unique DBAs", value: (r) => r.unique_dbas },
          { header: "Total Logins", value: (r) => r.total_logins }
        ];
        exportDataset(format, cols, report.dailyAttendance, baseMeta("Daily Attendance"));
        break;
      }
      case "timeline": {
        const cols: ExportColumn<ShiftReportTimelineEntry>[] = [
          { header: "Event", value: (r) => r.event },
          { header: "DBA (Username)", value: (r) => r.username },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "Timestamp", value: (r) => r.timestamp },
          { header: "Detail", value: (r) => r.detail || "" }
        ];
        exportDataset(format, cols, report.activityTimeline, baseMeta("Activity Timeline"));
        break;
      }
      case "dbChecks": {
        const cols: ExportColumn<ShiftReportData["dbStatusChecks"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "Database", value: (r) => r.database_name },
          { header: "Status", value: (r) => r.status },
          { header: "DBA (Username)", value: (r) => r.checked_username },
          { header: "Checked At", value: (r) => r.checked_at },
          { header: "Comment", value: (r) => r.comment_text || "" },
          { header: "Realtime Check", value: (r) => r.is_realtime_check ? "Yes" : "No" }
        ];
        exportDataset(format, cols, report.dbStatusChecks, baseMeta("PROD Database Availability Checklist"));
        break;
      }
      case "backupChecks": {
        const cols: ExportColumn<ShiftReportData["backupStatusChecks"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "Database", value: (r) => r.database_name },
          { header: "Backup", value: (r) => r.backup_name },
          { header: "Status", value: (r) => r.status },
          { header: "DBA (Username)", value: (r) => r.checked_username },
          { header: "Checked At", value: (r) => r.checked_at },
          { header: "Comment", value: (r) => r.comment_text || "" }
        ];
        exportDataset(format, cols, report.backupStatusChecks, baseMeta("Backup Status Checklist"));
        break;
      }
      case "handovers": {
        const cols: ExportColumn<ShiftReportData["handovers"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "Author (Username)", value: (r) => r.author_username },
          { header: "Created At", value: (r) => r.created_at },
          { header: "Status", value: (r) => r.status },
          { header: "Acknowledged By", value: (r) => r.ack_username || "" },
          { header: "Acknowledged At", value: (r) => r.ack_at || "" },
          { header: "Handover Text", value: (r) => (r.handover_text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() }
        ];
        exportDataset(format, cols, report.handovers, baseMeta("Handover (HO) Report"));
        break;
      }
      case "sessions": {
        const cols: ExportColumn<ShiftReportSessionRow>[] = [
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "DBA (Username)", value: (r) => r.username },
          { header: "Login At", value: (r) => r.login_at },
          { header: "Logout At", value: (r) => r.logout_at || "" },
          { header: "Status", value: (r) => r.status },
          { header: "Active", value: (r) => (r.is_active ? "Yes" : "No") },
          { header: "Duration (min)", value: (r) => r.duration_min ?? "" }
        ];
        exportDataset(format, cols, report.sessions, baseMeta("Login/Logout Sessions"));
        break;
      }
      case "lateLogins": {
        const cols: ExportColumn<ShiftReportData["lateLogins"][number]>[] = [
          { header: "DBA (Username)", value: (r) => r.username },
          { header: "Shift", value: (r) => shiftLabel(r.shift_number) },
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Login At", value: (r) => r.login_at },
          { header: "Minutes Late", value: (r) => r.minutes_late }
        ];
        exportDataset(format, cols, report.lateLogins, baseMeta("Late Logins"));
        break;
      }
      case "coverage": {
        const cols: ExportColumn<ShiftReportData["coverage"][number]>[] = [
          { header: "Shift Date", value: (r) => r.shift_date },
          { header: "Covered (min)", value: (r) => r.covered_minutes },
          { header: "Gap (min)", value: (r) => r.gap_minutes },
          { header: "Coverage %", value: (r) => r.coverage_pct },
          { header: "Uncovered Shifts", value: (r) => r.uncovered_shifts.length > 0 ? r.uncovered_shifts.map((sn) => `Shift ${sn}`).join(", ") : "—" }
        ];
        exportDataset(format, cols, report.coverage, baseMeta("Shift Coverage"));
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
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-44 rounded-md" />
              <Skeleton className="h-10 w-32 rounded-md" />
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
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
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
          </div>
        </CardContent>
      </Card>

      {/* Executive summary */}
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

      {/* Operational health — completion progress */}
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Operational Health</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CompletionCard
          title="PROD Database Availability Completion"
          data={report.dbStatusCompletion}
        />
        <CompletionCard
          title="Backup Completion"
          data={report.backupCompletion}
        />
        <CompletionCard
          title="Overall Checklist Completion"
          data={report.checklistCompletion}
        />
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
              icon={ArrowLeftRight}
              title="Handover (HO) Report"
              count={report.handovers.length}
              onExport={(fmt) => handleExport("handovers", fmt)}
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
              icon={Activity}
              title="Activity Timeline"
              count={report.timelineTotal}
              onExport={(fmt) => handleExport("timeline", fmt)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Activity timeline with pagination + filters */}
      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0">
          <div className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-cyan-400" />
              Activity Timeline
            </CardTitle>
            <ExportMenu label="Timeline" onExport={(fmt) => handleExport("timeline", fmt)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={timelineEvent}
              onValueChange={(v) => {
                setTimelineEvent(v);
                setTimelinePage(1);
              }}
            >
              <SelectTrigger className="h-9 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="login">Logins</SelectItem>
                <SelectItem value="logout">Logouts</SelectItem>
                <SelectItem value="acknowledge">Acknowledgements</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={timelineSearchInput}
              onChange={(e) => setTimelineSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyTimelineSearch();
              }}
              placeholder="Search DBA username..."
              className="h-9 w-48"
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
                  {report.activityTimeline.map((event, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge
                          className={cn(
                            event.event === "login" && "border-green-500/30 bg-green-500/10 text-green-300",
                            event.event === "logout" && "border-red-500/30 bg-red-500/10 text-red-300",
                            event.event === "acknowledge" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
                            (event.event !== "login" && event.event !== "logout" && event.event !== "acknowledge") && "border-muted-foreground/30 bg-muted/20 text-muted-foreground"
                          )}
                        >
                          {event.event === "login" && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-400" />}
                          {event.event === "logout" && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-red-400" />}
                          {event.event === "acknowledge" && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-cyan-400" />}
                          {event.event}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{event.username}</TableCell>
                      <TableCell>Shift {event.shift_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(event.timestamp)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{event.detail || "—"}</TableCell>
                    </TableRow>
                  ))}
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
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
