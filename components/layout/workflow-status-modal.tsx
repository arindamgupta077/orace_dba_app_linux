"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileClock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { fetchApprovalDetail, fetchApprovalRequests } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { ApprovalHistoryEvent, ApprovalRequest, ApprovalRequestStatus } from "@/types/dba";

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
  pending:   { label: "Pending Review", icon: Clock,          class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40" },
  approved:  { label: "Approved",       icon: CheckCircle2,   class: "bg-green-500/15 text-green-400 border-green-500/40" },
  rejected:  { label: "Rejected",       icon: XCircle,        class: "bg-red-500/15 text-red-400 border-red-500/40" },
  expired:   { label: "Expired",        icon: AlertTriangle,  class: "bg-muted/30 text-muted-foreground border-border/50" },
  cancelled: { label: "Cancelled",      icon: XCircle,        class: "bg-muted/30 text-muted-foreground border-border/50" }
};

function StatusBadge({ status }: { status: ApprovalRequestStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.class}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
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
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3.5 transition-all hover:border-border">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{req.display_name}</span>
            <Badge variant="outline" className="text-[10px] font-mono">{req.db_name}</Badge>
            <Badge variant={req.environment === "PROD" ? "destructive" : "secondary"} className="text-[10px]">
              {req.environment}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Requested by <span className="font-medium text-foreground">{req.requester_username}</span> · {timeAgo(req.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={req.request_status} />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleExpand}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-border/50 pt-3 text-xs">
          {req.reviewer_username && (
            <div className="rounded border border-border/50 bg-secondary/30 p-2">
              <span className="font-semibold text-foreground">Reviewer: </span>
              <span>{req.reviewer_username}</span>
              {req.reviewer_comment && (
                <p className="mt-1 text-muted-foreground">
                  <span className="font-semibold text-foreground">Comment: </span>
                  {req.reviewer_comment}
                </p>
              )}
            </div>
          )}

          {req.request_params && Object.keys(req.request_params).length > 0 && (
            <div>
              <span className="font-semibold text-muted-foreground">Parameters: </span>
              <span className="font-mono text-foreground">{JSON.stringify(req.request_params)}</span>
            </div>
          )}

          {loadingHistory ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading execution detail…
            </div>
          ) : (
            executionOutput && (
              <div className="space-y-1">
                <span className="font-semibold text-cyan-400">n8n Execution Output:</span>
                <pre className="max-h-36 overflow-y-auto rounded bg-black/60 p-2 font-mono text-[11px] text-cyan-300">
                  {executionOutput}
                </pre>
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
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [hasUnreadUpdate, setHasUnreadUpdate] = useState(false);

  // The modal is mounted for every non-client user, but it is only meaningful
  // for dba_admin (requester-side status view). Skip all network activity and
  // event listeners for any other role so app_admin / auditor sessions don't
  // waste an SSE-triggered fetch on every broadcast.
  const isActiveRole = user?.role === "dba_admin";

  const loadRequests = useCallback(async () => {
    if (!isActiveRole) return;
    setLoading(true);
    try {
      const statusParam = filter === "all" ? undefined : filter;
      const { items: data } = await fetchApprovalRequests({ status: statusParam, limit: 50 });
      setItems(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load approval status.";
      toast.error("Load failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [filter, isActiveRole]);

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
      void loadRequests();
    }
  };

  // ONLY render for dba_admin role users (app_admin must NOT see this button)
  if (!isActiveRole) {
    return null;
  }

  const pendingCount = items.filter((i) => i.request_status === "pending").length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative transition-all hover:bg-secondary"
          title="Workflow Approval Status"
        >
          <FileClock className="h-4 w-4 text-orange-400" />
          {hasUnreadUpdate ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
            </span>
          ) : pendingCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-orange-500 px-0.5 text-[10px] font-bold leading-none text-white shadow-[0_0_6px_rgba(249,115,22,0.6)]">
              {pendingCount}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-orange-400" />
            Workflow Approval Status
          </DialogTitle>
          <DialogDescription>
            View current status and execution output of approval-gated DBA operations.
          </DialogDescription>
        </DialogHeader>

        {/* Filter & Refresh Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex gap-1.5">
            {(["all", "pending", "approved", "rejected"] as const).map((st) => (
              <Button
                key={st}
                variant={filter === st ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs capitalize"
                onClick={() => setFilter(st)}
              >
                {st}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void loadRequests()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Request List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 py-2">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading approval status…
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center text-xs text-muted-foreground">
              <ShieldAlert className="mb-2 h-6 w-6 text-muted-foreground/50" />
              No approval requests found.
            </div>
          ) : (
            items.map((req) => <ApprovalRequestCard key={req.request_id} req={req} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
