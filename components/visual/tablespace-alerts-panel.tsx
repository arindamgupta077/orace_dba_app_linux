"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, ChevronLeft, ChevronRight, Code2, Loader2, RefreshCcw, Sparkles, SquareTerminal, UserCheck, UserX, WandSparkles, XCircle } from "lucide-react";
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
const SQL_PHASE_TIMEOUT_MS = 3 * 60 * 1000;
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
  const failedByMessage =
    alert.status === "approved" &&
    sqlApproval?.status === "approved" &&
    /no\s+disk\s+space|not\s+enough\s+(os\s+)?disk\s+space|insufficient\s+(os\s+)?disk\s+space|sql\s+execution\s+failed|execution\s+failed|ora-\d+/i.test(
      alert.message
    );

  if (failedByMessage) {
    return {
      status: "failed",
      message: alert.message,
      sql_command: sqlApproval.sql_command,
      sql_output: alert.message,
      executed_at: alert.completed_at || alert.updated_at
    };
  }

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

function getTimedOutSqlPhase(alert: AlertNotification) {
  if (alert.status !== "approved") return null;
  if (getSqlExecutionResult(alert)) return null;

  const sqlApproval = getSqlApproval(alert);
  const startedAtRaw =
    sqlApproval?.status === "approved"
      ? sqlApproval.updated_at || sqlApproval.approved_at || alert.approved_at || alert.updated_at
      : alert.approved_at || alert.updated_at;
  const startedAt = Date.parse(String(startedAtRaw || ""));
  if (!Number.isFinite(startedAt) || Date.now() - startedAt <= SQL_PHASE_TIMEOUT_MS) return null;

  if (!sqlApproval) return "generation";
  if (sqlApproval.status === "approved") return "execution";
  return null;
}

function sortAlertsByCreatedAt(alerts: AlertNotification[]) {
  return [...alerts].sort((left, right) => Date.parse(right.updated_at || right.created_at) - Date.parse(left.updated_at || left.created_at));
}

function getWorkflowState(alert: AlertNotification) {
  if (alert.status !== "approved") return null;

  const sqlApproval = getSqlApproval(alert);
  const sqlExecution = getSqlExecutionResult(alert);
  if (sqlExecution) return null;

  if (!sqlApproval) {
    return {
      phase: "generating",
      badge: "Generating SQL",
      title: "Generating SQL",
      description: "Approval received. n8n is reading Oracle metadata and preparing a DBA-reviewable SQL proposal.",
      actionLabel: "Generating SQL",
      steps: ["Approved", "Oracle metadata", "AI SQL proposal"]
    };
  }

  if (sqlApproval.status === "pending") {
    return {
      phase: "review",
      badge: "SQL review",
      title: "SQL ready for DBA approval",
      description: "Generated SQL is attached. Review the final command before n8n executes anything.",
      actionLabel: "SQL review pending",
      steps: ["Generated", "Review SQL", "Approve execution"]
    };
  }

  if (sqlApproval.status === "approved") {
    return {
      phase: "executing",
      badge: "Executing SQL",
      title: "Executing approved SQL",
      description: "Final SQL approval sent. Waiting for n8n to post the execution result.",
      actionLabel: "Executing SQL",
      steps: ["SQL approved", "Oracle execution", "Result callback"]
    };
  }

  return null;
}

function formatExecutionValue(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getFieldValue(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key] ?? record[key.toUpperCase()] ?? record[key.toLowerCase()];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function parseStructuredExecutionValue(value: unknown) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!/^[{[]/.test(trimmed)) return value;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function isPrimitiveExecutionValue(value: unknown) {
  return value == null || typeof value !== "object";
}

function formatExecutionLabel(key: string) {
  const normalized = key.trim().toLowerCase();
  const overrides: Record<string, string> = {
    after_usage_pct: "After usage %",
    post_usage_rows: "Post-usage rows",
    oracle_execute_result: "Oracle execute result",
    tablespace_name: "Tablespace",
    usage_pct: "Usage %",
    total_gb: "Total GB",
    free_gb: "Free GB",
    rows_affected: "Rows affected",
    sql_output: "SQL output"
  };

  if (overrides[normalized]) return overrides[normalized];

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => {
      if (word === "db" || word === "gb" || word === "pct" || word === "sql" || word === "os") return word.toUpperCase();
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function formatExecutionCellValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatNumber(value, Number.isInteger(value) ? 0 : 2);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function getExecutionTableColumns(rows: Array<Record<string, unknown>>) {
  const columns: string[] = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!columns.includes(key)) columns.push(key);
    });
  });
  return columns;
}

