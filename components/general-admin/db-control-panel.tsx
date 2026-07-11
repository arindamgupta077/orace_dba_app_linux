"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Play,
  StopCircle
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ConsoleOutput } from "@/components/general-admin/console-output";
import { executeDBAAction } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { DbaAction } from "@/types/dba";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionCard {
  action: DbaAction;
  label: string;
  description: string;
  icon: React.ElementType;
  colorClass: string;
  glowClass: string;
  destructive?: boolean;
}

interface RunState {
  status: "idle" | "loading" | "success" | "error";
  output: string | null;
  timestamp: string | null;
  action: DbaAction | null;
}

// ─── Static action cards (all except mount_database) ─────────────────────────

const DB_ACTIONS: ActionCard[] = [
  {
    action: "status_database",
    label: "Check Status",
    description: "Query current instance status (OPEN / MOUNTED / STARTED)",
    icon: Activity,
    colorClass: "from-cyan-500 to-blue-600",
    glowClass: "shadow-[0_0_18px_rgba(6,182,212,0.35)]"
  },
  {
    action: "start_database",
    label: "Start Database",
    description: "Execute STARTUP — bring the database to OPEN mode",
    icon: Play,
    colorClass: "from-emerald-500 to-teal-600",
    glowClass: "shadow-[0_0_18px_rgba(16,185,129,0.35)]",
    destructive: true
  },
  {
    action: "stop_database",
    label: "Stop Database",
    description: "Execute SHUTDOWN IMMEDIATE — graceful instance shutdown",
    icon: StopCircle,
    colorClass: "from-red-500 to-rose-600",
    glowClass: "shadow-[0_0_18px_rgba(239,68,68,0.35)]",
    destructive: true
  }
];

const SHUTDOWN_OPTIONS = [
  {
    value: "IMMEDIATE",
    label: "SHUTDOWN IMMEDIATE;",
    description: "Gracefully terminates active transactions and shuts down."
  },
  {
    value: "TRANSACTIONAL",
    label: "SHUTDOWN TRANSACTIONAL;",
    description: "Waits for active transactions to complete before shutting down."
  },
  {
    value: "ABORT",
    label: "SHUTDOWN ABORT;",
    description: "Instantly terminates all processes (requires recovery on startup)."
  }
];

// ─── Main component ───────────────────────────────────────────────────────────

