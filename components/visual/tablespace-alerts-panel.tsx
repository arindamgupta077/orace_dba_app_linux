"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, ChevronLeft, ChevronRight, Code2, Loader2, RefreshCcw, SquareTerminal, UserCheck, UserX, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/visual/status-badge";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { decideAlertSqlApproval, fetchAlertNotifications, fetchPendingSqlApprovals, updateAlertNotificationStatus } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { AlertNotification, AlertNotificationStatus, AlertSqlApproval, AlertSqlApprovalDecision, AlertSqlExecutionResult } from "@/types/dba";

const PAGE_SIZE = 6;
const ACTIVE_ALERT_FETCH_LIMIT = 200;
type StatusFilter = AlertNotificationStatus | "all";
const DEFAULT_STATUS_FILTER: StatusFilter = "pending_approval";

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending_approval", label: "Active approvals" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "all", label: "All statuses" }
];

function statusTone(status: AlertNotificationStatus) {
  if (status === "completed" || status === "approved") return "healthy";
  if (status === "rejected" || status === "failed") return "critical";
  return status;
}

function formatStatusLabel(status: StatusFilter) {
  return STATUS_FILTER_OPTIONS.find((option) => option.value === status)?.label || status.replace(/_/g, " ");
}

function getDecisionMeta(alert: AlertNotification) {
  if (!alert.approved_by) return null;

  if (alert.status === "rejected") {
    return {
      icon: UserX,
      label: "Rejected DBA",
      value: alert.approved_by
    };
  }

  if (alert.status === "approved" || alert.status === "completed") {
    return {
      icon: UserCheck,
      label: "Approved DBA",
      value: alert.approved_by
    };
  }

  if (alert.status === "acknowledged") {
    return {
      icon: UserCheck,
      label: "Acknowledged DBA",
      value: alert.approved_by
    };
  }

  return null;
}

function getSqlApproval(alert: AlertNotification): AlertSqlApproval | null {
  const raw = alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const status = String(record.status || "");
  const sqlCommand = typeof record.sql_command === "string" ? record.sql_command : "";
  if (!sqlCommand || (status !== "pending" && status !== "approved" && status !== "rejected")) return null;

  return record as unknown as AlertSqlApproval;
}

function getSqlExecutionResult(alert: AlertNotification): AlertSqlExecutionResult | null {
  const raw = alert.metadata?.sql_execution ?? alert.metadata?.sqlExecution;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const status = String(record.status || "");
    if (status === "completed" || status === "failed") {
      return {
        ...(record as unknown as AlertSqlExecutionResult),
        status,
        message: typeof record.message === "string" && record.message.trim() ? record.message : alert.message,
        executed_at: typeof record.executed_at === "string" ? record.executed_at : alert.completed_at || alert.updated_at
      };
    }
  }

  const sqlApproval = getSqlApproval(alert);
  if (!sqlApproval || (alert.status !== "completed" && alert.status !== "failed")) return null;

  return {
    status: alert.status,
    message: alert.message,
    sql_command: sqlApproval.sql_command,
    executed_at: alert.completed_at || alert.updated_at
  };
}

function getSqlReviewKey(alert: AlertNotification) {
  const sqlApproval = getSqlApproval(alert);
  if (!sqlApproval || sqlApproval.status !== "pending") return "";
  return `${alert.id}:${sqlApproval.updated_at || sqlApproval.created_at || sqlApproval.sql_command}`;
}

function getSqlExecutionKey(alert: AlertNotification) {
  const result = getSqlExecutionResult(alert);
  if (!result) return "";
  return `${alert.id}:${result.executed_at}:${result.status}`;
}

function isExecutionFinalStatus(status: AlertNotificationStatus) {
  return status === "completed" || status === "failed" || status === "rejected";
}

function isSqlReviewable(alert: AlertNotification) {
  return !isExecutionFinalStatus(alert.status) && getSqlApproval(alert)?.status === "pending";
}

function isActiveApprovalAlert(alert: AlertNotification) {
  if (alert.status === "pending_approval") return true;
  return alert.status === "approved" && !getSqlExecutionResult(alert);
}

