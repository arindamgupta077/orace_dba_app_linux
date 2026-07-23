"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  FileClock,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  ShieldAlert,
  User,
  XCircle
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApprovalDetail, fetchApprovalRequests } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { ApprovalHistoryEvent, ApprovalRequest, ApprovalRequestStatus } from "@/types/dba";
import { FormattedExecutionOutput, ParamsDisplay } from "@/components/admin/approval-execution-output";

function timeAgo(value?: string) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_CONFIG: Record<ApprovalRequestStatus, { label: string; icon: React.ElementType; class: string }> = {
  pending:   { label: "Pending Review", icon: Clock,          class: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40" },
  approved:  { label: "Approved",       icon: CheckCircle2,   class: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40" },
  rejected:  { label: "Rejected",       icon: XCircle,        class: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40" },
  expired:   { label: "Expired",        icon: AlertTriangle,  class: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700/60" },
  cancelled: { label: "Cancelled",      icon: XCircle,        class: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700/60" }
};

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
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-mono ${colorClass}`}>
      {env}
    </span>
  );
}

function RequestCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/70 p-4 shadow-2xs space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2 flex-1">
          <div className="flex items-center flex-wrap gap-2">
            <Skeleton className="h-4 w-36 rounded-md bg-slate-200/80 dark:bg-slate-800" />
            <Skeleton className="h-4 w-16 rounded-md bg-slate-200/80 dark:bg-slate-800" />
            <Skeleton className="h-4 w-12 rounded-md bg-slate-200/80 dark:bg-slate-800" />
          </div>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Skeleton className="h-3 w-3 rounded-full bg-slate-200/80 dark:bg-slate-800" />
            <Skeleton className="h-3 w-44 rounded-md bg-slate-200/80 dark:bg-slate-800" />
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <Skeleton className="h-6 w-24 rounded-full bg-slate-200/80 dark:bg-slate-800" />
          <Skeleton className="h-7 w-7 rounded-lg bg-slate-200/80 dark:bg-slate-800" />
        </div>
      </div>
    </div>
  );
}

function ApprovalRequestCard({ req }: { req: ApprovalRequest }) {
  const [expanded, setExpanded] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<ApprovalHistoryEvent[]>([]);
  const [executionOutput, setExecutionOutput] = useState<string | null>(null);

  const toggleExpand = async () => {
    if (!expanded && history.length === 0) {
      setLoadingHistory(true);
      try {
        const { history: h } = await fetchApprovalDetail(req.request_id);
        setHistory(h);
        
        // Find execution result from history if available
        const executedEv = h.find((ev) => ev.event_type === "executed" && ev.metadata);
        if (executedEv?.metadata) {
          const rawOutput = (executedEv.metadata as Record<string, unknown>).raw_output ||
                            (executedEv.metadata as Record<string, unknown>).ai_summary;
          if (typeof rawOutput === "string") setExecutionOutput(rawOutput);
        }
      } catch {
        // silent degrade
      } finally {
        setLoadingHistory(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/70 p-4 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all duration-200 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-2">
            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{req.display_name}</span>
            <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200/80 dark:border-slate-700">
              {req.db_name}
            </span>
            <EnvBadge env={req.environment} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <User className="h-3 w-3 text-slate-400" />
            Requested by <span className="font-semibold text-slate-700 dark:text-slate-300">{req.requester_username}</span> · <span className="font-mono text-[11px]">{timeAgo(req.created_at)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <StatusBadge status={req.request_status} />
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" onClick={toggleExpand}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-200/80 dark:border-slate-800 pt-3 text-xs">
          {req.reviewer_username && (
            <div className="rounded-lg border border-l-4 border-l-amber-500 border-slate-200/80 bg-amber-50/50 dark:border-slate-800 dark:bg-amber-950/20 p-3 shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 text-xs">
                <MessageSquareQuote className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Reviewer: {req.reviewer_username}
              </div>
              {req.reviewer_comment && (
                <p className="text-slate-700 dark:text-slate-300 pl-5 font-medium">
                  &quot;{req.reviewer_comment}&quot;
                </p>
              )}
            </div>
          )}

          {req.request_params && Object.keys(req.request_params).length > 0 && (
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50 p-3 shadow-2xs space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Parameters:</span>
              <ParamsDisplay params={req.request_params} />
            </div>
          )}

          {loadingHistory ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 py-1 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" /> Loading execution details…
            </div>
          ) : (
            executionOutput && (
              <div className="space-y-1.5 pt-1">
                <span className="font-bold text-xs text-cyan-900 dark:text-cyan-300 uppercase tracking-wide">n8n Execution Output:</span>
                <FormattedExecutionOutput rawOutput={executionOutput} action={req.action_name} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowStatusModal() {
  const user = useAppStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [hasUnreadUpdate, setHasUnreadUpdate] = useState(false);

  // The modal is mounted for every non-client user, but it is only meaningful
  // for dba_admin (requester-side status view). Skip all network activity and
  // event listeners for any other role so app_admin / auditor sessions don't
  // waste an SSE-triggered fetch on every broadcast.
  const isActiveRole = user?.role === "dba_admin";

  const loadRequests = useCallback(
    async (targetPage = page, targetFilter = filter, targetPageSize = pageSize) => {
      if (!isActiveRole) return;
      setLoading(true);
      try {
        const statusParam = targetFilter === "all" ? undefined : targetFilter;
        const offset = (targetPage - 1) * targetPageSize;
        const { items: data, total: totalCount } = await fetchApprovalRequests({
          status: statusParam,
          limit: targetPageSize,
          offset: offset
        });
        setItems(data);
        setTotal(totalCount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load approval status.";
        toast.error("Load failed", { description: msg });
      } finally {
        setLoading(false);
      }
    },
    [isActiveRole, page, filter, pageSize]
  );

  useEffect(() => {
    if (!isActiveRole) return;
    void loadRequests();

    function handleApprovalEvent(e: Event) {
      void loadRequests();
      const customEv = e as CustomEvent<{ title?: string; message?: string; replayed?: boolean }>;
      const detail = customEv.detail;
      // Ignore replayed historical events so toasts don't pop up on page reload
      if (!detail?.replayed) {
        if (detail?.title) {
          toast.info(detail.title, { description: detail.message });
        }
        setHasUnreadUpdate(true);
      }
    }

    window.addEventListener("dba-approval-update", handleApprovalEvent);
    return () => {
      window.removeEventListener("dba-approval-update", handleApprovalEvent);
    };
  }, [loadRequests, isActiveRole]);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setHasUnreadUpdate(false);
      setFilter("pending");
      setPage(1);
      void loadRequests(1, "pending", pageSize);
    }
  };

  const handleFilterChange = (newFilter: "all" | "pending" | "approved" | "rejected") => {
    setFilter(newFilter);
    setPage(1);
    void loadRequests(1, newFilter, pageSize);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void loadRequests(newPage, filter, pageSize);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
    void loadRequests(1, filter, newPageSize);
  };

  // ONLY render for dba_admin role users (app_admin must NOT see this button)
  if (!isActiveRole) {
    return null;
  }

  const pendingCount = items.filter((i) => i.request_status === "pending").length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Workflow Approval Status"
        >
          <FileClock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          {hasUnreadUpdate ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
          ) : pendingCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold leading-none text-white shadow-xs">
              {pendingCount}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl w-full h-[650px] max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/20 shadow-2xs">
              <FileClock className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Workflow Approval Status
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                View current status and execution output of approval-gated DBA operations.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Filter & Refresh Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 pb-3 pt-1 shrink-0">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
            {(["all", "pending", "approved", "rejected"] as const).map((st) => (
              <Button
                key={st}
                variant="ghost"
                size="sm"
                className={`h-7 px-3 text-xs font-semibold capitalize rounded-lg transition-all ${
                  filter === st
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-950 dark:text-slate-100 font-bold"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
                onClick={() => handleFilterChange(st)}
              >
                {st}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-lg border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            onClick={() => void loadRequests(page, filter, pageSize)}
            disabled={loading}
            title="Refresh list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-amber-600 dark:text-amber-400" : ""}`} />
          </Button>
        </div>

        {/* Request List */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-3 pr-1">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: pageSize || 5 }).map((_, i) => (
                <RequestCardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-6 text-center text-xs text-muted-foreground space-y-2">
              <ShieldAlert className="h-8 w-8 text-slate-400 dark:text-slate-600" />
              <p className="font-semibold text-slate-700 dark:text-slate-300 text-sm">No approval requests found</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-500">There are currently no requests matching the selected filter ({filter}).</p>
            </div>
          ) : (
            items.map((req) => <ApprovalRequestCard key={req.request_id} req={req} />)
          )}
        </div>

        {/* Pagination Footer */}
        {total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200/80 dark:border-slate-800 pt-3 text-xs">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-medium">
              <span>
                Showing <strong className="text-slate-900 dark:text-slate-100 font-semibold">{startRecord}</strong>–<strong className="text-slate-900 dark:text-slate-100 font-semibold">{endRecord}</strong> of <strong className="text-slate-900 dark:text-slate-100 font-semibold">{total}</strong> requests
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
              <div className="hidden sm:flex items-center gap-1.5">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-1.5 py-0.5 font-medium focus:outline-hidden"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                Page <strong className="text-slate-900 dark:text-slate-100">{page}</strong> of <strong className="text-slate-900 dark:text-slate-100">{totalPages}</strong>
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-lg border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || loading}
                  title="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-lg border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || loading}
                  title="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