export function DbControlPanel() {
  const selectedDb = useAppStore((s) => s.selectedDb);

  const [runState, setRunState] = useState<RunState>({
    status: "idle",
    output: null,
    timestamp: null,
    action: null
  });

  // Generic destructive confirm (Start / Stop)
  const [confirmAction, setConfirmAction] = useState<ActionCard | null>(null);

  // Selected shutdown option
  const [selectedShutdownOption, setSelectedShutdownOption] = useState<string>("IMMEDIATE");

  // Loading tracker for all buttons
  const [loading, setLoading] = useState<DbaAction | null>(null);

  // Mount-Database confirmation
  const [mountConfirmOpen, setMountConfirmOpen] = useState(false);

  // ── Generic execute helper ─────────────────────────────────────────────────

  const execute = async (action: DbaAction, params: Record<string, unknown> = {}) => {
    if (!selectedDb) return;
    setLoading(action);
    setRunState({ status: "loading", output: null, timestamp: null, action });
    try {
      const result = await executeDBAAction(action, selectedDb, params);
      setRunState({
        status: result.status === "error" ? "error" : "success",
        output: result.raw_output || result.ai_summary || "(no output)",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action
      });
      return result;
    } catch (err) {
      setRunState({
        status: "error",
        output: err instanceof Error ? err.message : "Unknown error occurred.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action
      });
      return null;
    } finally {
      setLoading(null);
    }
  };

  // ── Generic card click handler ─────────────────────────────────────────────

  const handleClick = (card: ActionCard) => {
    if (card.destructive) {
      setConfirmAction(card);
    } else {
      void execute(card.action);
    }
  };

  const handleConfirm = () => {
    if (confirmAction) {
      const params = confirmAction.action === "stop_database"
        ? { shutdown_option: selectedShutdownOption }
        : {};
      void execute(confirmAction.action, params);
      setConfirmAction(null);
    }
  };

  // ── Mount Database Execute ──────────────────────────────────────────────────

  const handleMountConfirm = async () => {
    setMountConfirmOpen(false);
    await execute("mount_database");
  };

  return (
    <div>
      {/* ── Action grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">

        {/* Static action cards */}
        {DB_ACTIONS.map((card) => {
          const Icon = card.icon;
          const isRunning = loading === card.action;
          return (
            <button
              key={card.action}
              onClick={() => handleClick(card)}
              disabled={!selectedDb || loading !== null}
              className={cn(
                "group relative flex flex-col items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-5 text-left",
                "hover:border-border hover:bg-card/90 hover:scale-[1.02]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-all duration-200 cursor-pointer"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white",
                  "transition-all duration-300 group-hover:scale-110",
                  card.colorClass,
                  isRunning ? card.glowClass : "group-hover:" + card.glowClass
                )}
              >
                {isRunning ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Icon className="h-5 w-5 drop-shadow-md" />
                )}
              </div>

              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">{card.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{card.description}</p>
              </div>

              {card.destructive && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Destructive
                </span>
              )}
            </button>
          );
        })}

        {/* ── Mount / Change Mode card ───────────────────────────────────── */}
        <button
          onClick={() => setMountConfirmOpen(true)}
          disabled={!selectedDb || loading !== null}
          className={cn(
            "group relative flex flex-col items-start gap-3 rounded-xl border bg-card/60 p-5 text-left",
            "hover:bg-card/90 hover:scale-[1.02]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-all duration-200 cursor-pointer",
            "border-border/60 hover:border-border"
          )}
        >
          {/* Icon */}
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white",
              "transition-all duration-300 group-hover:scale-110",
              "from-amber-500 to-orange-600",
              "group-hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]"
            )}
          >
            {loading === "mount_database" ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <ArrowRightLeft className="h-5 w-5 drop-shadow-md" />
            )}
          </div>

          <div className="flex-1">
            <p className="font-semibold text-sm text-foreground">Change DB Mode</p>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              Auto-detects state and switches: OPEN→MOUNT, MOUNT→OPEN, or DOWN→MOUNT
            </p>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            <AlertTriangle className="h-2.5 w-2.5" />
            State-Aware
          </span>
        </button>
      </div>

      {/* ── No database warning ───────────────────────────────────────────── */}
      {!selectedDb && (
        <p className="mt-4 text-sm text-amber-400/80 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Please select a database from the top selector first.
        </p>
      )}

      {/* ── Console output ────────────────────────────────────────────────── */}
      <ConsoleOutput
        status={runState.status}
        output={runState.output}
        action={runState.action ?? undefined}
        timestamp={runState.timestamp ?? undefined}
      />

      {/* ── Generic destructive confirm dialog (Start / Stop) ─────────────── */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className={cn(confirmAction?.action === "stop_database" ? "max-w-lg" : "max-w-md")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Confirm: {confirmAction?.label}
            </DialogTitle>
            <DialogDescription className="pt-1">
              You are about to run{" "}
              <span className="font-semibold text-foreground">{confirmAction?.label}</span>{" "}
              on database{" "}
              <span className="font-mono font-semibold text-amber-400">{selectedDb}</span>.
              <br />
              This is a disruptive operation. {confirmAction?.action !== "stop_database" && "Are you sure?"}
            </DialogDescription>
          </DialogHeader>

          {confirmAction?.action === "stop_database" && (
            <div className="my-4 space-y-3">
              <label className="text-sm font-semibold text-muted-foreground block">
                Select Shutdown Option:
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                {SHUTDOWN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedShutdownOption(opt.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-all duration-200 cursor-pointer",
                      selectedShutdownOption === opt.value
                        ? "border-red-500/50 bg-red-500/10 ring-1 ring-red-500/30"
                        : "border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-border"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={cn(
                        "font-mono font-bold text-sm",
                        selectedShutdownOption === opt.value ? "text-red-400" : "text-foreground"
                      )}>
                        {opt.label}
                      </span>
                      {selectedShutdownOption === opt.value && (
                        <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              {confirmAction?.action === "stop_database" ? "Confirm & Shutdown" : "Yes, Execute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Smart Mount / Mode-Switch confirm dialog ───────────────────────── */}
      <Dialog open={mountConfirmOpen} onOpenChange={setMountConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <ArrowRightLeft className="h-5 w-5 text-amber-400" />
              Change Database Mode
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-4 pt-2">
                <p className="text-sm text-foreground/90 leading-relaxed">
                  This action will dynamically detect the current state of the database and switch its mode automatically:
                </p>

                <ul className="space-y-2 text-sm text-muted-foreground bg-muted/30 p-4 rounded-xl border border-border/50">
                  <li className="flex items-start gap-2">
                    <span className="font-mono text-emerald-400 font-bold mt-0.5">•</span>
                    <span>If <strong>OPEN</strong> &rarr; Database will be shut down and started in <strong>MOUNT</strong> state.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-mono text-amber-400 font-bold mt-0.5">•</span>
                    <span>If <strong>MOUNTED</strong> &rarr; Database will be fully <strong>OPENED</strong>.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-mono text-cyan-400 font-bold mt-0.5">•</span>
                    <span>If <strong>DOWN</strong> &rarr; Database will be started in <strong>MOUNT</strong> state.</span>
                  </li>
                </ul>

                <p className="text-xs text-muted-foreground mt-4">
                  Database:{" "}
                  <span className="font-mono font-semibold text-amber-400">{selectedDb}</span>
                  {" "}— This operation will be executed safely via SSH (sqlplus / as sysdba).
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setMountConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => void handleMountConfirm()}
            >
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Confirm — Change Mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
