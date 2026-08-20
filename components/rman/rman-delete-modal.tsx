"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArchiveX,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Flame,
  Loader2,
  ShieldAlert,
  Terminal,
  Trash2,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useDbaAction } from "@/hooks/use-dba-action";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

export type RmanDeleteMode = "archivelog" | "backup";

interface RmanDeleteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: RmanDeleteMode;
  initialMode?: RmanDeleteMode;
}

const PRESET_DAYS = [3, 7, 14, 30, 60];

export function RmanDeleteModal({
  open,
  onOpenChange,
  mode = "archivelog",
  initialMode
}: RmanDeleteModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [currentMode, setCurrentMode] = useState<RmanDeleteMode>(mode || initialMode || "archivelog");
  const [daysInput, setDaysInput] = useState<string>("7");
  const [copied, setCopied] = useState(false);

  const { runAction, status, response, error, reset } = useDbaAction();

  // Reset modal state on open or mode prop change
  useEffect(() => {
    if (open) {
      setCurrentMode(mode || initialMode || "archivelog");
      setDaysInput("7");
      setCopied(false);
      reset();
    }
  }, [open, mode, initialMode, reset]);

  const parsedDays = parseInt(daysInput, 10);
  const isDaysValid = !isNaN(parsedDays) && parsedDays >= 3;
  const validationError =
    isNaN(parsedDays)
      ? "Please enter a valid number of days."
      : parsedDays < 3
        ? "Retention period must be at least 3 days to prevent loss of recent recovery data."
        : null;

  const currentAction = currentMode === "archivelog" ? "delete_archivelog" : "delete_backup";

  // Dynamic RMAN Script Preview
  const rmanScript = useMemo(() => {
    const n = isDaysValid ? parsedDays : "N";
    if (currentMode === "archivelog") {
      return `CROSSCHECK ARCHIVELOG ALL;
DELETE NOPROMPT EXPIRED ARCHIVELOG ALL;
DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE 'SYSDATE-${n}';`;
    }
    return `CROSSCHECK BACKUP;
CROSSCHECK COPY;
DELETE NOPROMPT EXPIRED COPY;
DELETE NOPROMPT EXPIRED BACKUP;
DELETE NOPROMPT BACKUP COMPLETED BEFORE 'SYSDATE-${n}';`;
  }, [currentMode, isDaysValid, parsedDays]);

  const handleSubmit = async () => {
    if (!isDaysValid) return;
    try {
      await runAction(
        currentAction,
        {
          days: parsedDays,
          day: parsedDays
        },
        selectedDb
      );
    } catch {
      // Handled in useDbaAction hook & toast
    }
  };

  const handleCopyOutput = () => {
    const textToCopy = response?.raw_output || error || "";
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    toast.success("RMAN log copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const isArchivelog = currentMode === "archivelog";
  const title = isArchivelog ? "Delete Old Archivelog" : "Delete Old Backup";
  const desc = isArchivelog
    ? "Crosscheck and delete expired archive logs, and delete archive logs completed before SYSDATE - N days."
    : "Crosscheck and delete expired backups and copies, and delete backups completed before SYSDATE - N days.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "rounded-xl border p-2.5 shadow-sm transition-all duration-300",
                isArchivelog
                  ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
              )}
            >
              {isArchivelog ? (
                <Flame className="h-5 w-5" />
              ) : (
                <Trash2 className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-semibold tracking-tight">
                  {title}
                </DialogTitle>
                <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-xs font-mono font-medium text-cyan-700 dark:text-cyan-300">
                  <Database className="h-3 w-3" />
                  {selectedDb}
                </span>
              </div>
              <DialogDescription className="text-xs leading-relaxed text-muted-foreground mt-0.5">
                {desc}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* ── Mode Switcher at the Modal ────────────────────────────── */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select Deletion Target
            </Label>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 bg-muted/30 p-1.5">
              <button
                type="button"
                id="btn-select-mode-archivelog"
                onClick={() => {
                  setCurrentMode("archivelog");
                  if (status !== "idle") reset();
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all duration-200",
                  isArchivelog
                    ? "border border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300 shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                <Flame className={cn("h-4 w-4", isArchivelog ? "text-red-500" : "text-muted-foreground")} />
                <span>Delete Old Archivelog</span>
              </button>

              <button
                type="button"
                id="btn-select-mode-backup"
                onClick={() => {
                  setCurrentMode("backup");
                  if (status !== "idle") reset();
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all duration-200",
                  !isArchivelog
                    ? "border border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300 shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                <Trash2 className={cn("h-4 w-4", !isArchivelog ? "text-rose-500" : "text-muted-foreground")} />
                <span>Delete Old Backup</span>
              </button>
            </div>
          </div>

          {/* ── Parameters Form ────────────────────────────────────────── */}
          <div className="space-y-4 pt-1">
            {/* Day Threshold Input */}
            <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-3.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="input-delete-days" className="text-xs font-semibold">
                  Before how many days the {isArchivelog ? "archivelog" : "RMAN backup"} should be deleted:
                </Label>
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono text-amber-700 dark:text-amber-300 border border-amber-500/20">
                  SYSDATE - {isDaysValid ? parsedDays : "N"}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="input-delete-days"
                    type="number"
                    min={3}
                    step={1}
                    value={daysInput}
                    onChange={(e) => {
                      setDaysInput(e.target.value);
                      if (status !== "idle") reset();
                    }}
                    placeholder="e.g. 7 (min 3)"
                    className={cn(
                      "pl-9 font-mono text-sm",
                      !isDaysValid && "border-red-500 focus-visible:ring-red-500"
                    )}
                  />
                </div>
              </div>

              {/* Preset Day Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">Quick Presets:</span>
                {PRESET_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDaysInput(String(d));
                      if (status !== "idle") reset();
                    }}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      parsedDays === d
                        ? "border-primary/50 bg-primary/10 text-primary font-semibold"
                        : "border-border/60 bg-background/50 hover:bg-muted text-muted-foreground"
                    )}
                  >
                    {d} Days
                  </button>
                ))}
              </div>

              {/* Validation Error */}
              {validationError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>

            {/* RMAN Script Execution Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  RMAN Commands Executed via SSH ({currentAction})
                </Label>
                <span className="text-[10px] text-muted-foreground font-mono">
                  Target: {selectedDb}
                </span>
              </div>
              <div className="relative rounded-xl border border-border/80 bg-zinc-950 p-3.5 font-mono text-xs text-emerald-400 shadow-inner">
                <pre className="overflow-x-auto whitespace-pre leading-relaxed">
                  {rmanScript}
                </pre>
              </div>
            </div>

            {/* Destructive Warning Alert */}
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">Destructive Maintenance Operation</p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-normal">
                  This will run <code className="font-mono">DELETE NOPROMPT</code> via RMAN on database <strong>{selectedDb}</strong>. Expired items and objects completed before {isDaysValid ? `${parsedDays} days ago` : "the specified date"} will be permanently purged.
                </p>
              </div>
            </div>
          </div>

          {/* ── Live Execution & Response Terminal ──────────────────────── */}
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">Executing RMAN Maintenance</p>
                <p className="text-xs text-muted-foreground">
                  Connecting to {selectedDb} via SSH node and running RMAN {currentMode} deletion script...
                </p>
              </div>
            </div>
          )}

          {(response || error) && status !== "loading" && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {status === "success" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      Execution Completed
                    </span>
                  ) : status === "pending_approval" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      Pending Approval
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                      Execution Failed
                    </span>
                  )}
                  {response?.request_id && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      ID: {response.request_id}
                    </span>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyOutput}
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "Copied" : "Copy Output"}
                </Button>
              </div>

              {response?.ai_summary && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-foreground">
                  <span className="font-semibold text-primary">Summary: </span>
                  {response.ai_summary}
                </div>
              )}

              {/* Terminal Monospace Log Viewer */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 font-mono text-xs text-zinc-200 shadow-inner">
                <div className="mb-2 flex items-center justify-between border-b border-zinc-800 pb-1.5 text-[11px] text-zinc-400">
                  <span>RMAN Console Output</span>
                  <span>{selectedDb}</span>
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap leading-relaxed text-emerald-400">
                  {response?.raw_output || error || "No output returned."}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* ── Dialog Footer ───────────────────────────────────────────── */}
        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            {response || error ? "Close" : "Cancel"}
          </Button>

          {response || error ? (
            <Button
              variant="secondary"
              onClick={reset}
              className="text-xs gap-1.5"
            >
              Reset & Run Again
            </Button>
          ) : (
            <Button
              id="btn-submit-rman-delete"
              onClick={handleSubmit}
              disabled={!isDaysValid || status === "loading"}
              className={cn(
                "text-xs font-semibold gap-2 shadow-sm text-white",
                isArchivelog
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-rose-600 hover:bg-rose-700"
              )}
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Submit {isArchivelog ? "Archivelog" : "Backup"} Deletion
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
