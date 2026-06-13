"use client";

import { useMemo, useState } from "react";
import { ArchiveRestore, Download, FileWarning, PackageCheck, RefreshCcw, ShieldAlert, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/visual/status-badge";
import { downloadText, formatDateTime, toCsv } from "@/lib/utils";
import type { AlertLogRow, BackupRow, DbaActionDefinition, DbaResponse, InvalidObjectRow } from "@/types/dba";

interface StructuredDataViewsProps {
  response: DbaResponse;
  onRunAction: (definition: DbaActionDefinition, params?: Record<string, unknown>) => void;
  getDefinition: (action: DbaActionDefinition["action"]) => DbaActionDefinition | undefined;
}

export function StructuredDataViews({ response, onRunAction, getDefinition }: StructuredDataViewsProps) {
  const backups = response.raw_data.backups || [];
  const alerts = response.raw_data.alerts || [];
  const invalidObjects = response.raw_data.invalid_objects || [];
  const privileges = response.raw_data.privileges || [];
  const trend = response.raw_data.trend || [];

  return (
    <div className="space-y-5">
      {trend.length ? <AwrTrendPanel data={trend as Array<Record<string, string | number>>} /> : null}
      {backups.length ? <BackupHistory rows={backups} /> : null}
      {alerts.length ? <AlertLogPanel rows={alerts} rawOutput={response.raw_output} /> : null}
      {privileges.length ? <PrivilegeAudit rows={privileges as Array<Record<string, string | number>>} /> : null}
      {invalidObjects.length ? (
        <InvalidObjectsPanel
          rows={invalidObjects}
          onRecompile={(row) => {
            const definition = getDefinition("stats_refresh");
            if (definition) onRunAction(definition, { schema: row.owner, object_name: row.object_name, object_type: row.object_type, operation: "recompile" });
          }}
        />
      ) : null}
    </div>
  );
}

function AwrTrendPanel({ data }: { data: Array<Record<string, string | number>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-300" />
          AWR Wait Trend
        </CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -12, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,163,184,0.18)" />
            <XAxis dataKey="label" stroke="#8ea3b8" fontSize={12} />
            <YAxis stroke="#8ea3b8" fontSize={12} />
            <Tooltip contentStyle={{ background: "#101722", border: "1px solid rgba(142,163,184,.25)", borderRadius: 8 }} />
            <Line type="monotone" dataKey="cpu" stroke="#ff312e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="waits" stroke="#ffb020" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sessions" stroke="#23d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function BackupHistory({ rows }: { rows: BackupRow[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ArchiveRestore className="h-5 w-5 text-cyan-300" />
          Backup History
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => downloadText("rman-backups.csv", toCsv(rows), "text/csv")}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ left: -12, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,163,184,0.18)" />
              <XAxis dataKey="type" stroke="#8ea3b8" fontSize={12} />
              <YAxis stroke="#8ea3b8" fontSize={12} />
              <Tooltip contentStyle={{ background: "#101722", border: "1px solid rgba(142,163,184,.25)", borderRadius: 8 }} />
              <Bar dataKey="size_gb" fill="#23d3ee" radius={[4, 4, 0, 0]} />
              <Bar dataKey="duration_min" fill="#ffb020" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-md border border-border/70 bg-secondary/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{row.id}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(row.started_at)}</p>
                </div>
                <StatusBadge status={row.status === "SUCCESS" ? "healthy" : row.status === "RUNNING" ? "warning" : "critical"}>{row.status}</StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {row.type} / {row.duration_min} min / {row.compression_ratio}x compression
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AlertLogPanel({ rows, rawOutput }: { rows: AlertLogRow[]; rawOutput: string }) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("ALL");
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const severityMatch = severity === "ALL" || row.severity === severity;
      const textMatch = row.message.toLowerCase().includes(query.toLowerCase());
      return severityMatch && textMatch;
    });
  }, [query, rows, severity]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileWarning className="h-5 w-5 text-amber-300" />
          Alert Log Stream
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => downloadText("alert-log-output.log", rawOutput)}>
          <Download className="h-4 w-4" />
          Logs
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alert log" />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["ALL", "INFO", "WARNING", "ERROR", "CRITICAL"].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-3">
          {filtered.map((row) => (
            <div key={`${row.timestamp}-${row.message}`} className="rounded-md border border-border/70 bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <StatusBadge status={row.severity === "CRITICAL" || row.severity === "ERROR" ? "critical" : row.severity === "WARNING" ? "warning" : "healthy"}>{row.severity}</StatusBadge>
                <span className="text-xs text-muted-foreground">{formatDateTime(row.timestamp)}</span>
              </div>
              <p className={row.message.includes("ORA-") ? "text-sm text-red-200" : "text-sm text-slate-200"}>{row.message}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PrivilegeAudit({ rows }: { rows: Array<Record<string, string | number>> }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-300" />
          Dangerous Privileges
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => downloadText("privilege-audit.csv", toCsv(rows), "text/csv")}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grantee</TableHead>
              <TableHead>Privilege</TableHead>
              <TableHead>Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.grantee}-${row.privilege}`}>
                <TableCell>{row.grantee}</TableCell>
                <TableCell className="font-mono">{row.privilege}</TableCell>
                <TableCell>
                  <StatusBadge status={row.risk === "critical" ? "critical" : "warning"}>{String(row.risk)}</StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function InvalidObjectsPanel({ rows, onRecompile }: { rows: InvalidObjectRow[]; onRecompile: (row: InvalidObjectRow) => void }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="h-5 w-5 text-cyan-300" />
          Invalid Objects
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => downloadText("invalid-objects.csv", toCsv(rows), "text/csv")}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Owner</TableHead>
              <TableHead>Object</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last DDL</TableHead>
              <TableHead className="text-right">Recompile</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.owner}-${row.object_name}`}>
                <TableCell>{row.owner}</TableCell>
                <TableCell className="font-mono text-cyan-100">{row.object_name}</TableCell>
                <TableCell>{row.object_type}</TableCell>
                <TableCell>
                  <StatusBadge status="critical">{row.status}</StatusBadge>
                </TableCell>
                <TableCell>{formatDateTime(row.last_ddl_time || row.last_modified || "")}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => onRecompile(row)} title="Recompile object">
                    <RefreshCcw className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
