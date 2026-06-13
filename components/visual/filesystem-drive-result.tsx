"use client";

import { AlertTriangle, CheckCircle2, HardDrive, Server } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/visual/status-badge";
import { cn, formatNumber } from "@/lib/utils";
import type { DbaResponse, FilesystemUsageRow } from "@/types/dba";

const DEFAULT_THRESHOLD = 90;

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asStatus(pctUsed: number): FilesystemUsageRow["status"] {
  if (pctUsed >= 90) return "critical";
  if (pctUsed >= 80) return "warning";
  return "healthy";
}

function normalizeRow(row: unknown): FilesystemUsageRow | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const name =
    String(
      record.name ??
        record.mount_point ??
        record.mountPoint ??
        record.mount ??
        record.filesystem ??
        record.file_system ??
        record.drive ??
        record.path ??
        ""
    ).trim();

  if (!name) return null;

  const pctUsed = asNumber(record.pct_used ?? record.pctUsed ?? record.used_pct ?? record.usedPct ?? record.utilization_pct ?? record.utilizationPct);
  const usedGb = asNumber(record.used_gb ?? record.usedGb ?? record.used);
  const freeGb = asNumber(record.free_gb ?? record.freeGb ?? record.free);
  const sizeGb = record.size_gb ?? record.sizeGb ?? record.size;
  const drive = record.drive ? String(record.drive) : undefined;
  const mountPoint = record.mount_point ?? record.mountPoint ?? record.mount;
  const filesystem = record.filesystem ?? record.file_system;

  return {
    name,
    drive,
    mount_point: mountPoint ? String(mountPoint) : undefined,
    filesystem: filesystem ? String(filesystem) : undefined,
    type: drive || /^[A-Z]:\\?$/i.test(name) ? "drive" : "filesystem",
    size_gb: sizeGb == null || sizeGb === "" ? undefined : asNumber(sizeGb),
    used_gb: usedGb,
    free_gb: freeGb,
    pct_used: pctUsed,
    pct_free: record.pct_free == null && record.freePct == null ? undefined : asNumber(record.pct_free ?? record.freePct),
    status: record.status === "critical" || record.status === "warning" || record.status === "healthy" || record.status === "unknown" ? record.status : asStatus(pctUsed)
  };
}

export function getFilesystemRows(response: DbaResponse): FilesystemUsageRow[] {
  const candidates = [
    response.raw_data.disk_utilization,
    response.raw_data.filesystems,
    response.raw_data.drives,
    response.raw_data.filesystem_usage,
    response.raw_data.drive_usage
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeRow).filter((row): row is FilesystemUsageRow => Boolean(row));
    }
  }

  return [];
}

export function FilesystemDriveResult({ response, threshold = DEFAULT_THRESHOLD }: { response: DbaResponse; threshold?: number }) {
  const rows = getFilesystemRows(response).sort((a, b) => b.pct_used - a.pct_used);
  const criticalRows = rows.filter((row) => row.pct_used >= threshold);
  const isDrive = rows.some((row) => row.type === "drive" || row.drive);
  const noun = isDrive ? "drive" : "filesystem";
  const Icon = isDrive ? HardDrive : Server;

  if (!rows.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border/60 text-sm text-muted-foreground">
        n8n did not return filesystem or drive rows in the response.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {criticalRows.length ? (
        <div className="rounded-md border border-red-400/30 bg-red-500/10 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {criticalRows.length} {noun}
            {criticalRows.length === 1 ? "" : "s"} at or above {threshold}% utilization
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {criticalRows.map((row) => (
              <div key={row.name} className="rounded-md border border-red-300/20 bg-background/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono font-semibold text-red-50">{row.name}</span>
                  <StatusBadge status="critical">{formatNumber(row.pct_used, 1)}%</StatusBadge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(row.used_gb, 1)} GB used / {formatNumber(row.free_gb, 1)} GB free
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All {noun}s are below {threshold}% utilization.
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-secondary/40">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{isDrive ? "Drive" : "Filesystem"}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{isDrive ? "Volume" : "Mount"}</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Size GB</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Used GB</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Free GB</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Utilization</th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.name}-${index}`}
                className={cn(
                  "border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/20",
                  row.pct_used >= threshold && "bg-red-500/5"
                )}
              >
                <td className="px-4 py-3 font-mono font-medium">
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                    {row.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.mount_point || row.filesystem || row.drive || "-"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{typeof row.size_gb === "number" ? formatNumber(row.size_gb, 1) : "-"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.used_gb, 1)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.free_gb, 1)}</td>
                <td className="min-w-48 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Progress value={row.pct_used} className="h-1.5 flex-1" />
                    <span className="w-14 text-right tabular-nums text-xs text-muted-foreground">{formatNumber(row.pct_used, 1)}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    <StatusBadge status={row.status} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
