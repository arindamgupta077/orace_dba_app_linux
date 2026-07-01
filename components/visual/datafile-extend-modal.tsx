"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Code2,
  Database,
  HardDriveDownload,
  Loader2,
  Play,
  RefreshCcw,
  SquareTerminal,
  X,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/visual/status-badge";
import { cn, formatDateTime } from "@/lib/utils";
import {
  decideAlertSqlApproval,
  fetchAlertNotifications,
  fetchPendingSqlApprovals,
  submitDatafileSelection,
  triggerDatafileExtend,
  updateAlertNotificationStatus
} from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type {
  AlertNotification,
  AlertSqlApproval,
  AlertSqlApprovalDecision,
  AlertSqlExecutionResult
} from "@/types/dba";

// ─── Types ──────────────────────────────────────────────────────────────────

type WorkflowStep =
  | "idle"
  | "initiating"
  | "polling_list"
  | "selecting"
  | "submitting"
  | "polling_sql"
  | "reviewing"
  | "approving"
  | "polling_result"
  | "success"
  | "failed"
  | "rejected"
  | "error";

// ─── Local helpers (mirrors tablespace-alerts-panel.tsx pattern) ─────────────

/**
 * Normalises the `tablespaces` metadata value that n8n sends.
 *
 * n8n can produce any of these shapes:
 *   • A stringified JSON array:  "[{\"NAME\":\"USERS\"}, ...]"   ← most common
 *   • A plain array of objects:  [{NAME:"USERS"}, ...]
 *   • A plain array of strings:  ["USERS", "SYSTEM", ...]
 *
 * Returns a sorted, deduplicated array of plain tablespace name strings.
 */
function parseTablespaceList(raw: unknown): string[] {
  let arr: unknown[];

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return [];
  }

  const names = arr
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        // Oracle returns columns in UPPER-CASE; also guard lower-case aliases
        const name =
          obj.NAME ??
          obj.name ??
          obj.TABLESPACE_NAME ??
          obj.tablespace_name ??
          obj.TS_NAME ??
          obj.ts_name;
        return typeof name === "string" ? name.trim() : "";
      }
      return "";
    })
    .filter(Boolean);

  // Deduplicate and sort alphabetically
  return [...new Set(names)].sort();
}

function getSqlApproval(alert: AlertNotification): AlertSqlApproval | null {
  const raw = alert.metadata?.sql_approval ?? alert.metadata?.sqlApproval;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const status = String(record.status || "");
  const sqlCommand = typeof record.sql_command === "string" ? record.sql_command : "";
  if (!sqlCommand || (status !== "pending" && status !== "approved" && status !== "rejected")) {
    return null;
  }
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
        status: status as "completed" | "failed",
        message:
          typeof record.message === "string" && record.message.trim()
            ? record.message
            : alert.message,
        executed_at:
          typeof record.executed_at === "string"
            ? record.executed_at
            : alert.completed_at || alert.updated_at
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
    status: alert.status as "completed" | "failed",
    message: alert.message,
    sql_command: sqlApproval.sql_command,
    executed_at: alert.completed_at || alert.updated_at
  };
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

