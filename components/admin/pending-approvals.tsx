"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Database,
  Filter,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  decideApproval,
  fetchApprovalDetail,
  fetchApprovalRequests
} from "@/services/api";
import type { ApprovalHistoryEvent, ApprovalRequest, ApprovalRequestStatus } from "@/types/dba";
import { FormattedExecutionOutput, ParamsDisplay } from "./approval-execution-output";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function getNDaysAgoString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function formatDate(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function timeAgo(value?: string) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const RISK_CONFIG: Record<string, { label: string; class: string }> = {
  critical: { label: "Critical", class: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40" },
  high:     { label: "High",     class: "bg-orange-500/10 text-orange-700 border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/40" },
  medium:   { label: "Medium",   class: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40" },
  low:      { label: "Low",      class: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40" }
};

const STATUS_CONFIG: Record<ApprovalRequestStatus, { label: string; icon: React.ElementType; class: string }> = {
  pending:   { label: "Pending",   icon: Clock,          class: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40" },
  approved:  { label: "Approved",  icon: CheckCircle2,   class: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40" },
  rejected:  { label: "Rejected",  icon: XCircle,        class: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40" },
  expired:   { label: "Expired",   icon: AlertTriangle,  class: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700/60" },
  cancelled: { label: "Cancelled", icon: XCircle,        class: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700/60" }
};

const EVENT_LABELS: Record<string, string> = {
  requested:     "Request submitted",
  approved:      "Approved",
  rejected:      "Rejected",
  expired:       "Expired",
  cancelled:     "Cancelled",
  executing:     "Dispatching webhook…",
  executed:      "Webhook executed successfully",
  execute_failed:"Webhook execution failed"
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function EnvBadge({ env }: { env: string }) {
  const upper = env.toUpperCase();
  let colorClass = "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
  if (upper === "PROD" || upper === "PRODUCTION") {
    colorClass = "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40 font-bold";
  } else if (upper === "STAGE" || upper === "STAGING") {
    colorClass = "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40";
  } else if (upper === "DEV" || upper === "DEVELOPMENT") {
    colorClass = "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40";
  }
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono ${colorClass}`}>
      {env}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const cfg = RISK_CONFIG[level.toLowerCase()] ?? RISK_CONFIG.high;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: ApprovalRequestStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.class}`}>
      <Icon className="h-3 w-3 shrink-0" />
      {cfg.label}
    </span>
  );
}

function HistoryTimeline({ events }: { events: ApprovalHistoryEvent[] }) {
  if (!events.length) return <p className="text-xs text-muted-foreground italic">No timeline history recorded.</p>;
  return (
    <ol className="relative ml-3.5 border-l-2 border-slate-200 dark:border-slate-800 space-y-4">
      {events.map((ev) => {
        let dotColor = "bg-slate-400 border-slate-200 dark:bg-slate-600 dark:border-slate-800";
        if (ev.event_type === "approved" || ev.event_type === "executed") {
          dotColor = "bg-emerald-500 border-emerald-200 dark:border-emerald-900";
        } else if (ev.event_type === "rejected" || ev.event_type === "execute_failed") {
          dotColor = "bg-rose-500 border-rose-200 dark:border-rose-900";
        } else if (ev.event_type === "requested" || ev.event_type === "executing") {
          dotColor = "bg-amber-500 border-amber-200 dark:border-amber-900";
        }

        return (
          <li key={ev.history_id} className="relative pl-5">
            <span className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 ${dotColor}`} />
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                </p>
                <span className="text-[11px] text-muted-foreground font-mono">{formatDate(ev.created_at)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3 text-slate-400" />
                <span className="font-medium text-slate-700 dark:text-slate-300">{ev.actor_username}</span>
              </p>
              {ev.comment_text && (
                <p className="mt-1 rounded-md border border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60 p-2 text-xs text-slate-700 dark:text-slate-300 italic">
                  &quot;{ev.comment_text}&quot;
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Detail Dialog ─────────────────────────────────────────────────────────

interface DetailDialogProps {
  requestId: string | null;
  onClose: () => void;
  onDecision: (updatedRequest: ApprovalRequest) => void;
}

function DetailDialog({ requestId, onClose, onDecision }: DetailDialogProps) {
  const [loading, setLoading]   = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [request, setRequest]   = useState<ApprovalRequest | null>(null);
  const [history, setHistory]   = useState<ApprovalHistoryEvent[]>([]);
  const [comment, setComment]   = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [executionResult, setExecutionResult] = useState<import("@/types/dba").DbaResponse | null>(null);

  useEffect(() => {
    if (!requestId) return;
    setLoading(true);
    setRequest(null);
    setHistory([]);
    setComment("");
    setShowHistory(false);
    setExecutionResult(null);

    fetchApprovalDetail(requestId)
      .then(({ request: r, history: h }) => {
        setRequest(r);
        setHistory(h);

        // Extract execution details if request has executed history
        const executedEv = h.find((ev) => (ev.event_type === "executed" || ev.event_type === "approved") && ev.metadata);
        if (executedEv?.metadata) {
          const dbaResp = executedEv.metadata.dba_response as import("@/types/dba").DbaResponse | undefined;
          if (dbaResp) {
            setExecutionResult(dbaResp);
          } else {
            const rawOutput = (executedEv.metadata as Record<string, unknown>).raw_output ||
                              (executedEv.metadata as Record<string, unknown>).ai_summary;
            if (typeof rawOutput === "string") {
              setExecutionResult({
                status: "success",
                request_id: r.request_id,
                action: r.action_name as import("@/types/dba").DbaAction,
                db_status: "unknown",
                ai_summary: typeof executedEv.metadata.ai_summary === "string" ? executedEv.metadata.ai_summary : "Execution completed.",
                findings: [],
                recommendations: [],
                raw_data: {},
                raw_output: rawOutput
              });
            }
          }
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load approval details.";
        toast.error("Load failed", { description: msg });
      })
      .finally(() => setLoading(false));
  }, [requestId]);

  const handleDecide = async (decision: "approved" | "rejected") => {
    if (!request) return;
    setDeciding(true);
    setExecutionResult(null);
    try {
      const res = await decideApproval(request.request_id, decision, comment || undefined);
      const updated = res.request;

      // Update local request state so status changes from "pending" to "approved"/"rejected"
      // and Approve/Reject buttons disappear immediately.
      setRequest(updated);

      // Always refresh the parent list so the table reflects the new status,
      // even when the dialog stays open to display the n8n execution output.
      onDecision(updated);

      if (decision === "approved" && res.dbaResponse) {
        setExecutionResult(res.dbaResponse);
        toast.success("Request approved and executed successfully!", {
          description: `${request.display_name} on ${request.db_name}`
        });
        // Keep the dialog open so the admin can read the n8n output before closing.
      } else {
        toast.success(
          decision === "approved" ? "Request approved" : "Request rejected",
          { description: `${request.display_name} on ${request.db_name}` }
        );
        onClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Decision failed.";
      toast.error("Execution / Decision failed", { description: msg });
    } finally {
      setDeciding(false);
    }
  };

  const isPending = request?.request_status === "pending";

  return (
    <Dialog open={!!requestId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[88vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/20 shadow-2xs">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Approval Request
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                Review the details below and approve or reject this DBA operation.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-3 pr-1 text-sm">
          {loading ? (
            <div className="flex min-h-36 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
              Loading approval request details…
            </div>
          ) : request ? (
            <>
              {/* Summary Grid */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50 p-4 shadow-2xs space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-slate-400" /> Action
                    </p>
                    <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">{request.display_name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-slate-400" /> Database
                    </p>
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{request.db_name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5 text-slate-400" /> Environment
                    </p>
                    <div className="mt-0.5">
                      <EnvBadge env={request.environment} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <ShieldAlert className="h-3.5 w-3.5 text-slate-400" /> Risk Level
                    </p>
                    <div className="mt-0.5">
                      <RiskBadge level={request.risk_level} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-slate-400" /> Requested By
                    </p>
                    <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">{request.requester_username}</p>
                    {request.requester_email && (
                      <p className="text-[11px] text-muted-foreground">{request.requester_email}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-slate-400" /> Status
                    </p>
                    <div className="mt-0.5">
                      <StatusBadge status={request.request_status} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" /> Requested At
                    </p>
                    <p className="text-slate-900 dark:text-slate-100 mt-0.5 font-mono text-[11px]">{formatDate(request.created_at)}</p>
                  </div>
                  {request.reviewed_at && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" /> Reviewed At
                      </p>
                      <p className="text-slate-900 dark:text-slate-100 mt-0.5 font-mono text-[11px]">{formatDate(request.reviewed_at)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Parameters Display */}
              {request.request_params && Object.keys(request.request_params).filter((k) => !k.startsWith("_")).length > 0 && (
                <div className="rounded-xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60 p-3.5 shadow-2xs space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Parameters</p>
                  <ParamsDisplay params={request.request_params} />
                </div>
              )}

              {/* Reviewer Note */}
              {request.reviewer_comment && (
                <div className="rounded-xl border border-l-4 border-l-amber-500 border-slate-200/80 bg-amber-50/50 dark:border-slate-800 dark:bg-amber-950/20 p-3.5 shadow-2xs space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <MessageSquareQuote className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    Reviewer Note — {request.reviewer_username}
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium pl-5">
                    &quot;{request.reviewer_comment}&quot;
                  </p>
                </div>
              )}

              {/* Comment Textarea for Pending Status */}
              {isPending && (
                <div className="space-y-1.5">
                  <Label htmlFor="approval-comment" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Reviewer Comment (optional)
                  </Label>
                  <Textarea
                    id="approval-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add an optional note explaining your decision…"
                    rows={2}
                    className="text-xs rounded-lg border-slate-200 focus-visible:ring-amber-500 dark:border-slate-800 dark:bg-slate-900"
                  />
                </div>
              )}

              {/* n8n Webhook Execution Result */}
              {executionResult && (
                <div className="space-y-3 rounded-xl border border-cyan-500/30 bg-cyan-50/60 dark:border-cyan-800/60 dark:bg-cyan-950/25 p-4 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs font-bold text-cyan-900 dark:text-cyan-300 uppercase tracking-wide">
                    <CheckCircle2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                    n8n Webhook Execution Output
                  </div>
                  {executionResult.ai_summary && (
                    <div className="rounded-lg border border-cyan-200/80 bg-white dark:border-cyan-800/60 dark:bg-slate-900/80 p-3 text-xs shadow-2xs">
                      <p className="font-semibold text-cyan-900 dark:text-cyan-300">AI Summary:</p>
                      <p className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">{executionResult.ai_summary}</p>
                    </div>
                  )}
                  {executionResult.raw_output && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-cyan-900 dark:text-cyan-300">Execution Response / Console Output:</p>
                      <FormattedExecutionOutput rawOutput={executionResult.raw_output} action={request.action_name} />
                    </div>
                  )}
                </div>
              )}

              {/* History Accordion Timeline */}
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/40 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
              >
                <span>Approval Timeline ({history.length} events)</span>
                {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showHistory && (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50 p-4">
                  <HistoryTimeline events={history} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Failed to load request details.</p>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-slate-200/80 dark:border-slate-800 gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={deciding} className="text-xs font-medium">
            Close
          </Button>
          {isPending && (
            <>
              <Button
                variant="destructive"
                onClick={() => void handleDecide("rejected")}
                disabled={deciding || loading}
                className="bg-rose-600 hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500 text-white text-xs font-semibold gap-1.5 shadow-xs"
              >
                {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldX className="h-3.5 w-3.5" />}
                Reject Request
              </Button>
              <Button
                onClick={() => void handleDecide("approved")}
                disabled={deciding || loading}
                className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-semibold gap-1.5 shadow-xs"
              >
                {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Approve Request
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type StatusFilter = ApprovalRequestStatus | "all";

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending",   label: "Pending" },
  { value: "approved",  label: "Approved" },
  { value: "rejected",  label: "Rejected" },
  { value: "all",       label: "All" }
];

export function PendingApprovals() {
  const [items, setItems]           = useState<ApprovalRequest[]>([]);
  const [total, setTotal]           = useState(0);
  const [counts, setCounts]         = useState<{ pending: number; approved: number; rejected: number }>({
    pending: 0,
    approved: 0,
    rejected: 0
  });
  const [availableOptions, setAvailableOptions] = useState<{
    actions: string[];
    databases: string[];
    requesters: string[];
  }>({
    actions: [],
    databases: [],
    requesters: []
  });

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters]         = useState(false);
  const [statusFilter, setStatusFilter]       = useState<StatusFilter>("pending");
  const [actionFilter, setActionFilter]       = useState<string>("all");
  const [dbFilter, setDbFilter]               = useState<string>("all");
  const [requesterFilter, setRequesterFilter] = useState<string>("all");
  const [fromDate, setFromDate]               = useState<string>("");
  const [toDate, setToDate]                   = useState<string>("");
  const [query, setQuery]                     = useState("");
  const [debouncedQuery, setDebouncedQuery]   = useState("");
  const [page, setPage]                       = useState(1);
  const [pageSize, setPageSize]               = useState(10);
  const [selectedId, setSelectedId]           = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setLoading(true);
    try {
      const statusParam    = statusFilter === "all" ? undefined : statusFilter;
      const actionParam    = actionFilter === "all" ? undefined : actionFilter;
      const dbParam        = dbFilter === "all"     ? undefined : dbFilter;
      const requesterParam = requesterFilter === "all" ? undefined : requesterFilter;
      const searchParam    = debouncedQuery.trim()  || undefined;
      const offset         = (page - 1) * pageSize;

      const { items: rows, total: t, counts: summaryCounts, options: serverOptions } = await fetchApprovalRequests({
        status: statusParam,
        search: searchParam,
        action: actionParam,
        dbName: dbParam,
        requester: requesterParam,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit:  pageSize,
        offset
      });
      setItems(rows);
      setTotal(t);
      if (summaryCounts) {
        setCounts(summaryCounts);
      }
      if (serverOptions) {
        setAvailableOptions(serverOptions);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load approval requests.";
      toast.error("Load failed", { description: msg });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, actionFilter, dbFilter, requesterFilter, fromDate, toDate, debouncedQuery, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const handleStatusFilterChange = (v: StatusFilter) => {
    setStatusFilter(v);
    setPage(1);
  };

  const handleActionFilterChange = (v: string) => {
    setActionFilter(v);
    setPage(1);
  };

  const handleDbFilterChange = (v: string) => {
    setDbFilter(v);
    setPage(1);
  };

  const handleRequesterFilterChange = (v: string) => {
    setRequesterFilter(v);
    setPage(1);
  };

  const handlePageSizeChange = (val: string) => {
    const size = Number(val);
    setPageSize(size);
    setPage(1);
  };

  const setDatePreset = (preset: "all" | "today" | "7d" | "30d") => {
    const now = new Date();
    const toIso = (d: Date) => d.toISOString().split("T")[0];

    if (preset === "all") {
      setFromDate("");
      setToDate("");
    } else if (preset === "today") {
      const d = toIso(now);
      setFromDate(d);
      setToDate(d);
    } else if (preset === "7d") {
      const past = new Date(now);
      past.setDate(past.getDate() - 7);
      setFromDate(toIso(past));
      setToDate(toIso(now));
    } else if (preset === "30d") {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      setFromDate(toIso(past));
      setToDate(toIso(now));
    }
    setPage(1);
  };

  const activeFilterCount = [
    statusFilter !== "pending",
    actionFilter !== "all",
    dbFilter !== "all",
    requesterFilter !== "all",
    Boolean(fromDate),
    Boolean(toDate),
    Boolean(query.trim())
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  const handleResetFilters = () => {
    setStatusFilter("pending");
    setActionFilter("all");
    setDbFilter("all");
    setRequesterFilter("all");
    setFromDate("");
    setToDate("");
    setQuery("");
    setPage(1);
  };

  const handleDecision = (updated: ApprovalRequest) => {
    setItems((prev) => prev.map((r) => (r.request_id === updated.request_id ? updated : r)));
    void load();
  };

  return (
    <div className="space-y-5">
      {/* Compact Header & Stat Summary Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-card/60 p-3.5 backdrop-blur-xs">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            Admin Panel
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Pending Approvals</h1>
          <p className="text-xs text-muted-foreground">
            Review and approve destructive DBA operations on production databases.
          </p>
        </div>

        {/* Compact Stat Chips & Refresh Button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Pending Pill */}
          <button
            type="button"
            onClick={() => handleStatusFilterChange("pending")}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              statusFilter === "pending"
                ? "border-amber-500/50 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                : "border-amber-500/20 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10"
            }`}
            title="Filter by Pending"
          >
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            <span>Pending</span>
            <span className="ml-0.5 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300">
              {counts.pending}
            </span>
          </button>

          {/* Approved Pill */}
          <button
            type="button"
            onClick={() => handleStatusFilterChange("approved")}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              statusFilter === "approved"
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                : "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
            }`}
            title="Filter by Approved"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Approved</span>
            <span className="ml-0.5 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold text-emerald-300">
              {counts.approved}
            </span>
          </button>

          {/* Rejected Pill */}
          <button
            type="button"
            onClick={() => handleStatusFilterChange("rejected")}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              statusFilter === "rejected"
                ? "border-rose-500/50 bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30"
                : "border-rose-500/20 bg-rose-500/5 text-rose-400 hover:bg-rose-500/10"
            }`}
            title="Filter by Rejected"
          >
            <XCircle className="h-3.5 w-3.5 text-rose-400" />
            <span>Rejected</span>
            <span className="ml-0.5 rounded-md bg-rose-500/20 px-1.5 py-0.5 text-xs font-bold text-rose-300">
              {counts.rejected}
            </span>
          </button>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Table & Filters Card */}
      <Card>
        <CardHeader className="gap-3 border-b border-border/40 pb-3.5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                Approval Requests
              </CardTitle>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="text-[11px] bg-orange-500/15 text-orange-400 border-orange-500/30">
                  {activeFilterCount} Active {activeFilterCount === 1 ? "Filter" : "Filters"}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Search */}
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Quick search action, DB, user…"
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {/* Expand / Compress Filters Button */}
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowFilters((prev) => !prev)}
                className="h-8 gap-1.5 text-xs font-medium"
              >
                <Filter className="h-3.5 w-3.5 text-orange-400" />
                <span>{showFilters ? "Compress Filters" : "Filters"}</span>
                {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>

              {/* Reset Button */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  title="Reset all filters"
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* Expandable Filter Grid */}
          {showFilters && (
            <div className="mt-3 space-y-3 pt-3 border-t border-border/40 transition-all">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* Status Filter */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Status
                  </Label>
                  <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Action Filter */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" /> Action
                  </Label>
                  <Select value={actionFilter} onValueChange={handleActionFilterChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All Actions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Actions</SelectItem>
                      {availableOptions.actions.map((act) => (
                        <SelectItem key={act} value={act}>{act}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Database Filter */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" /> Database
                  </Label>
                  <Select value={dbFilter} onValueChange={handleDbFilterChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All Databases" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Databases</SelectItem>
                      {availableOptions.databases.map((db) => (
                        <SelectItem key={db} value={db}>{db}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Requested By Filter */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Requested by
                  </Label>
                  <Select value={requesterFilter} onValueChange={handleRequesterFilterChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All Requesters" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Requesters</SelectItem>
                      {availableOptions.requesters.map((user) => (
                        <SelectItem key={user} value={user}>{user}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Date Filters & Presets */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
                {/* From Date */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> From Date
                  </Label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                    className="h-8 text-xs"
                  />
                </div>

                {/* To Date */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> To Date
                  </Label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                    className="h-8 text-xs"
                  />
                </div>

                {/* Quick Date Presets */}
                <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                  <Label className="text-xs text-muted-foreground font-medium">Quick Date Presets</Label>
                  <div className="flex items-center gap-1 pt-0.5">
                    <Button
                      type="button"
                      variant={!fromDate && !toDate ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs flex-1"
                      onClick={() => setDatePreset("all")}
                    >
                      All
                    </Button>
                    <Button
                      type="button"
                      variant={fromDate === getTodayString() && toDate === getTodayString() ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs flex-1"
                      onClick={() => setDatePreset("today")}
                    >
                      Today
                    </Button>
                    <Button
                      type="button"
                      variant={fromDate === getNDaysAgoString(7) ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs flex-1"
                      onClick={() => setDatePreset("7d")}
                    >
                      7 Days
                    </Button>
                    <Button
                      type="button"
                      variant={fromDate === getNDaysAgoString(30) ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2 text-xs flex-1"
                      onClick={() => setDatePreset("30d")}
                    >
                      30 Days
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading requests…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Env</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((req) => (
                  <TableRow
                    key={req.request_id}
                    className="cursor-pointer hover:bg-secondary/30"
                    onClick={() => setSelectedId(req.request_id)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">{req.display_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{req.action_name}</div>
                    </TableCell>
                    <TableCell className="font-medium">{req.db_name}</TableCell>
                    <TableCell>
                      <Badge variant={req.environment === "PROD" ? "destructive" : "secondary"} className="text-xs">
                        {req.environment}
                      </Badge>
                    </TableCell>
                    <TableCell><RiskBadge level={req.risk_level} /></TableCell>
                    <TableCell>
                      <div className="text-sm text-foreground">{req.requester_username}</div>
                      {req.requester_email && (
                        <div className="text-xs text-muted-foreground">{req.requester_email}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" title={formatDate(req.created_at)}>
                      {timeAgo(req.created_at)}
                    </TableCell>
                    <TableCell><StatusBadge status={req.request_status} /></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(req.request_id)}
                        >
                          Review
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      {loading ? "Loading…" : total === 0 ? "No approval requests found." : "No results match your search."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* Pagination controls */}
          {total > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/40 pt-4 text-sm">
              <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                <span>
                  Showing <strong className="font-semibold text-foreground">{startRecord}</strong>–<strong className="font-semibold text-foreground">{endRecord}</strong> of <strong className="font-semibold text-foreground">{total}</strong> total requests
                </span>
                <span className="hidden sm:inline text-border">|</span>
                <div className="flex items-center gap-2">
                  <span>Per page:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={handlePageSizeChange}
                  >
                    <SelectTrigger className="h-8 w-[70px] text-xs">
                      <SelectValue placeholder={String(pageSize)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">
                  Page <strong className="text-foreground">{page}</strong> of <strong className="text-foreground">{totalPages}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    title="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {/* Page pills */}
                  {(() => {
                    const pages: (number | "…")[] = [];
                    if (totalPages <= 5) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (page > 3) pages.push("…");
                      const start = Math.max(2, page - 1);
                      const end = Math.min(totalPages - 1, page + 1);
                      for (let i = start; i <= end; i++) {
                        if (!pages.includes(i)) pages.push(i);
                      }
                      if (page < totalPages - 2) pages.push("…");
                      if (!pages.includes(totalPages)) pages.push(totalPages);
                    }

                    return pages.map((p, idx) =>
                      p === "…" ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground">
                          …
                        </span>
                      ) : (
                        <Button
                          key={p}
                          variant={page === p ? "default" : "outline"}
                          size="sm"
                          className="h-8 w-8 p-0 text-xs"
                          onClick={() => setPage(p)}
                          disabled={loading}
                        >
                          {p}
                        </Button>
                      )
                    );
                  })()}

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    title="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <DetailDialog
        requestId={selectedId}
        onClose={() => setSelectedId(null)}
        onDecision={handleDecision}
      />
    </div>
  );
}
