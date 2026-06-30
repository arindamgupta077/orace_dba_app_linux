"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  LogIn,
  LogOut,
  RefreshCw,
  Send,
  ShieldAlert,
  UserCheck,
  Users
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeHandover,
  fetchCurrentShift,
  overrideHandoverApi,
  shiftLogin,
  shiftLogout,
  submitHandover
} from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { CurrentShiftState, ShiftSession } from "@/types/dba";

const GENERAL_SHIFT_NUMBER = 4;
const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (07:00 - 15:30)",
  2: "Shift 2 (14:30 - 23:00)",
  3: "Shift 3 (22:30 - 07:00)",
  4: "General Shift"
};

const REFRESH_INTERVAL_MS = 30_000;

function handoverBadge(session: ShiftSession | null | undefined) {
  if (!session) return <Badge variant="outline" className="text-muted-foreground">None</Badge>;
  if (session.handover_status === "ACKNOWLEDGED") {
    return (
      <Badge className="border-green-500/30 bg-green-500/10 text-green-300">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Acknowledged
      </Badge>
    );
  }
  if (session.handover_status === "PENDING") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
        <Clock className="mr-1 h-3 w-3" />
        Pending
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-muted-foreground">None</Badge>;
}

export function ShiftManagementSection() {
  const user = useAppStore((s) => s.user);
  const [state, setState] = useState<CurrentShiftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [handoverText, setHandoverText] = useState("");
  const [shiftChoice, setShiftChoice] = useState<string>("");
  const [overrideTarget, setOverrideTarget] = useState<ShiftSession | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [viewHandover, setViewHandover] = useState<ShiftSession | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchCurrentShift();
      setState(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load shift state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const sessions = (state?.sessions ?? []).filter(Boolean);
  const mySession = sessions.find((s) => s?.username === user?.username) || null;

  // Auto-select the preferred shift in the dropdown when not logged in.
  useEffect(() => {
    if (!state || mySession) return;
    const preferred = state.preferred_shift ?? GENERAL_SHIFT_NUMBER;
    if (preferred === GENERAL_SHIFT_NUMBER || !state.taken_shifts?.includes(preferred)) {
      setShiftChoice(String(preferred));
    } else {
      const fallback = state.selectable_shifts?.find(
        (n) => n !== GENERAL_SHIFT_NUMBER && !state.taken_shifts?.includes(n)
      );
      setShiftChoice(String(fallback ?? GENERAL_SHIFT_NUMBER));
    }
  }, [state, mySession]);
  const isAdmin = user?.role === "app_admin";
  const canManageShift = user?.role === "app_admin" || user?.role === "dba_admin";
  const isMySessionGeneral = mySession ? mySession.shift_number === GENERAL_SHIFT_NUMBER : false;
  const myHandoverAcknowledged = mySession?.handover_status === "ACKNOWLEDGED";
  // General shift can logout without handover acknowledgement.
  const canLogout = isMySessionGeneral || myHandoverAcknowledged;

  const handleLogin = async () => {
    const shiftNumber = Number(shiftChoice) || (state?.preferred_shift ?? GENERAL_SHIFT_NUMBER);
    setActionLoading(true);
    try {
      await shiftLogin(shiftNumber);
      toast.success(`Logged in to ${SHIFT_LABELS[shiftNumber] || `Shift ${shiftNumber}`}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    setActionLoading(true);
    try {
      await shiftLogout();
      toast.success("Logged out from shift.");
      await load();
      setLogoutConfirm(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logout failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitHandover = async () => {
    if (!handoverText.trim()) {
      toast.error("Handover text cannot be empty.");
      return;
    }
    setActionLoading(true);
    try {
      await submitHandover(handoverText.trim());
      toast.success("Handover submitted. Waiting for acknowledgement.");
      setHandoverText("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit handover.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcknowledge = async (session: ShiftSession) => {
    if (!session.handover_id) {
      toast.error("No pending handover for this session.");
      return;
    }
    setActionLoading(true);
    try {
      await acknowledgeHandover(session.handover_id);
      toast.success(`Acknowledged ${session.username}'s handover.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to acknowledge.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOverride = async () => {
    if (!overrideTarget?.handover_id || !overrideReason.trim()) {
      toast.error("A pending handover and reason are required for an override.");
      return;
    }
    setActionLoading(true);
    try {
      await overrideHandoverApi(overrideTarget.handover_id, overrideReason.trim(), true, overrideTarget.session_id);
      toast.success("Handover override completed. Session closed.");
      setOverrideTarget(null);
      setOverrideReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Override failed.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Unable to load shift data.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Shift Panel — visible to ALL roles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-cyan-400" />
            Current Shift
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={actionLoading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Badge
              className={cn(
                "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
                state.overlap && "border-amber-500/30 bg-amber-500/10 text-amber-300"
              )}
            >
              {state.shift_label}
            </Badge>
            {state.overlap && (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                Overlap window
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Server time: {new Date(state.server_time).toLocaleString()}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Users className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No DBA is currently on shift.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DBA</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Login Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Handover</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.session_id}>
                    <TableCell className="font-medium">
                      {session.username}
                      {session.username === user?.username && (
                        <span className="ml-2 text-xs text-cyan-400">(You)</span>
                      )}
                    </TableCell>
                    <TableCell>Shift {session.shift_number}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(session.login_at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Badge className="border-green-500/30 bg-green-500/10 text-green-300">Active</Badge>
                    </TableCell>
                    <TableCell>{handoverBadge(session)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {session.handover_text && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewHandover(session)}
                            title="View handover"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canManageShift &&
                          session.username !== user?.username &&
                          session.handover_status === "PENDING" &&
                          session.handover_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleAcknowledge(session)}
                              disabled={actionLoading}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Acknowledge
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Action Panel — only for dba_admin and app_admin */}
      {canManageShift ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LogIn className="h-5 w-5 text-cyan-400" />
              Shift Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!mySession ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Select Shift</Label>
                    <Select value={shiftChoice} onValueChange={setShiftChoice}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder="Choose shift" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, GENERAL_SHIFT_NUMBER].map((n) => {
                          const isDisabledByBuffer = state.disabled_shifts?.includes(n);
                          const isTaken = state.taken_shifts?.includes(n);
                          const takenByDba = sessions.find((s) => s.shift_number === n && s.is_active);
                          const isGeneral = n === GENERAL_SHIFT_NUMBER;
                          const disabled = (!isGeneral && (isDisabledByBuffer || isTaken));
                          let suffix = "";
                          if (isTaken && takenByDba) suffix = ` (taken by ${takenByDba.username})`;
                          else if (isDisabledByBuffer) suffix = " (not yet available)";
                          return (
                            <SelectItem
                              key={n}
                              value={String(n)}
                              disabled={disabled}
                            >
                              {SHIFT_LABELS[n] || `Shift ${n}`}{suffix}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => void handleLogin()}
                    disabled={actionLoading || (() => {
                      const chosen = Number(shiftChoice);
                      if (chosen === GENERAL_SHIFT_NUMBER) return false;
                      return state.taken_shifts?.includes(chosen) || state.disabled_shifts?.includes(chosen);
                    })()}
                  >
                    {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    Login to Shift
                  </Button>
                </div>
                {state.taken_shifts && state.taken_shifts.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    {state.taken_shifts.map((n) => `Shift ${n}`).join(", ")} already taken — choose another shift or General Shift.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                  <CheckCircle2 className="h-4 w-4" />
                  You are logged in to {SHIFT_LABELS[mySession.shift_number] || `Shift ${mySession.shift_number}`}.
                </div>

                {/* Existing handover display — not shown for General Shift */}
                {mySession.handover_text && !isMySessionGeneral && (
                  <div className="rounded-md border border-border/70 bg-background/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        Your handover
                      </span>
                      {handoverBadge(mySession)}
                    </div>
                    <div className="prose prose-sm prose-invert max-w-none text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {mySession.handover_text}
                      </ReactMarkdown>
                    </div>
                    {mySession.ack_username && (
                      <p className="mt-2 text-xs text-green-400">
                        Acknowledged by {mySession.ack_username}
                        {mySession.ack_at && ` at ${new Date(mySession.ack_at).toLocaleString()}`}
                      </p>
                    )}
                  </div>
                )}

                {/* Handover text area — only for time-based shifts with no handover yet */}
                {mySession.handover_status === "NONE" && !isMySessionGeneral && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      Handover Notes
                      <span className="text-xs text-muted-foreground">(Markdown supported)</span>
                    </Label>
                    <Textarea
                      value={handoverText}
                      onChange={(e) => setHandoverText(e.target.value)}
                      placeholder="Write your handover notes for the next shift DBA..."
                      className="min-h-[120px] font-mono text-sm"
                      disabled={actionLoading}
                    />
                    <Button
                      size="sm"
                      onClick={() => void handleSubmitHandover()}
                      disabled={actionLoading || !handoverText.trim()}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Submit Handover
                    </Button>
                  </div>
                )}

                {/* General Shift — no handover needed notice */}
                {isMySessionGeneral && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    General Shift does not require a handover. You can logout directly.
                  </p>
                )}

                {/* Logout */}
                <div className="flex items-center gap-3 border-t border-border/70 pt-4">
                  <Button
                    variant="destructive"
                    onClick={() => setLogoutConfirm(true)}
                    disabled={actionLoading || !canLogout}
                    title={!canLogout ? "Your handover must be acknowledged before logout" : undefined}
                  >
                    <LogOut className="h-4 w-4" />
                    Logout from Shift
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {isMySessionGeneral
                      ? "General Shift — no handover required. You can logout anytime."
                      : canLogout
                        ? "Your handover has been acknowledged. You can safely logout."
                        : "Logout is disabled until your handover is acknowledged by another DBA."}
                  </p>
                </div>
              </div>
            )}

            {/* Admin override section */}
            {isAdmin && sessions.length > 0 && (
              <div className="space-y-2 border-t border-border/70 pt-4">
                <Label className="flex items-center gap-2 text-amber-400">
                  <ShieldAlert className="h-4 w-4" />
                  Admin Override
                </Label>
                <p className="text-xs text-muted-foreground">
                  Force-acknowledge a pending handover and close a session when a DBA needs to leave
                  but no other DBA is available to acknowledge.
                </p>
                <div className="space-y-1.5">
                  {sessions
                    .filter((s) => s.username !== user?.username && s.handover_status === "PENDING")
                    .map((session) => (
                      <div key={session.session_id} className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
                        <span className="text-sm">
                          {session.username} (Shift {session.shift_number}) — pending handover
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                          onClick={() => setOverrideTarget(session)}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Override & Close
                        </Button>
                      </div>
                    ))}
                  {sessions.filter((s) => s.username !== user?.username && s.handover_status === "PENDING").length === 0 && (
                    <p className="text-xs text-muted-foreground">No pending handovers to override.</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            You have read-only access to the shift board.
          </CardContent>
        </Card>
      )}

      {/* Logout confirmation dialog */}
      <Dialog open={logoutConfirm} onOpenChange={setLogoutConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to logout from your shift? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogoutConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleLogout()} disabled={actionLoading}>
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override confirmation dialog */}
      <Dialog open={!!overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="h-5 w-5" />
              Admin Override
            </DialogTitle>
            <DialogDescription>
              You are about to force-acknowledge the handover for{" "}
              <strong>{overrideTarget?.username}</strong> and close their session. This will be
              recorded in the audit log with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Explain why this override is necessary..."
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => void handleOverride()}
              disabled={actionLoading || !overrideReason.trim()}
            >
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              Force Acknowledge & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View handover dialog */}
      <Dialog open={!!viewHandover} onOpenChange={(open) => !open && setViewHandover(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Handover from {viewHandover?.username}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {viewHandover && (
                  <>
                    Shift {viewHandover.shift_number} — {handoverBadge(viewHandover)}
                    {viewHandover.ack_username && ` — Acknowledged by ${viewHandover.ack_username}`}
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto rounded-md border border-border/70 bg-background/40 p-4">
            <div className="prose prose-sm prose-invert max-w-none text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {viewHandover?.handover_text || ""}
              </ReactMarkdown>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