function resolveStepFromAlert(alert: AlertNotification): {
  step: WorkflowStep;
  tablespaceList: string[];
  selectedTablespace: string;
  selectedSizeGb: number;
  sqlDraft: string;
  sqlExplanation: string;
  sqlDatabaseInfo: Record<string, unknown> | null;
  sqlTablespaceMetadata: Array<Record<string, unknown>>;
  executionResult: AlertSqlExecutionResult | null;
} {
  const meta = (alert.metadata || {}) as Record<string, unknown>;
  const executionResult = getSqlExecutionResult(alert);
  const sqlApproval = getSqlApproval(alert);

  if (executionResult) {
    return {
      step: executionResult.status === "completed" ? "success" : "failed",
      tablespaceList: [],
      selectedTablespace: String(meta.selected_tablespace || ""),
      selectedSizeGb: Number(meta.selected_size_gb || 0),
      sqlDraft: executionResult.sql_command || "",
      sqlExplanation: "",
      sqlDatabaseInfo: null,
      sqlTablespaceMetadata: [],
      executionResult
    };
  }
  if (alert.status === "rejected") {
    return {
      step: "rejected",
      tablespaceList: [],
      selectedTablespace: String(meta.selected_tablespace || ""),
      selectedSizeGb: Number(meta.selected_size_gb || 0),
      sqlDraft: "",
      sqlExplanation: "",
      sqlDatabaseInfo: null,
      sqlTablespaceMetadata: [],
      executionResult: null
    };
  }
  if (sqlApproval?.status === "pending" && sqlApproval.sql_command) {
    return {
      step: "reviewing",
      tablespaceList: [],
      selectedTablespace: String(meta.selected_tablespace || ""),
      selectedSizeGb: Number(meta.selected_size_gb || 0),
      sqlDraft: sqlApproval.sql_command,
      sqlExplanation: sqlApproval.explanation || "",
      sqlDatabaseInfo: sqlApproval.database_info || null,
      sqlTablespaceMetadata: getTablespaceMetadataRows(sqlApproval),
      executionResult: null
    };
  }
  if (alert.status === "approved") {
    return {
      step: "polling_sql",
      tablespaceList: [],
      selectedTablespace: String(meta.selected_tablespace || ""),
      selectedSizeGb: Number(meta.selected_size_gb || 0),
      sqlDraft: "",
      sqlExplanation: "",
      sqlDatabaseInfo: null,
      sqlTablespaceMetadata: [],
      executionResult: null
    };
  }
  // pending_approval with tablespace list
  const parsedList = parseTablespaceList(meta.tablespaces);
  if (parsedList.length > 0) {
    return {
      step: "selecting",
      tablespaceList: parsedList,
      selectedTablespace: "",
      selectedSizeGb: 10,
      sqlDraft: "",
      sqlExplanation: "",
      sqlDatabaseInfo: null,
      sqlTablespaceMetadata: [],
      executionResult: null
    };
  }
  return {
    step: "polling_list",
    tablespaceList: [],
    selectedTablespace: "",
    selectedSizeGb: 10,
    sqlDraft: "",
    sqlExplanation: "",
    sqlDatabaseInfo: null,
    sqlTablespaceMetadata: [],
    executionResult: null
  };
}

// ─── Progress Stepper ────────────────────────────────────────────────────────

const PROGRESS_STEPS: { label: string; steps: WorkflowStep[] }[] = [
  { label: "Initiate", steps: ["idle", "initiating", "polling_list"] },
  { label: "Select", steps: ["selecting", "submitting"] },
  { label: "SQL Review", steps: ["polling_sql", "reviewing", "approving"] },
  { label: "Execute", steps: ["polling_result", "success", "failed", "rejected"] }
];