function renderExecutionSummary(record: Record<string, unknown>) {
  const primitiveEntries = Object.entries(record).filter(([, value]) => isPrimitiveExecutionValue(value));
  if (!primitiveEntries.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {primitiveEntries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-border/60 bg-secondary/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{formatExecutionLabel(key)}</p>
          <p className="mt-1 break-words text-sm font-medium text-slate-100">{formatExecutionCellValue(value)}</p>
        </div>
      ))}
    </div>
  );
}

function renderExecutionTable(title: string, rows: Array<Record<string, unknown>>) {
  const columns = getExecutionTableColumns(rows);
  if (!columns.length) return null;

  return (
    <div key={title} className="grid gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatExecutionLabel(title)}</p>
      <div className="overflow-auto rounded-md border border-border/70">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 font-medium">
                  {formatExecutionLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`} className="border-t border-border/60">
                {columns.map((column) => (
                  <td key={column} className="px-3 py-2 text-slate-100">
                    {formatExecutionCellValue(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderStructuredExecutionValue(value: unknown, title = "Result") {
  const parsed = parseStructuredExecutionValue(value);

  if (isPrimitiveExecutionValue(parsed)) {
    const text = formatExecutionValue(parsed);
    if (!text) return null;
    return (
      <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-background/60 p-3 font-mono text-xs text-slate-100">
        {text}
      </pre>
    );
  }

  if (Array.isArray(parsed)) {
    const rows = parsed.filter(isRecord);
    if (rows.length === parsed.length && rows.length) return renderExecutionTable(title, rows);
    return (
      <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-background/60 p-3 font-mono text-xs text-slate-100">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  }

  if (!isRecord(parsed)) return null;

  const nestedEntries = Object.entries(parsed).filter(([, item]) => !isPrimitiveExecutionValue(item));

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/50 p-3">
      {renderExecutionSummary(parsed)}
      {nestedEntries.map(([key, item]) => {
        const nested = parseStructuredExecutionValue(item);
        if (Array.isArray(nested)) {
          const rows = nested.filter(isRecord);
          if (rows.length === nested.length && rows.length) return renderExecutionTable(key, rows);
        }

        if (isRecord(nested)) {
          return (
            <div key={key} className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatExecutionLabel(key)}</p>
              {renderStructuredExecutionValue(nested, key)}
            </div>
          );
        }

        return (
          <div key={key} className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatExecutionLabel(key)}</p>
            {renderStructuredExecutionValue(nested, key)}
          </div>
        );
      })}
    </div>
  );
}

function normalizeMetadataRows(value: unknown): Array<Record<string, unknown>> {
  let current = value;
  if (typeof current === "string" && current.trim()) {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return [];
    }
  }

  if (Array.isArray(current)) {
    return current.flatMap((item) => normalizeMetadataRows(item));
  }

  if (!isRecord(current)) return [];

  const wrapped = current.json ?? current.body ?? current.data ?? current.payload;
  if (wrapped && wrapped !== current) {
    const wrappedRows = normalizeMetadataRows(wrapped);
    if (wrappedRows.length) return wrappedRows;
  }

  return [current];
}

function uniqueMetadataRows(rows: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const fileName = getFieldValue(row, ["file_name"]);
    const key = fileName || JSON.stringify(row) || String(index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getNestedRecord(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function getTablespaceMetadataRows(sqlApproval: AlertSqlApproval | null | undefined) {
  const databaseInfo = isRecord(sqlApproval?.database_info) ? sqlApproval.database_info : undefined;
  const request = isRecord(sqlApproval?.request) ? sqlApproval.request : undefined;
  const requestDatabaseInfo = getNestedRecord(request, "database_info");
  const requestPayload = getNestedRecord(request, "request_payload");
  const requestPayloadDatabaseInfo = getNestedRecord(requestPayload, "database_info");

  return uniqueMetadataRows([
    ...normalizeMetadataRows(sqlApproval?.tablespace_metadata),
    ...normalizeMetadataRows(databaseInfo?.metadata),
    ...normalizeMetadataRows(requestDatabaseInfo?.metadata),
    ...normalizeMetadataRows(requestPayload?.tablespace_metadata),
    ...normalizeMetadataRows(requestPayloadDatabaseInfo?.metadata)
  ]);
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
        const normalizedApprovedItems = await Promise.all(
          approvedResult.items.map(async (alert) => {
            const timedOutPhase = getTimedOutSqlPhase(alert);
            if (!timedOutPhase) return alert;

            const message =
              timedOutPhase === "generation"
                ? "SQL generation timed out after 3 minutes without an n8n SQL proposal."
                : "SQL execution timed out after 3 minutes without an n8n completion acknowledgement.";

            try {
              const result = await updateAlertNotificationStatus(alert.id, "failed", message, "n8n");
              return result.alert;
            } catch {
              return alert;
            }
          })
        );
        const activeAlerts = sortAlertsByCreatedAt([...pendingResult.items, ...normalizedApprovedItems].filter(isActiveApprovalAlert));
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
      const result = await decideAlertSqlApproval(sqlReviewAlert.id, decision, sqlDraft, user?.username);
      const executionResult = getSqlExecutionResult(result.alert);
      toast(executionResult?.status === "failed" ? "SQL execution failed" : decision === "approved" ? "SQL approved" : "SQL rejected", {
        description: executionResult?.message
      });
      closeSqlReview(reviewKey || undefined);
      if (executionResult) {
        setSqlExecutionAlert(result.alert);
        setSqlExecutionDialogOpen(true);
      }
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
  const databaseResult = parseStructuredExecutionValue(sqlExecutionResult?.database_result);
  const hasDatabaseResult = databaseResult != null && databaseResult !== "";
  const sqlDatabaseInfo = isRecord(sqlReviewApproval?.database_info) ? sqlReviewApproval.database_info : undefined;
  const sqlMetadataRows = getTablespaceMetadataRows(sqlReviewApproval);

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
                          {alert.db} / {formatDateTime(alert.updated_at || alert.created_at)}
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
                    <div
                      className={cn(
                        "mt-3 rounded-md border p-3",
                        workflowState.phase === "executing"
                          ? "border-amber-300/30 bg-amber-300/10"
                          : "border-cyan-400/20 bg-background/45"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
                            workflowState.phase === "executing"
                              ? "border-amber-300/40 bg-amber-300/10"
                              : "border-cyan-300/30 bg-cyan-300/10"
                          )}
                        >
                          <span
                            className={cn(
                              "absolute inset-1 rounded-md border opacity-70 animate-ping",
                              workflowState.phase === "executing" ? "border-amber-300/25" : "border-cyan-300/20"
                            )}
                          />
                          {workflowState.phase === "generating" ? (
                            <WandSparkles className="relative h-4 w-4 text-cyan-100" />
                          ) : workflowState.phase === "executing" ? (
                            <Loader2 className="relative h-4 w-4 animate-spin text-amber-100" />
                          ) : (
                            <Sparkles className="relative h-4 w-4 text-cyan-100" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className={cn("text-sm font-medium", workflowState.phase === "executing" ? "text-amber-50" : "text-cyan-50")}>
                            {workflowState.title}
                          </p>
                          <p className="text-xs leading-relaxed text-muted-foreground">{workflowState.description}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {workflowState.steps.map((step, index) => (
                          <div
                            key={step}
                            className={cn(
                              "flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                              index === 0
                                ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                                : workflowState.phase === "executing" && index === 1
                                  ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
                                  : "border-cyan-300/20 bg-cyan-300/5 text-cyan-100"
                            )}
                          >
                            {index === 0 ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            ) : index === 1 ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span className="truncate">{step}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/70">
                        <div
                          className={cn(
                            "tablespace-wait-bar h-full w-1/2 rounded-full",
                            workflowState.phase === "executing"
                              ? "bg-gradient-to-r from-amber-300 via-red-300 to-amber-300"
                              : "bg-gradient-to-r from-cyan-300 via-emerald-300 to-cyan-300"
                          )}
                        />
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
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
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
              className="min-h-[150px] resize-y font-mono text-xs leading-relaxed text-cyan-50"
              value={sqlDraft}
              onChange={(event) => setSqlDraft(event.target.value)}
              spellCheck={false}
            />
          </div>
          {sqlReviewApproval?.explanation ? (
            <div className="rounded-md border border-border/70 bg-secondary/30 p-3">
              <Label>AI explanation</Label>
              <p className="mt-2 text-sm leading-relaxed text-slate-100">{sqlReviewApproval.explanation}</p>
            </div>
          ) : null}
          {sqlDatabaseInfo ? (
            <div className="grid gap-3">
              <Label>Database information</Label>
              <div className="grid gap-2 rounded-md border border-border/70 bg-background/50 p-2 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Environment", getFieldValue(sqlDatabaseInfo, ["environment"])],
                  ["OS", getFieldValue(sqlDatabaseInfo, ["os"])],
                  ["DB type", getFieldValue(sqlDatabaseInfo, ["db_type", "dbType"])],
                  ["Tablespace", getFieldValue(sqlDatabaseInfo, ["tablespace", "tablespace_name"])],
                  ["Requested by", getFieldValue(sqlDatabaseInfo, ["requested_by", "requestedBy"])],
                  ["Database", sqlReviewAlert?.db || ""]
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="rounded-md border border-border/50 bg-secondary/20 px-2.5 py-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="mt-1 truncate text-sm font-medium text-slate-100">{value}</p>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
          {sqlMetadataRows.length ? (
            <div className="grid gap-2">
              <Label>Tablespace metadata</Label>
              <div className="overflow-auto rounded-md border border-border/70">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-secondary/60 text-muted-foreground">
                    <tr>
                      {["Tablespace", "Datafile", "File size GB", "Free GB", "Autoextend", "Max size GB", "OMF destination"].map((heading) => (
                        <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sqlMetadataRows.map((row, index) => (
                      <tr key={`${getFieldValue(row, ["file_name"])}-${index}`} className="border-t border-border/60">
                        <td className="px-3 py-2 font-mono text-cyan-100">{getFieldValue(row, ["tablespace_name"])}</td>
                        <td className="max-w-72 truncate px-3 py-2 font-mono text-slate-100" title={getFieldValue(row, ["file_name"])}>
                          {getFieldValue(row, ["file_name"])}
                        </td>
                        <td className="px-3 py-2">{getFieldValue(row, ["file_size_gb"])}</td>
                        <td className="px-3 py-2">{getFieldValue(row, ["free_gb"])}</td>
                        <td className="px-3 py-2">{getFieldValue(row, ["autoextensible"])}</td>
                        <td className="px-3 py-2">{getFieldValue(row, ["max_size_gb"])}</td>
                        <td className="max-w-48 truncate px-3 py-2" title={getFieldValue(row, ["db_create_file_dest"])}>
                          {getFieldValue(row, ["db_create_file_dest"]) || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
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
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
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
            {hasDatabaseResult ? (
              <div className="grid gap-2">
                <Label className="inline-flex items-center gap-2">
                  <SquareTerminal className="h-4 w-4" />
                  Database result
                </Label>
                {renderStructuredExecutionValue(databaseResult)}
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