function sortAlertsByCreatedAt(alerts: AlertNotification[]) {
  return [...alerts].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function getWorkflowState(alert: AlertNotification) {
  if (alert.status !== "approved") return null;

  const sqlApproval = getSqlApproval(alert);
  const sqlExecution = getSqlExecutionResult(alert);
  if (sqlExecution) return null;

  if (!sqlApproval) {
    return {
      badge: "Generating SQL",
      title: "Generating SQL",
      description: "First approval received. Waiting for n8n to return the generated SQL for DBA review.",
      actionLabel: "Generating SQL"
    };
  }

  if (sqlApproval.status === "pending") {
    return {
      badge: "SQL review",
      title: "SQL ready for DBA approval",
      description: "Generated SQL is attached. Review the final command before n8n executes anything.",
      actionLabel: "SQL review pending"
    };
  }

  if (sqlApproval.status === "approved") {
    return {
      badge: "Executing SQL",
      title: "Executing approved SQL",
      description: "Final SQL approval sent. Waiting for n8n to post the execution result.",
      actionLabel: "Executing SQL"
    };
  }

  return null;
}

function formatExecutionValue(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function TablespaceAlertsPanel() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const user = useAppStore((state) => state.user);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS_FILTER);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlReviewAlert, setSqlReviewAlert] = useState<AlertNotification | null>(null);
  const [sqlDraft, setSqlDraft] = useState("");
  const [sqlDialogOpen, setSqlDialogOpen] = useState(false);
  const [dismissedSqlReviewKey, setDismissedSqlReviewKey] = useState<string | null>(null);
  const [sqlDecisionLoading, setSqlDecisionLoading] = useState<AlertSqlApprovalDecision | null>(null);
  const [sqlExecutionAlert, setSqlExecutionAlert] = useState<AlertNotification | null>(null);
  const [sqlExecutionDialogOpen, setSqlExecutionDialogOpen] = useState(false);
  const [dismissedSqlExecutionKey, setDismissedSqlExecutionKey] = useState<string | null>(null);

  const closeSqlReview = useCallback((reviewKey?: string) => {
    setSqlDialogOpen(false);
    setSqlReviewAlert(null);
    setSqlDraft("");
    setSqlDecisionLoading(null);
    if (reviewKey) {
      setDismissedSqlReviewKey(reviewKey);
    }
  }, []);

  const openSqlReview = useCallback(
    (alert: AlertNotification, options?: { force?: boolean }) => {
      const sqlApproval = getSqlApproval(alert);
      const reviewKey = getSqlReviewKey(alert);
      if (!sqlApproval || !isSqlReviewable(alert) || !reviewKey) return;
      if (!options?.force && sqlDialogOpen && sqlReviewAlert?.id === alert.id) return;
      if (!options?.force && dismissedSqlReviewKey === reviewKey) return;

      setSqlReviewAlert(alert);
      setSqlDraft(sqlApproval.sql_command);
      setSqlDialogOpen(true);
    },
    [dismissedSqlReviewKey, sqlDialogOpen, sqlReviewAlert?.id]
  );

  const openSqlExecutionResult = useCallback(
    (alert: AlertNotification) => {
      const result = getSqlExecutionResult(alert);
      const executionKey = getSqlExecutionKey(alert);
      if (!result || !executionKey || dismissedSqlExecutionKey === executionKey) return;

      setSqlExecutionAlert(alert);
      setSqlExecutionDialogOpen(true);
      toast(result.status === "completed" ? "SQL executed successfully" : "SQL execution failed", {
        description: result.message
      });
    },
    [dismissedSqlExecutionKey]
  );

  const loadAlerts = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      if (statusFilter === "pending_approval") {
        const [pendingResult, approvedResult] = await Promise.all([
          fetchAlertNotifications({
            db: selectedDb,
            type: "tablespace",
            status: "pending_approval",
            limit: ACTIVE_ALERT_FETCH_LIMIT
          }),
          fetchAlertNotifications({
            db: selectedDb,
            type: "tablespace",
            status: "approved",
            limit: ACTIVE_ALERT_FETCH_LIMIT
          })
        ]);
        const activeAlerts = sortAlertsByCreatedAt([...pendingResult.items, ...approvedResult.items].filter(isActiveApprovalAlert));
        const offset = (page - 1) * PAGE_SIZE;
        setAlerts(activeAlerts.slice(offset, offset + PAGE_SIZE));
        setTotal(activeAlerts.length);

        const maxPage = Math.max(1, Math.ceil(activeAlerts.length / PAGE_SIZE));
        if (page > maxPage) {
          setPage(maxPage);
        }
        return;
      }

      const result = await fetchAlertNotifications({
        db: selectedDb,
        type: "tablespace",
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
      const message = loadError instanceof Error ? loadError.message : "Could not load tablespace alerts.";
      setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [page, selectedDb, statusFilter]);

  const loadPendingSqlApproval = useCallback(async () => {
    try {
      const result = await fetchPendingSqlApprovals({
        db: selectedDb,
        limit: 50
      });
      const nextAlert = result.items[0];
      if (sqlDialogOpen && sqlReviewAlert && !result.items.some((alert) => alert.id === sqlReviewAlert.id)) {
        closeSqlReview(getSqlReviewKey(sqlReviewAlert) || undefined);
      }
      if (nextAlert) {
        openSqlReview(nextAlert);
      }
    } catch {
      // The alert list remains usable even if the SQL-review poll misses once.
    }
  }, [closeSqlReview, openSqlReview, selectedDb, sqlDialogOpen, sqlReviewAlert]);

  useEffect(() => {
    void loadAlerts();
    void loadPendingSqlApproval();
    const intervalId = window.setInterval(() => {
      void loadAlerts({ silent: true });
    }, 30000);
    const sqlReviewIntervalId = window.setInterval(() => {
      void loadPendingSqlApproval();
    }, 10000);
    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(sqlReviewIntervalId);
    };
  }, [loadAlerts, loadPendingSqlApproval]);

  useEffect(() => {
    const query = new URLSearchParams({
      db: selectedDb,
      alert_type: "tablespace"
    });
    const events = new EventSource(`/api/alerts/stream?${query.toString()}`);

    events.addEventListener("alert", (event) => {
      void loadAlerts({ silent: true });
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { alert?: AlertNotification };
        if (payload.alert) {
          if (isExecutionFinalStatus(payload.alert.status)) {
            if (sqlReviewAlert?.id === payload.alert.id) {
              closeSqlReview(getSqlReviewKey(sqlReviewAlert) || undefined);
            }
            openSqlExecutionResult(payload.alert);
            return;
          }

          if (
            sqlReviewAlert?.id === payload.alert.id &&
            getSqlApproval(payload.alert)?.status !== "pending"
          ) {
            closeSqlReview(getSqlReviewKey(sqlReviewAlert) || undefined);
            openSqlExecutionResult(payload.alert);
            return;
          }

          openSqlReview(payload.alert);
        }
      } catch {
        // Polling still catches SQL-review requests if an event payload is malformed.
      }
    });

    return () => events.close();
  }, [closeSqlReview, loadAlerts, openSqlExecutionResult, openSqlReview, selectedDb, sqlReviewAlert]);

  const pendingCount = statusFilter === "pending_approval" ? total : 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstItem = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(page * PAGE_SIZE, total);
  const statusDescription = statusFilter === "pending_approval" ? "active approval" : statusFilter === "all" ? "all" : formatStatusLabel(statusFilter).toLowerCase();
  const emptyStatusLabel = statusFilter === "pending_approval" ? "active" : statusFilter === "all" ? "any" : statusDescription;
  const canGoPrevious = page > 1;
  const canGoNext = page < pageCount;
  const isUpdating = (alert: AlertNotification) => updatingId === alert.id;

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value as StatusFilter);
    setPage(1);
  };

  const updateStatus = async (alert: AlertNotification, status: AlertNotificationStatus) => {
    setUpdatingId(alert.id);
    try {
      await updateAlertNotificationStatus(alert.id, status, undefined, user?.username);
      toast.success(`Alert ${status.replace(/_/g, " ")}`);
      await loadAlerts({ silent: true });
      if (status === "approved") {
        window.setTimeout(() => {
          void loadPendingSqlApproval();
        }, 1500);
      }
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Could not update alert.";
      toast.error("Alert update failed", { description: message });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSqlDecision = async (decision: AlertSqlApprovalDecision) => {
    if (!sqlReviewAlert) return;

    const reviewKey = getSqlReviewKey(sqlReviewAlert);
    setSqlDecisionLoading(decision);
    try {
      await decideAlertSqlApproval(sqlReviewAlert.id, decision, sqlDraft, user?.username);
      toast.success(decision === "approved" ? "SQL approved" : "SQL rejected");
      closeSqlReview(reviewKey || undefined);
      await loadAlerts({ silent: true });
    } catch (decisionError) {
      const message = decisionError instanceof Error ? decisionError.message : "Could not submit SQL decision.";
      toast.error("SQL approval failed", { description: message });
    } finally {
      setSqlDecisionLoading(null);
    }
  };

  const sqlReviewApproval = sqlReviewAlert ? getSqlApproval(sqlReviewAlert) : null;
  const sqlExecutionResult = sqlExecutionAlert ? getSqlExecutionResult(sqlExecutionAlert) : null;
  const sqlExecutionOutput = formatExecutionValue(sqlExecutionResult?.sql_output);
  const databaseResultOutput = formatExecutionValue(sqlExecutionResult?.database_result);

  return (
    <>
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-amber-300" />
              Tablespace Notifications
              {pendingCount ? <StatusBadge status="pending_approval">{pendingCount} Active</StatusBadge> : null}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => loadAlerts()} disabled={loading}>
                <RefreshCcw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Refresh
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Showing {firstItem}-{lastItem} of {total} {statusDescription} notifications
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
              No {emptyStatusLabel} tablespace notifications for {selectedDb}.
            </div>
          ) : null}
          <div className="grid gap-3 xl:grid-cols-2">
            {alerts.map((alert) => {
              const decisionMeta = getDecisionMeta(alert);
              const DecisionIcon = decisionMeta?.icon;
              const showSqlReview = isSqlReviewable(alert);
              const workflowState = getWorkflowState(alert);

              return (
                <div
                  key={alert.id}
                  className={cn(
                    "rounded-md border border-border/70 bg-secondary/30 p-4",
                    workflowState ? "tablespace-approval-card border-cyan-400/30 bg-cyan-400/10 shadow-neon" : ""
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-semibold text-cyan-100">{alert.tablespace || alert.object_name || "TABLESPACE"}</p>
                        <StatusBadge status={alert.severity}>{alert.severity}</StatusBadge>
                        <StatusBadge status={statusTone(alert.status)}>{alert.status.replace(/_/g, " ")}</StatusBadge>
                        {workflowState ? <StatusBadge status="pending_approval">{workflowState.badge}</StatusBadge> : null}
                        {showSqlReview ? <StatusBadge status="pending_approval">SQL Review</StatusBadge> : null}
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <span>
                          {alert.db} / {formatDateTime(alert.created_at)}
                        </span>
                        <span>Requested by {alert.created_by}</span>
                        {decisionMeta && DecisionIcon ? (
                          <span className="inline-flex items-center gap-1 text-slate-300">
                            <DecisionIcon className="h-3.5 w-3.5" />
                            {decisionMeta.label}: {decisionMeta.value}
                          </span>
                        ) : null}
                        {alert.approved_at ? <span>Decision at {formatDateTime(alert.approved_at)}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {showSqlReview ? (
                        <Button variant="neon" size="sm" onClick={() => openSqlReview(alert, { force: true })}>
                          <Code2 className="h-4 w-4" />
                          Review SQL
                        </Button>
                      ) : null}
                      {alert.status === "pending_approval" ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => updateStatus(alert, "approved")} disabled={isUpdating(alert)}>
                            {isUpdating(alert) ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Approve
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => updateStatus(alert, "rejected")} disabled={isUpdating(alert)}>
                            {isUpdating(alert) ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                            Reject
                          </Button>
                        </>
                      ) : alert.status === "approved" && workflowState ? (
                        <Button variant="outline" size="sm" disabled>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {workflowState.actionLabel}
                        </Button>
                      ) : alert.status === "approved" || alert.status === "completed" ? (
                        <Button variant="outline" size="sm" disabled>
                          <CheckCircle2 className="h-4 w-4" />
                          {alert.status === "completed" ? "Completed" : "Approved"}
                        </Button>
                      ) : alert.status === "rejected" || alert.status === "failed" ? (
                        <Button variant="ghost" size="sm" disabled>
                          <XCircle className="h-4 w-4" />
                          {alert.status === "failed" ? "Failed" : "Rejected"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-200">{alert.message}</p>
                  {workflowState ? (
                    <div className="mt-3 rounded-md border border-cyan-400/20 bg-background/45 p-3">
                      <div className="flex items-center gap-3">
                        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-300/30 bg-cyan-300/10">
                          <span className="absolute inset-1 rounded-md border border-cyan-300/20 opacity-70 animate-ping" />
                          <Loader2 className="relative h-4 w-4 animate-spin text-cyan-100" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-cyan-50">{workflowState.title}</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">{workflowState.description}</p>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/70">
                        <div className="tablespace-wait-bar h-full w-1/2 rounded-full bg-gradient-to-r from-cyan-300 via-amber-300 to-cyan-300" />
                      </div>
                    </div>
                  ) : null}
                  {typeof alert.utilization_pct === "number" ? (
                    <div className="mt-4">
                      <Progress value={alert.utilization_pct} />
                      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                        <span>{formatNumber(alert.utilization_pct, 1)}% used</span>
                        {typeof alert.critical_pct === "number" ? <span>Critical {formatNumber(alert.critical_pct, 0)}%</span> : null}
                        {typeof alert.extend_size_gb === "number" ? <span>Extend {formatNumber(alert.extend_size_gb, 1)} GB</span> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={sqlDialogOpen && Boolean(sqlReviewAlert)}
        onOpenChange={(open) => {
          setSqlDialogOpen(open);
          if (!open && sqlReviewAlert) {
            setDismissedSqlReviewKey(getSqlReviewKey(sqlReviewAlert) || null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-cyan-200" />
              Review SQL Command
            </DialogTitle>
            <DialogDescription>
              {sqlReviewAlert?.tablespace || sqlReviewAlert?.object_name || "TABLESPACE"} on {sqlReviewAlert?.db}
              {sqlReviewApproval?.updated_at ? ` / ${formatDateTime(sqlReviewApproval.updated_at)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="sql-review-command">SQL command</Label>
            <Textarea
              id="sql-review-command"
              className="min-h-[280px] resize-y font-mono text-xs leading-relaxed text-cyan-50"
              value={sqlDraft}
              onChange={(event) => setSqlDraft(event.target.value)}
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleSqlDecision("rejected")} disabled={Boolean(sqlDecisionLoading)}>
              {sqlDecisionLoading === "rejected" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Reject SQL
            </Button>
            <Button onClick={() => handleSqlDecision("approved")} disabled={Boolean(sqlDecisionLoading) || !sqlDraft.trim()}>
              {sqlDecisionLoading === "approved" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve SQL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sqlExecutionDialogOpen && Boolean(sqlExecutionAlert)}
        onOpenChange={(open) => {
          setSqlExecutionDialogOpen(open);
          if (!open && sqlExecutionAlert) {
            setDismissedSqlExecutionKey(getSqlExecutionKey(sqlExecutionAlert) || null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {sqlExecutionResult?.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              ) : (
                <XCircle className="h-5 w-5 text-red-300" />
              )}
              SQL Execution Result
            </DialogTitle>
            <DialogDescription>
              {sqlExecutionAlert?.tablespace || sqlExecutionAlert?.object_name || "TABLESPACE"} on {sqlExecutionAlert?.db}
              {sqlExecutionResult?.executed_at ? ` / ${formatDateTime(sqlExecutionResult.executed_at)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="rounded-md border border-border/70 bg-secondary/30 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={sqlExecutionResult?.status === "completed" ? "healthy" : "critical"}>
                  {sqlExecutionResult?.status === "completed" ? "Success" : "Failed"}
                </StatusBadge>
                {typeof sqlExecutionResult?.rows_affected === "number" ? (
                  <span className="text-xs text-muted-foreground">{formatNumber(sqlExecutionResult.rows_affected)} rows affected</span>
                ) : null}
              </div>
              <p className="text-sm text-slate-100">{sqlExecutionResult?.message || sqlExecutionAlert?.message}</p>
            </div>
            {sqlExecutionResult?.sql_command ? (
              <div className="grid gap-2">
                <Label>Executed SQL</Label>
                <pre className="max-h-40 overflow-auto rounded-md border border-border/70 bg-background/60 p-3 font-mono text-xs text-cyan-50">
                  {sqlExecutionResult.sql_command}
                </pre>
              </div>
            ) : null}
            {databaseResultOutput ? (
              <div className="grid gap-2">
                <Label className="inline-flex items-center gap-2">
                  <SquareTerminal className="h-4 w-4" />
                  Database result
                </Label>
                <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-background/60 p-3 font-mono text-xs text-slate-100">
                  {databaseResultOutput}
                </pre>
              </div>
            ) : null}
            {sqlExecutionOutput ? (
              <div className="grid gap-2">
                <Label>SQL output</Label>
                <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-background/60 p-3 font-mono text-xs text-slate-100">
                  {sqlExecutionOutput}
                </pre>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setSqlExecutionDialogOpen(false);
                if (sqlExecutionAlert) {
                  setDismissedSqlExecutionKey(getSqlExecutionKey(sqlExecutionAlert) || null);
                }
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