function StepProgress({ step }: { step: WorkflowStep }) {
  const currentGroup = PROGRESS_STEPS.findIndex((g) => (g.steps as WorkflowStep[]).includes(step));
  return (
    <div className="flex items-center gap-1 text-xs">
      {PROGRESS_STEPS.map((group, index) => {
        const isActive = index === currentGroup;
        const isDone = index < currentGroup;
        return (
          <div key={group.label} className="flex items-center gap-1">
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                isDone
                  ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-300"
                  : isActive
                  ? "border-cyan-400/60 bg-cyan-400/20 text-cyan-200"
                  : "border-border/60 bg-background/40 text-muted-foreground"
              )}
            >
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{index + 1}</span>}
            </div>
            <span
              className={cn(
                "hidden sm:inline",
                isDone ? "text-emerald-300" : isActive ? "text-cyan-200" : "text-muted-foreground"
              )}
            >
              {group.label}
            </span>
            {index < PROGRESS_STEPS.length - 1 && (
              <ChevronRight
                className={cn(
                  "h-3 w-3 shrink-0",
                  index < currentGroup ? "text-emerald-300/60" : "text-border/60"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Animated waiting indicator ──────────────────────────────────────────────

function WaitingAnimation({ message, subtext }: { message: string; subtext?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full border border-cyan-400/30" />
        <span className="absolute inset-2 animate-ping rounded-full border border-cyan-400/20 [animation-delay:200ms]" />
        <Loader2 className="relative h-7 w-7 animate-spin text-cyan-300" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{message}</p>
        {subtext && <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>}
      </div>
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-secondary/60">
        <div className="tablespace-wait-bar h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-cyan-400" />
      </div>
    </div>
  );
}

// ─── DatafileExtendModal ─────────────────────────────────────────────────────

interface DatafileExtendModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the modal resumes an existing in-progress workflow. */
  resumeAlertId?: string | null;
  onWorkflowComplete?: () => void;
}

export function DatafileExtendModal({
  open,
  onOpenChange,
  resumeAlertId,
  onWorkflowComplete
}: DatafileExtendModalProps) {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const databases = useAppStore((state) => state.databases);
  const user = useAppStore((state) => state.user);
  const username = user?.username || "arindam";
  const dbTarget = databases.find((db) => db.name === selectedDb);
  const triggerTablespaceRefresh = useAppStore((state) => state.triggerTablespaceRefresh);

  const [step, setStep] = useState<WorkflowStep>("idle");
  const [alertId, setAlertId] = useState<string | null>(null);
  const [tablespaceList, setTablespaceList] = useState<string[]>([]);
  const [selectedTablespace, setSelectedTablespace] = useState("");
  const [selectedSizeGb, setSelectedSizeGb] = useState<number>(10);
  const [sqlDraft, setSqlDraft] = useState("");
  const [sqlExplanation, setSqlExplanation] = useState("");
  const [sqlDatabaseInfo, setSqlDatabaseInfo] = useState<Record<string, unknown> | null>(null);
  const [sqlTablespaceMetadata, setSqlTablespaceMetadata] = useState<Array<Record<string, unknown>>>([]);
  const [sqlDecisionLoading, setSqlDecisionLoading] = useState<AlertSqlApprovalDecision | null>(null);
  const [executionResult, setExecutionResult] = useState<AlertSqlExecutionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingResume, setLoadingResume] = useState(false);

  const triggerTimeRef = useRef<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const stepRef = useRef<WorkflowStep>("idle");
  const alertIdRef = useRef<string | null>(null);

  stepRef.current = step;
  alertIdRef.current = alertId;

  // Trigger tablespace utilization refresh when datafile extend succeeds
  useEffect(() => {
    if (step === "success") {
      triggerTablespaceRefresh();
    }
  }, [step, triggerTablespaceRefresh]);

  // ── Reset / Resume on open ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    // Full reset first
    setStep("idle");
    setAlertId(null);
    setTablespaceList([]);
    setSelectedTablespace("");
    setSelectedSizeGb(10);
    setSqlDraft("");
    setSqlExplanation("");
    setSqlDatabaseInfo(null);
    setSqlTablespaceMetadata([]);
    setSqlDecisionLoading(null);
    setExecutionResult(null);
    setErrorMsg(null);
    pollCountRef.current = 0;

    if (!resumeAlertId) return;

    // Resume an existing operation
    setLoadingResume(true);
    fetchAlertNotifications({ db: selectedDb, type: "datafile_extend", limit: 50 })
      .then((result) => {
        const found = result.items.find((a) => a.id === resumeAlertId);
        if (!found) {
          setErrorMsg("Could not find the selected operation. It may have been deleted.");
          setStep("error");
          return;
        }
        const resolved = resolveStepFromAlert(found);
        setAlertId(found.id);
        setTablespaceList(resolved.tablespaceList);
        setSelectedTablespace(resolved.selectedTablespace);
        setSelectedSizeGb(resolved.selectedSizeGb || 10);
        setSqlDraft(resolved.sqlDraft);
        setSqlExplanation(resolved.sqlExplanation);
        setSqlDatabaseInfo(resolved.sqlDatabaseInfo);
        setSqlTablespaceMetadata(resolved.sqlTablespaceMetadata);
        setExecutionResult(resolved.executionResult);
        setStep(resolved.step);
      })
      .catch(() => {
        setErrorMsg("Failed to load the existing operation.");
        setStep("error");
      })
      .finally(() => setLoadingResume(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeAlertId]);

  // ── Core polling function ─────────────────────────────────────────────────
  const pollForUpdates = useCallback(async () => {
    const currentStep = stepRef.current;
    const currentAlertId = alertIdRef.current;

    try {
      if (currentStep === "polling_list") {
        pollCountRef.current += 1;
        if (pollCountRef.current > 24) {
          // 2-minute timeout (24 × 5 s)
          setErrorMsg(
            "Timeout: n8n did not return the tablespace list within 2 minutes. " +
              "Ensure the n8n workflow is active and uses a 'Respond to Webhook' node."
          );
          setStep("error");
          return;
        }

        const result = await fetchAlertNotifications({
          db: selectedDb,
          type: "datafile_extend",
          status: "pending_approval",
          limit: 10
        });

        const found = result.items.find((item) => {
          const meta = (item.metadata || {}) as Record<string, unknown>;
          return (
            parseTablespaceList(meta.tablespaces).length > 0 &&
            Date.parse(item.created_at) >= triggerTimeRef.current - 15_000
          );
        });

        if (found) {
          const meta = (found.metadata || {}) as Record<string, unknown>;
          const names = parseTablespaceList(meta.tablespaces);
          setAlertId(found.id);
          setTablespaceList(names);
          pollCountRef.current = 0;
          setStep("selecting");
        }
        return;
      }

      if (!currentAlertId) return;

      if (currentStep === "polling_sql") {
        // Check for pending SQL approval
        const sqlResult = await fetchPendingSqlApprovals({ db: selectedDb, limit: 50 });
        const found = sqlResult.items.find((item) => item.id === currentAlertId);
        if (found) {
          const approval = getSqlApproval(found);
          if (approval?.status === "pending" && approval.sql_command) {
            setSqlDraft(approval.sql_command);
            setSqlExplanation(approval.explanation || "");
            setSqlDatabaseInfo(approval.database_info || null);
            setSqlTablespaceMetadata(getTablespaceMetadataRows(approval));
            setStep("reviewing");
            return;
          }
          // It may have jumped straight to execution result
          const execResult = getSqlExecutionResult(found);
          if (execResult) {
            setExecutionResult(execResult);
            setStep(execResult.status === "completed" ? "success" : "failed");
            onWorkflowComplete?.();
            return;
          }
        }

        // Fallback: check the full alert
        const allResult = await fetchAlertNotifications({
          db: selectedDb,
          type: "datafile_extend",
          limit: 50
        });
        const alert = allResult.items.find((item) => item.id === currentAlertId);
        if (!alert) return;

        const approval = getSqlApproval(alert);
        if (approval?.status === "pending" && approval.sql_command) {
          setSqlDraft(approval.sql_command);
          setSqlExplanation(approval.explanation || "");
          setSqlDatabaseInfo(approval.database_info || null);
          setSqlTablespaceMetadata(getTablespaceMetadataRows(approval));
          setStep("reviewing");
        } else {
          const execResult = getSqlExecutionResult(alert);
          if (execResult) {
            setExecutionResult(execResult);
            setStep(execResult.status === "completed" ? "success" : "failed");
            onWorkflowComplete?.();
          } else if (alert.status === "completed") {
            setStep("success");
            onWorkflowComplete?.();
          } else if (alert.status === "failed") {
            setStep("failed");
            onWorkflowComplete?.();
          } else if (alert.status === "rejected") {
            setStep("rejected");
            onWorkflowComplete?.();
          }
        }
        return;
      }

      if (currentStep === "polling_result") {
        const result = await fetchAlertNotifications({
          db: selectedDb,
          type: "datafile_extend",
          limit: 50
        });
        const alert = result.items.find((item) => item.id === currentAlertId);
        if (!alert) return;

        const execResult = getSqlExecutionResult(alert);
        if (execResult) {
          setExecutionResult(execResult);
          setStep(execResult.status === "completed" ? "success" : "failed");
          onWorkflowComplete?.();
        } else if (alert.status === "completed") {
          setStep("success");
          onWorkflowComplete?.();
        } else if (alert.status === "failed") {
          setStep("failed");
          onWorkflowComplete?.();
        } else if (alert.status === "rejected") {
          setStep("rejected");
          onWorkflowComplete?.();
        }
      }
    } catch {
      // Polling errors are non-fatal; stay in current waiting state
    }
  }, [selectedDb, onWorkflowComplete]);

  // ── Start / stop polling ──────────────────────────────────────────────────
  const isPollingStep = step === "polling_list" || step === "polling_sql" || step === "polling_result";

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (!open || !isPollingStep) return;

    void pollForUpdates();
    pollingRef.current = setInterval(() => void pollForUpdates(), 5_000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [open, isPollingStep, pollForUpdates]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ── SSE for real-time n8n pushes ──────────────────────────────────────────
  useEffect(() => {
    if (!open || (!isPollingStep && step !== "selecting" && step !== "reviewing")) return;
    const query = new URLSearchParams({ db: selectedDb, alert_type: "datafile_extend" });
    const events = new EventSource(`/api/alerts/stream?${query.toString()}`);
    events.addEventListener("alert", () => void pollForUpdates());
    return () => events.close();
  }, [open, isPollingStep, step, selectedDb, pollForUpdates]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleInitiate = async () => {
    setStep("initiating");
    setErrorMsg(null);
    pollCountRef.current = 0;
    try {
      triggerTimeRef.current = Date.now();
      await triggerDatafileExtend(selectedDb);
      setStep("polling_list");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to trigger n8n workflow.";
      setErrorMsg(message);
      toast.error("Trigger failed", { description: message });
      setStep("error");
    }
  };

  const handleSubmitSelection = async () => {
    if (!alertId || !selectedTablespace || selectedSizeGb <= 0) return;
    setStep("submitting");
    try {
      await submitDatafileSelection(alertId, selectedTablespace, selectedSizeGb);
      setStep("polling_sql");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit selection.";
      setErrorMsg(message);
      toast.error("Submit failed", { description: message });
      setStep("selecting");
    }
  };

  const handleSqlDecision = async (decision: AlertSqlApprovalDecision) => {
    if (!alertId) return;
    setSqlDecisionLoading(decision);
    setErrorMsg(null);
    try {
      const result = await decideAlertSqlApproval(alertId, decision, sqlDraft, username);
      if (decision === "approved") {
        const execResult = getSqlExecutionResult(result.alert);
        if (execResult) {
          setExecutionResult(execResult);
          setStep(execResult.status === "completed" ? "success" : "failed");
          onWorkflowComplete?.();
          toast(execResult.status === "completed" ? "SQL executed successfully" : "SQL execution failed", {
            description: execResult.message
          });
          return;
        }
        setStep("polling_result");
        toast.success("SQL approved — executing on Oracle...");
      } else {
        setStep("rejected");
        onWorkflowComplete?.();
        toast.info("SQL rejected. Workflow cancelled.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit SQL decision.";
      setErrorMsg(message);
      toast.error("Decision failed", { description: message });
    } finally {
      setSqlDecisionLoading(null);
    }
  };

  const handleClose = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    onOpenChange(false);
  };

  const handleStartOver = () => {
    setStep("idle");
    setAlertId(null);
    setTablespaceList([]);
    setSelectedTablespace("");
    setSelectedSizeGb(10);
    setSqlDraft("");
    setSqlExplanation("");
    setSqlDatabaseInfo(null);
    setSqlTablespaceMetadata([]);
    setSqlDecisionLoading(null);
    setExecutionResult(null);
    setErrorMsg(null);
    pollCountRef.current = 0;
  };

  // ── Step content renderers ────────────────────────────────────────────────

  const renderContent = () => {
    if (loadingResume) {
      return <WaitingAnimation message="Loading existing operation..." />;
    }

    switch (step) {
      case "idle":
        return (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-medium">This workflow will:</p>
              <ol className="space-y-2 text-sm text-muted-foreground">
                {[
                  "Fetch all tablespace names from v$tablespace",
                  "Let you select the tablespace and size to extend",
                  "Query all datafiles for the selected tablespace",
                  "Use AI (Google Gemini) to generate the ALTER TABLESPACE SQL",
                  "Present the SQL for your review — edit if needed",
                  "Execute the approved SQL on the Oracle database"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 font-mono text-xs text-cyan-300">
                      {i + 1}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
            </div>
            <div className="space-y-2">
              <Label>Request Payload</Label>
              <pre className="keep-dark rounded-md border border-border/70 bg-black/40 p-4 text-xs leading-relaxed text-cyan-100">
                {JSON.stringify(
                  {
                    action: "datafile_extend",
                    db: selectedDb,
                    requested_by: username,
                    user_id: user?.userId,
                    environment: dbTarget?.env_label,
                    os: dbTarget?.os,
                    db_type: dbTarget?.db_type
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        );

      case "initiating":
        return (
          <WaitingAnimation
            message="Sending request to n8n..."
            subtext={`Triggering datafile extension workflow on ${selectedDb}`}
          />
        );

      case "polling_list":
        return (
          <WaitingAnimation
            message="Fetching tablespace list from Oracle..."
            subtext="n8n is running: SELECT DISTINCT NAME FROM V$TABLESPACE"
          />
        );

      case "selecting":
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Tablespace list received — {tablespaceList.length} tablespace
              {tablespaceList.length !== 1 ? "s" : ""} found on {selectedDb}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ts-select">
                  Tablespace <span className="text-red-300">*</span>
                </Label>
                <Select value={selectedTablespace} onValueChange={setSelectedTablespace}>
                  <SelectTrigger id="ts-select">
                    <SelectValue placeholder="Select tablespace..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tablespaceList.map((ts) => (
                      <SelectItem key={ts} value={ts}>
                        {ts}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="size-input">
                  Extension Size (GB) <span className="text-red-300">*</span>
                </Label>
                <Input
                  id="size-input"
                  type="number"
                  min={1}
                  step={1}
                  value={selectedSizeGb}
                  onChange={(e) => setSelectedSizeGb(Number(e.target.value))}
                  placeholder="10"
                />
              </div>
            </div>
          </div>
        );

      case "submitting":
        return (
          <WaitingAnimation
            message="Sending your selection to n8n..."
            subtext={`Extending ${selectedTablespace} by ${selectedSizeGb} GB`}
          />
        );

      case "polling_sql":
        return (
          <WaitingAnimation
            message={`Analyzing datafiles for ${selectedTablespace || "selected tablespace"}...`}
            subtext="n8n is querying DBA_DATA_FILES and generating ALTER TABLESPACE SQL with AI"
          />
        );

      case "reviewing":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
              <Code2 className="h-4 w-4 shrink-0" />
              AI-generated SQL is ready. Review and modify before approving.
            </div>
            <div className="space-y-2">
              <Label htmlFor="sql-editor">SQL Command</Label>
              <Textarea
                id="sql-editor"
                value={sqlDraft}
                onChange={(e) => setSqlDraft(e.target.value)}
                className="min-h-[150px] resize-y font-mono text-xs leading-relaxed text-cyan-50"
                spellCheck={false}
                placeholder="Generated SQL will appear here..."
              />
              <p className="text-xs text-muted-foreground">
                You can modify the SQL before approving. The final command will be executed directly
                on <span className="font-medium text-foreground">{selectedDb}</span>.
              </p>
            </div>
            {sqlExplanation ? (
              <div className="rounded-md border border-border/70 bg-secondary/30 p-3">
                <Label>AI explanation</Label>
                <p className="mt-2 text-sm leading-relaxed text-slate-100">{sqlExplanation}</p>
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
                    ["Database", selectedDb]
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
            {sqlTablespaceMetadata.length ? (
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
                      {sqlTablespaceMetadata.map((row, index) => (
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
          </div>
        );

      case "approving":
        return <WaitingAnimation message="Sending SQL decision to n8n..." />;

      case "polling_result":
        return (
          <WaitingAnimation
            message="Executing SQL on Oracle..."
            subtext={`Running ALTER TABLESPACE on ${selectedDb}`}
          />
        );

      case "success": {
        const dbResult =
          executionResult?.database_result != null
            ? typeof executionResult.database_result === "string"
              ? executionResult.database_result
              : JSON.stringify(executionResult.database_result, null, 2)
            : null;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-300" />
              <div>
                <p className="font-medium text-emerald-100">Tablespace Extended Successfully</p>
                <p className="mt-0.5 text-sm text-emerald-100/75">
                  {executionResult?.message || "The extension was applied to the Oracle database."}
                </p>
              </div>
            </div>
            {executionResult?.sql_command && (
              <div className="space-y-2">
                <Label>Executed SQL</Label>
                <pre className="keep-dark max-h-44 overflow-auto rounded-md border border-border/70 bg-black/40 p-3 font-mono text-xs text-cyan-50">
                  {executionResult.sql_command}
                </pre>
              </div>
            )}
            {dbResult && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <SquareTerminal className="h-4 w-4" />
                  Database Result
                </Label>
                <pre className="keep-dark max-h-32 overflow-auto rounded-md border border-border/70 bg-black/40 p-3 font-mono text-xs text-slate-100">
                  {dbResult}
                </pre>
              </div>
            )}
            {typeof executionResult?.sql_output === "string" && executionResult.sql_output && (
              <div className="space-y-2">
                <Label>SQL Output</Label>
                <pre className="keep-dark max-h-32 overflow-auto rounded-md border border-border/70 bg-black/40 p-3 font-mono text-xs text-slate-100">
                  {executionResult.sql_output}
                </pre>
              </div>
            )}
          </div>
        );
      }

      case "failed":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-400/30 bg-red-500/10 p-4">
              <XCircle className="h-6 w-6 shrink-0 text-red-300" />
              <div>
                <p className="font-medium text-red-100">Extension Failed</p>
                <p className="mt-0.5 text-sm text-red-100/75">
                  {executionResult?.message || "The Oracle execution encountered an error."}
                </p>
              </div>
            </div>
            {executionResult?.sql_command && (
              <div className="space-y-2">
                <Label>Attempted SQL</Label>
                <pre className="keep-dark max-h-44 overflow-auto rounded-md border border-border/70 bg-black/40 p-3 font-mono text-xs text-cyan-50">
                  {executionResult.sql_command}
                </pre>
              </div>
            )}
          </div>
        );

      case "rejected":
        return (
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 p-4">
            <XCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              SQL was rejected. The workflow has been cancelled. No changes were made to the
              database.
            </p>
          </div>
        );

      case "error":
        return (
          <div className="flex items-start gap-3 rounded-lg border border-red-400/30 bg-red-500/10 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-300 mt-0.5" />
            <p className="text-sm text-red-100">{errorMsg || "An unexpected error occurred."}</p>
          </div>
        );

      default:
        return null;
    }
  };

  const renderFooter = () => {
    const isTerminal =
      step === "success" || step === "failed" || step === "rejected" || step === "error";
    const isWaiting =
      step === "initiating" ||
      step === "polling_list" ||
      step === "submitting" ||
      step === "polling_sql" ||
      step === "approving" ||
      step === "polling_result";

    if (step === "idle") {
      return (
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleInitiate} disabled={loadingResume}>
            <Play className="h-4 w-4" />
            Initiate Workflow
          </Button>
        </>
      );
    }

    if (step === "selecting") {
      return (
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmitSelection}
            disabled={!selectedTablespace || selectedSizeGb <= 0}
          >
            Submit Selection
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      );
    }

    if (step === "reviewing") {
      return (
        <>
          <Button
            variant="ghost"
            onClick={() => handleSqlDecision("rejected")}
            disabled={Boolean(sqlDecisionLoading)}
          >
            {sqlDecisionLoading === "rejected" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Reject SQL
          </Button>
          <Button
            onClick={() => handleSqlDecision("approved")}
            disabled={Boolean(sqlDecisionLoading) || !sqlDraft.trim()}
          >
            {sqlDecisionLoading === "approved" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Approve &amp; Execute
          </Button>
        </>
      );
    }

    if (isTerminal) {
      return (
        <>
          {step === "error" && (
            <Button variant="outline" onClick={handleStartOver}>
              Start Over
            </Button>
          )}
          <Button onClick={handleClose}>Close</Button>
        </>
      );
    }

    if (isWaiting) {
      return (
        <Button variant="outline" onClick={handleClose}>
          Run in Background
        </Button>
      );
    }

    return null;
  };

  const isTerminalStep =
    step === "success" || step === "failed" || step === "rejected" || step === "error";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-5 w-5 text-cyan-200" />
            Datafile Extension Workflow
          </DialogTitle>
          <DialogDescription>
            AI-assisted tablespace extension via n8n on{" "}
            <span className="font-medium text-foreground">{selectedDb}</span>
          </DialogDescription>
        </DialogHeader>

        {!isTerminalStep && (
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <StepProgress step={step} />
          </div>
        )}

        <div className="min-h-[200px]">{renderContent()}</div>

        {errorMsg && step !== "error" && (
          <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            {errorMsg}
          </div>
        )}

        <DialogFooter>{renderFooter()}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DatafileExtendPanel ─────────────────────────────────────────────────────

function statusTone(status: AlertNotification["status"]) {
  if (status === "completed" || status === "approved") return "healthy" as const;
  if (status === "rejected" || status === "failed") return "critical" as const;
  return status;
}

function getWorkflowBadge(alert: AlertNotification): string | null {
  const meta = (alert.metadata || {}) as Record<string, unknown>;
  if (alert.status === "pending_approval" && meta.step === "tablespace_selection") {
    return "Awaiting Selection";
  }
  if (alert.status === "approved") {
    const approval = getSqlApproval(alert);
    if (approval?.status === "pending") return "SQL Review";
    return "Generating SQL";
  }
  return null;
}

export function DatafileExtendPanel() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const user = useAppStore((state) => state.user);
  const [modalOpen, setModalOpen] = useState(false);
  const [resumeAlertId, setResumeAlertId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, approved] = await Promise.all([
        fetchAlertNotifications({
          db: selectedDb,
          type: "datafile_extend",
          status: "pending_approval",
          limit: 10
        }),
        fetchAlertNotifications({
          db: selectedDb,
          type: "datafile_extend",
          status: "approved",
          limit: 10
        })
      ]);
      const all = [...pending.items, ...approved.items].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
      );
      setAlerts(all);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [selectedDb]);

  useEffect(() => {
    void loadAlerts();
    const interval = setInterval(() => void loadAlerts(), 30_000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  const openNew = () => {
    setResumeAlertId(null);
    setModalOpen(true);
  };

  const openResume = (id: string) => {
    setResumeAlertId(id);
    setModalOpen(true);
  };

  const handleClear = async (alertId: string) => {
    setClearingId(alertId);
    try {
      await updateAlertNotificationStatus(
        alertId,
        "acknowledged",
        "Cleared by DBA",
        user?.username
      );
      toast.success("Operation cleared");
      await loadAlerts();
    } catch {
      toast.error("Failed to clear operation");
    } finally {
      setClearingId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDriveDownload className="h-5 w-5 text-cyan-200" />
              AI-Assisted Datafile Extension
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => loadAlerts()} disabled={loading}>
                <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button size="sm" onClick={openNew}>
                <Play className="h-4 w-4" />
                Run Action
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Workflow description */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span>4-step n8n workflow:</span>
            {["Fetch Tablespaces", "Select + Size", "AI SQL Generation", "Review & Execute"].map(
              (label, i, arr) => (
                <span key={label} className="flex items-center gap-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 font-mono text-cyan-300">
                    {i + 1}
                  </span>
                  <span>{label}</span>
                  {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-border/60" />}
                </span>
              )
            )}
          </div>

          {/* Active / in-progress operations */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Active Operations</p>
              <div className="space-y-2">
                {alerts.map((alert) => {
                  const workflowBadge = getWorkflowBadge(alert);
                  const approval = getSqlApproval(alert);
                  const needsAction =
                    alert.status === "pending_approval" || approval?.status === "pending";
                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm",
                        needsAction
                          ? "border-cyan-400/30 bg-cyan-400/10"
                          : "border-border/60 bg-secondary/20"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-cyan-100">
                          {alert.id}
                        </span>
                        <StatusBadge status={statusTone(alert.status)}>
                          {alert.status.replace(/_/g, " ")}
                        </StatusBadge>
                        {workflowBadge && (
                          <StatusBadge status="pending_approval">{workflowBadge}</StatusBadge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(alert.created_at)} by {alert.created_by}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {needsAction && (
                          <Button variant="neon" size="sm" onClick={() => openResume(alert.id)}>
                            {approval?.status === "pending" ? (
                              <>
                                <Code2 className="h-3.5 w-3.5" />
                                Review SQL
                              </>
                            ) : (
                              <>
                                <Play className="h-3.5 w-3.5" />
                                Resume
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                          title="Clear this operation"
                          onClick={() => handleClear(alert.id)}
                          disabled={clearingId === alert.id}
                        >
                          {clearingId === alert.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && alerts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active datafile extension operations for {selectedDb}. Click{" "}
              <strong>Run Action</strong> to start a new workflow.
            </p>
          )}
        </CardContent>
      </Card>

      <DatafileExtendModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        resumeAlertId={resumeAlertId}
        onWorkflowComplete={() => void loadAlerts()}
      />
    </>
  );
}
