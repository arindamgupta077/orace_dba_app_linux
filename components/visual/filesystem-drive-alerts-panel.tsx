"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, ChevronLeft, ChevronRight, HardDrive, Loader2, RefreshCcw, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/visual/status-badge";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { fetchAlertNotifications, updateAlertNotificationStatus } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { AlertNotification, AlertNotificationStatus } from "@/types/dba";

const ALERT_TYPE = "filesystem_drive";
const PAGE_SIZE = 6;
type StatusFilter = AlertNotificationStatus | "all";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending_approval", label: "Active alerts" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "failed", label: "Failed" },
  { value: "all", label: "All statuses" }
];

function getAlertTarget(alert: AlertNotification) {
  const metadata = alert.metadata || {};
  const fromMetadata =
    metadata.mount_point ||
    metadata.mountPoint ||
    metadata.mount ||
    metadata.drive ||
    metadata.filesystem ||
    metadata.file_system ||
    metadata.path;
  return String(alert.object_name || alert.datafile || fromMetadata || "Filesystem/Drive");
}

function isDriveAlert(alert: AlertNotification) {
  const metadata = alert.metadata || {};
  const target = getAlertTarget(alert);
  return String(metadata.os || "").toLowerCase() === "windows" || /^[A-Z]:\\?$/i.test(target) || Boolean(metadata.drive);
}

function getFreePct(alert: AlertNotification) {
  const raw = alert.metadata?.free_pct ?? alert.metadata?.freePct;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof alert.utilization_pct === "number") return Math.max(0, 100 - alert.utilization_pct);
  return undefined;
}

function statusTone(status: AlertNotificationStatus) {
  if (status === "acknowledged" || status === "completed") return "healthy";
  if (status === "failed" || status === "rejected") return "critical";
  return status;
}



export function FilesystemDriveAlertsPanel() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const user = useAppStore((state) => state.user);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending_approval");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const result = await fetchAlertNotifications({
        db: selectedDb,
        type: ALERT_TYPE,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: PAGE_SIZE,
        page
      });
      setAlerts(result.items);
      setTotal(result.total);

      const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page > maxPage) {
        setPage(maxPage);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load filesystem/drive alerts.");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [page, selectedDb, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [selectedDb, statusFilter]);

  useEffect(() => {
    void loadAlerts();
    const intervalId = window.setInterval(() => {
      void loadAlerts({ silent: true });
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [loadAlerts]);

  useEffect(() => {
    const query = new URLSearchParams({
      db: selectedDb,
      alert_type: ALERT_TYPE
    });
    const events = new EventSource(`/api/alerts/stream?${query.toString()}`);
    events.addEventListener("alert", () => {
      void loadAlerts({ silent: true });
    });
    return () => events.close();
  }, [loadAlerts, selectedDb]);

  const acknowledge = async (alert: AlertNotification) => {
    setUpdatingId(alert.id);
    try {
      await updateAlertNotificationStatus(alert.id, "acknowledged", "Filesystem/Drive alert acknowledged.", user?.username);
      toast.success("Alert acknowledged", {
        description: `${getAlertTarget(alert)} / ${user?.username || "current user"}`
      });
      await loadAlerts({ silent: true });
    } catch (ackError) {
      toast.error("Acknowledgement failed", {
        description: ackError instanceof Error ? ackError.message : "Could not acknowledge alert."
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstItem = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(page * PAGE_SIZE, total);
  const canGoPrevious = page > 1;
  const canGoNext = page < pageCount;

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-amber-300" />
            Filesystem/Drive Alert
            {statusFilter === "pending_approval" && total ? <StatusBadge status="pending_approval">{total} Active</StatusBadge> : null}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => loadAlerts()} disabled={loading}>
              <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Showing {firstItem}-{lastItem} of {total} notifications
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={!canGoPrevious || loading}>
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="min-w-20 text-center">
              Page {page} / {pageCount}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={!canGoNext || loading}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <div className="mb-3 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}
        {!alerts.length && !loading ? (
          <div className="rounded-md border border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
            No filesystem/drive alerts for {selectedDb}.
          </div>
        ) : null}
        <div className="grid gap-3 xl:grid-cols-2">
          {alerts.map((alert) => {
            const target = getAlertTarget(alert);
            const DriveIcon = isDriveAlert(alert) ? HardDrive : Server;
            const freePct = getFreePct(alert);
            const isUpdating = updatingId === alert.id;

            return (
              <div key={alert.id} className="rounded-md border border-border/70 bg-secondary/30 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <DriveIcon className="h-4 w-4 text-cyan-200" />
                      <p className="font-mono text-sm font-semibold text-cyan-100">{target}</p>
                      <StatusBadge status={alert.severity}>{alert.severity}</StatusBadge>
                      <StatusBadge status={statusTone(alert.status)}>{alert.status.replace(/_/g, " ")}</StatusBadge>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>
                        {alert.db} / {formatDateTime(alert.created_at)}
                      </span>
                      <span>Raised by {alert.created_by}</span>
                      {alert.approved_by ? (
                        <span>
                          Acknowledged by {alert.approved_by}
                        </span>
                      ) : null}
                      {alert.approved_at ? <span>Acknowledged at {formatDateTime(alert.approved_at)}</span> : null}
                    </div>
                  </div>
                  {alert.status === "pending_approval" ? (
                    <Button variant="outline" size="sm" onClick={() => acknowledge(alert)} disabled={isUpdating}>
                      {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Acknowledge
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" disabled>
                      <CheckCircle2 className="h-4 w-4" />
                      {alert.status === "acknowledged"
                        ? "Acknowledged"
                        : alert.status.replace(/_/g, " ")}
                    </Button>
                  )}
                </div>
                <p className="mt-3 text-sm text-slate-200">{alert.message}</p>
                {typeof alert.utilization_pct === "number" ? (
                  <div className="mt-4">
                    <Progress value={alert.utilization_pct} />
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <span>{formatNumber(alert.utilization_pct, 1)}% used</span>
                      {typeof freePct === "number" ? <span>{formatNumber(freePct, 1)}% free</span> : null}
                      {typeof alert.used_gb === "number" ? <span>{formatNumber(alert.used_gb, 1)} GB used</span> : null}
                      {typeof alert.free_gb === "number" ? <span>{formatNumber(alert.free_gb, 1)} GB free</span> : null}
                      {typeof alert.threshold_pct === "number" ? <span>Threshold {formatNumber(alert.threshold_pct, 0)}%</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
