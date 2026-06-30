"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calendar,
  Clock,
  Download,
  Loader2,
  RefreshCw,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAppUsers, fetchShiftReport } from "@/services/api";
import { cn } from "@/lib/utils";
import type { AppUser, ShiftReportData, ShiftReportFilters } from "@/types/dba";

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    toast.error("No data to export.");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val == null) return "";
          const str = String(val).replace(/"/g, '""');
          return /[",\n]/.test(str) ? `"${str}"` : str;
        })
        .join(",")
    )
  ];
  const csv = csvLines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {sublabel && <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>}
          </div>
          <div className={cn("rounded-lg border p-2", colors[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ShiftReportSection() {
  const [report, setReport] = useState<ShiftReportData | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(todayStr());
  const [dbaUserId, setDbaUserId] = useState<string>("all");
  const [shiftNumber, setShiftNumber] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: ShiftReportFilters = {
        fromDate,
        toDate,
        dbaUserId: dbaUserId !== "all" ? Number(dbaUserId) : undefined,
        shiftNumber: shiftNumber !== "all" ? Number(shiftNumber) : undefined
      };
      const result = await fetchShiftReport(filters);
      setReport(result.report);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shift report.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, dbaUserId, shiftNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchAppUsers()
      .then((res) => setUsers(res.users || []))
      .catch(() => {});
  }, []);

  const dbaUsers = useMemo(() => users.filter((u) => u.role === "dba_admin" || u.role === "app_admin"), [users]);

  const loginTrendData = useMemo(() => {
    if (!report) return [];
    return report.loginTrend
      .slice()
      .reverse()
      .map((t) => ({
        date: t.shift_date.slice(5),
        Shift1: t.shift_number === 1 ? t.logins : 0,
        Shift2: t.shift_number === 2 ? t.logins : 0,
        Shift3: t.shift_number === 3 ? t.logins : 0
      }))
      .reduce((acc, curr) => {
        const existing = acc.find((a) => a.date === curr.date);
        if (existing) {
          existing.Shift1 += curr.Shift1;
          existing.Shift2 += curr.Shift2;
          existing.Shift3 += curr.Shift3;
        } else {
          acc.push(curr);
        }
        return acc;
      }, [] as Array<{ date: string; Shift1: number; Shift2: number; Shift3: number }>);
  }, [report]);

  const handleExportLogins = () => {
    if (!report) return;
    const rows = report.loginTrend.map((t) => ({
      shift_date: t.shift_date,
      shift_number: t.shift_number,
      logins: t.logins
    }));
    downloadCsv(`shift-logins-${fromDate}_to_${toDate}.csv`, rows);
  };

  const handleExportAttendance = () => {
    if (!report) return;
    const rows = report.dailyAttendance.map((a) => ({
      date: a.attendance_date,
      unique_dbas: a.unique_dbas,
      total_logins: a.total_logins
    }));
    downloadCsv(`daily-attendance-${fromDate}_to_${toDate}.csv`, rows);
  };

  const handleExportTimeline = () => {
    if (!report) return;
    const rows = report.activityTimeline.map((e) => ({
      event: e.event,
      username: e.username,
      shift: e.shift_number,
      timestamp: e.timestamp,
      detail: e.detail || ""
    }));
    downloadCsv(`activity-timeline-${fromDate}_to_${toDate}.csv`, rows);
  };

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

  return (
    <div className="space-y-6">
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
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shifts</SelectItem>
                  <SelectItem value="1">Shift 1</SelectItem>
                  <SelectItem value="2">Shift 2</SelectItem>
                  <SelectItem value="3">Shift 3</SelectItem>
                  <SelectItem value="4">General Shift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Apply
            </Button>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" onClick={handleExportLogins}>
                <Download className="h-3.5 w-3.5" />
                Logins
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportAttendance}>
                <Download className="h-3.5 w-3.5" />
                Attendance
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportTimeline}>
                <Download className="h-3.5 w-3.5" />
                Timeline
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          icon={Users}
          label="Active DBAs Now"
          value={report.activeDbas.length}
          accent="green"
        />
        <MetricCard
          icon={Clock}
          label="Avg Login Duration"
          value={`${report.avgLoginDurationMin}m`}
          accent="cyan"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Late Logins"
          value={report.lateLogins.length}
          accent="amber"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Pending Handovers"
          value={report.pendingHandovers.length}
          accent="red"
          sublabel={report.unacknowledgedHandovers.length > 0 ? `${report.unacknowledgedHandovers.length} unacknowledged` : undefined}
        />
      </div>

      {/* Completion cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Database Status Completion</p>
            <p className="mt-1 text-2xl font-bold text-cyan-300">{report.dbStatusCompletion.completion_pct}%</p>
            <p className="text-xs text-muted-foreground">
              {report.dbStatusCompletion.completed} / {report.dbStatusCompletion.total} checks
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Backup Completion</p>
            <p className="mt-1 text-2xl font-bold text-cyan-300">{report.backupCompletion.completion_pct}%</p>
            <p className="text-xs text-muted-foreground">
              {report.backupCompletion.completed} / {report.backupCompletion.total} checks
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Overall Checklist Completion</p>
            <p className="mt-1 text-2xl font-bold text-cyan-300">{report.checklistCompletion.completion_pct}%</p>
            <p className="text-xs text-muted-foreground">
              {report.checklistCompletion.completed} / {report.checklistCompletion.total} checks
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Most active DBA */}
      {report.mostActiveDba && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Most Active DBA</p>
                <p className="text-lg font-bold">{report.mostActiveDba.username}</p>
                <p className="text-xs text-muted-foreground">{report.mostActiveDba.total_logins} total logins</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Login trend chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
            Login Trend by Shift
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loginTrendData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No login data for the selected period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={loginTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,163,184,0.15)" />
                <XAxis dataKey="date" tick={{ fill: "#8ea3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8ea3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#101722",
                    border: "1px solid rgba(142,163,184,0.25)",
                    borderRadius: 10,
                    fontSize: 12
                  }}
                />
                <Legend />
                <Bar dataKey="Shift1" stackId="a" fill="#18c37e" name="Shift 1" />
                <Bar dataKey="Shift2" stackId="a" fill="#ffb020" name="Shift 2" />
                <Bar dataKey="Shift3" stackId="a" fill="#3b82f6" name="Shift 3" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Daily + Monthly attendance */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-cyan-400" />
              Daily Attendance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.dailyAttendance.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No data.</p>
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              Monthly Attendance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.monthlyAttendance.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No data.</p>
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
      </div>

      {/* Activity timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-cyan-400" />
            Activity Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.activityTimeline.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded.</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
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
                            event.event === "acknowledge" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                          )}
                        >
                          {event.event}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{event.username}</TableCell>
                      <TableCell>Shift {event.shift_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{event.detail || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Late logins */}
      {report.lateLogins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Late Logins (&gt;10 min after shift start)
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      {new Date(l.login_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                        +{l.minutes_late}m
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
