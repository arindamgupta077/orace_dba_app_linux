"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  critical: { label: "Critical", class: "bg-red-500/15 text-red-400 border-red-500/40" },
  high:     { label: "High",     class: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  medium:   { label: "Medium",   class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40" },
  low:      { label: "Low",      class: "bg-blue-500/15 text-blue-400 border-blue-500/40" }
};

const STATUS_CONFIG: Record<ApprovalRequestStatus, { label: string; icon: React.ElementType; class: string }> = {
  pending:   { label: "Pending",   icon: Clock,          class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40" },
  approved:  { label: "Approved",  icon: CheckCircle2,   class: "bg-green-500/15 text-green-400 border-green-500/40" },
  rejected:  { label: "Rejected",  icon: XCircle,        class: "bg-red-500/15 text-red-400 border-red-500/40" },
  expired:   { label: "Expired",   icon: AlertTriangle,  class: "bg-muted/30 text-muted-foreground border-border/50" },
  cancelled: { label: "Cancelled", icon: XCircle,        class: "bg-muted/30 text-muted-foreground border-border/50" }
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

function RiskBadge({ level }: { level: string }) {
  const cfg = RISK_CONFIG[level.toLowerCase()] ?? RISK_CONFIG.high;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

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

function HistoryTimeline({ events }: { events: ApprovalHistoryEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No history yet.</p>;
  return (
    <ol className="relative ml-3 border-l border-border/50">
      {events.map((ev) => (
        <li key={ev.history_id} className="mb-4 ml-5">
          <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-border bg-background" />
          <p className="text-sm font-medium text-foreground">
            {EVENT_LABELS[ev.event_type] ?? ev.event_type}
          </p>
          <p className="text-xs text-muted-foreground">
            {ev.actor_username} · {formatDate(ev.created_at)}
          </p>
          {ev.comment_text && (
            <p className="mt-1 rounded border border-border/50 bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
              {ev.comment_text}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function ParamsDisplay({ params }: { params?: Record<string, unknown> }) {
  if (!params || !Object.keys(params).length) {
    return <p className="text-xs text-muted-foreground">No parameters.</p>;
  }
  return (
    <dl className="space-y-1">
      {Object.entries(params).map(([k, v]) => (
        <div key={k} className="flex gap-2 text-xs">
          <dt className="shrink-0 font-medium text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</dt>
          <dd className="break-all text-foreground">{String(v)}</dd>
        </div>
      ))}
    </dl>
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

  useEffect(() => {
    if (!requestId) return;
    setLoading(true);
    setRequest(null);
    setHistory([]);
    setComment("");
    setShowHistory(false);

    fetchApprovalDetail(requestId)
      .then(({ request: r, history: h }) => {
        setRequest(r);
        setHistory(h);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load approval details.";
        toast.error("Load failed", { description: msg });
      })
      .finally(() => setLoading(false));
  }, [requestId]);

  const [executionResult, setExecutionResult] = useState<import("@/types/dba").DbaResponse | null>(null);

  const handleDecide = async (decision: "approved" | "rejected") => {
    if (!request) return;
    setDeciding(true);
    setExecutionResult(null);
    try {
      const res = await decideApproval(request.request_id, decision, comment || undefined);
      const updated = res.request;

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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-orange-400" />
            Approval Request
          </DialogTitle>
          <DialogDescription>
            Review the details below and approve or reject this request.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : request ? (
          <div className="space-y-4 text-sm">
            {/* Summary grid */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-muted/10 p-4">
              <div>
                <p className="text-xs text-muted-foreground">Action</p>
                <p className="font-semibold text-foreground">{request.display_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Database</p>
                <p className="font-semibold text-foreground">{request.db_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Environment</p>
                <Badge variant="destructive" className="text-xs">{request.environment}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Risk Level</p>
                <RiskBadge level={request.risk_level} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Requested by</p>
                <p className="font-medium text-foreground">{request.requester_username}</p>
                {request.requester_email && (
                  <p className="text-xs text-muted-foreground">{request.requester_email}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <StatusBadge status={request.request_status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Requested at</p>
                <p className="text-foreground">{formatDate(request.created_at)}</p>
              </div>
              {request.reviewed_at && (
                <div>
                  <p className="text-xs text-muted-foreground">Reviewed at</p>
                  <p className="text-foreground">{formatDate(request.reviewed_at)}</p>
                </div>
              )}
            </div>

            {/* Parameters */}
            {request.request_params && (
              <div className="rounded-lg border border-border/60 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parameters</p>
                <ParamsDisplay params={request.request_params} />
              </div>
            )}

            {/* Reviewer comment (if already decided) */}
            {request.reviewer_comment && (
              <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reviewer note — {request.reviewer_username}
                </p>
                <p className="text-foreground">{request.reviewer_comment}</p>
              </div>
            )}

            {/* Comment textarea for pending */}
            {isPending && (
              <div className="space-y-1.5">
                <Label htmlFor="approval-comment">Comment (optional)</Label>
                <Textarea
                  id="approval-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a note about your decision…"
                  rows={2}
                />
              </div>
            )}

            {/* n8n execution result */}
            {executionResult && (
              <div className="space-y-3 rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-cyan-400">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                  n8n Webhook Execution Output
                </div>
                {executionResult.ai_summary && (
                  <div className="rounded border border-cyan-500/20 bg-muted/20 p-2.5 text-xs text-foreground">
                    <p className="font-semibold text-cyan-300">AI Summary:</p>
                    <p className="mt-0.5">{executionResult.ai_summary}</p>
                  </div>
                )}
                {executionResult.raw_output && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Execution Response / Console Output:</p>
                    <pre className="max-h-48 overflow-y-auto rounded bg-black/60 p-2.5 font-mono text-xs text-cyan-300">
                      {executionResult.raw_output}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* History accordion */}
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/40"
            >
              <span>Approval timeline ({history.length} events)</span>
              {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showHistory && (
              <div className="rounded-lg border border-border/60 bg-muted/10 p-4">
                <HistoryTimeline events={history} />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Failed to load request details.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deciding}>
            Close
          </Button>
          {isPending && (
            <>
              <Button
                variant="destructive"
                onClick={() => void handleDecide("rejected")}
                disabled={deciding || loading}
              >
                {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
                Reject
              </Button>
              <Button
                onClick={() => void handleDecide("approved")}
                disabled={deciding || loading}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Approve
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
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [query, setQuery]           = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setLoading(true);
    try {
      const statusParam = statusFilter === "all" ? undefined : statusFilter;
      const { items: rows, total: t } = await fetchApprovalRequests({
        status: statusParam,
        limit:  100
      });
      setItems(rows);
      setTotal(t);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load approval requests.";
      toast.error("Load failed", { description: msg });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) =>
      [r.display_name, r.db_name, r.requester_username, r.environment]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, query]);

  const pendingCount  = items.filter((r) => r.request_status === "pending").length;
  const approvedCount = items.filter((r) => r.request_status === "approved").length;
  const rejectedCount = items.filter((r) => r.request_status === "rejected").length;

  const handleDecision = (updated: ApprovalRequest) => {
    setItems((prev) => prev.map((r) => (r.request_id === updated.request_id ? updated : r)));
    void load();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-orange-300">
            <ShieldAlert className="h-4 w-4" />
            Admin Panel
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Pending Approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and approve destructive DBA operations on production databases.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-yellow-500/20 bg-yellow-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-yellow-400">
              <Clock className="h-4 w-4" />
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-yellow-300">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">Awaiting review</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Approved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-green-300">{approvedCount}</div>
            <p className="text-xs text-muted-foreground">From current view</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-400">
              <XCircle className="h-4 w-4" />
              Rejected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-red-300">{rejectedCount}</div>
            <p className="text-xs text-muted-foreground">From current view</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>Approval Requests</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search action, database, user…"
                className="pl-9"
              />
            </div>
          </div>
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
                {filtered.map((req) => (
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
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      {loading ? "Loading…" : total === 0 ? "No approval requests found." : "No results match your search."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {total > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {filtered.length} of {total} total requests
            </p>
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
