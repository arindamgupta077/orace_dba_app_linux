"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  History,
  Play,
  StopCircle
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { RebootHistoryModal } from "@/components/general-admin/reboot-history-modal";
import { loadSessionData, saveSessionData } from "@/components/general-admin/storage-helpers";
import {
  executeDbControlBackground,
  getActiveAdminAction,
  isAdminActionRunning
} from "@/services/general-admin-service";
import { fetchMonitoringIncidentHistory, fetchRebootHistory } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { DbaAction, DbaResponse, RebootHistoryItem } from "@/types/dba";

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
  response?: DbaResponse | null;
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
    description: "Execute STARTUP — bring the database to OPEN mode. (Listener will be started after database startup)",
    icon: Play,
    colorClass: "from-emerald-500 to-teal-600",
    glowClass: "shadow-[0_0_18px_rgba(16,185,129,0.35)]"
  },
  {
    action: "stop_database",
    label: "Stop Database",
    description: "Execute SHUTDOWN IMMEDIATE — graceful instance shutdown. (Listener will be stopped before shutdown)",
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
  const selectedDb  = useAppStore((s) => s.selectedDb);
  const databases   = useAppStore((s) => s.databases);
  const updateDatabaseRebootEvent = useAppStore((s) => s.updateDatabaseRebootEvent);
  const updateDatabaseIncidentStatus = useAppStore((s) => s.updateDatabaseIncidentStatus);

  const isDbInventoryLoading = databases.length === 0;

  // Derive the env_label for the selected DB to gate PROD-only features
  const selectedDbTarget = databases.find(
    (d) => d.name.toUpperCase() === selectedDb?.toUpperCase()
  );
  const isProd = selectedDbTarget?.env_label === "PROD";

  const [loading, setLoading] = useState<DbaAction | null>(() => {
    return (getActiveAdminAction("db-control", selectedDb) as DbaAction) || null;
  });

  const [runState, setRunState] = useState<RunState>(() => {
    const active = getActiveAdminAction("db-control", selectedDb);
    if (active) {
      return {
        status: "loading",
        output: null,
        timestamp: null,
        action: active as DbaAction,
        response: null
      };
    }
    return loadSessionData<RunState>(
      `general_admin_db_control_runstate_${selectedDb || "default"}`,
      {
        status: "idle",
        output: null,
        timestamp: null,
        action: null,
        response: null
      }
    );
  });

  // Generic destructive confirm (Start / Stop)
  const [confirmAction, setConfirmAction] = useState<ActionCard | null>(null);

  // Selected shutdown option
  const [selectedShutdownOption, setSelectedShutdownOption] = useState<string>(() => {
    return loadSessionData<string>(
      `general_admin_shutdown_option_${selectedDb || "default"}`,
      "IMMEDIATE"
    );
  });

  // Mount-Database confirmation
  const [mountConfirmOpen, setMountConfirmOpen] = useState(false);

  // Reboot History modal
  const [rebootHistoryOpen, setRebootHistoryOpen] = useState(false);

  // Latest reboot event for PROD database to control button state
  const [latestRebootEvent, setLatestRebootEvent] = useState<RebootHistoryItem | null>(null);
  const [rebootStatusLoaded, setRebootStatusLoaded] = useState(false);

  // Latest incident status from app_db_monitoring_incidents to override button states
  const [latestIncidentStatus, setLatestIncidentStatus] = useState<string | null>(null);

  // Sync runState and shutdown option from session storage whenever selectedDb changes
  useEffect(() => {
    if (selectedDb) {
      const active = getActiveAdminAction("db-control", selectedDb);
      if (active) {
        setLoading(active as DbaAction);
        setRunState({
          status: "loading",
          output: null,
          timestamp: null,
          action: active as DbaAction,
          response: null
        });
      } else {
        const savedRunState = loadSessionData<RunState>(
          `general_admin_db_control_runstate_${selectedDb}`,
          { status: "idle", output: null, timestamp: null, action: null, response: null }
        );
        if (savedRunState.status === "loading" && !isAdminActionRunning("db-control", selectedDb)) {
          setRunState({ status: "idle", output: null, timestamp: null, action: null, response: null });
          setLoading(null);
        } else {
          setRunState(savedRunState);
          setLoading(savedRunState.status === "loading" ? (savedRunState.action as DbaAction) : null);
        }
      }

      const savedShutdown = loadSessionData<string>(
        `general_admin_shutdown_option_${selectedDb}`,
        "IMMEDIATE"
      );
      setSelectedShutdownOption(savedShutdown);
    }
  }, [selectedDb]);

  const refreshRebootStatus = useCallback(async (db: string, isDbProd: boolean) => {
    if (!isDbProd || !db) {
      setLatestRebootEvent(null);
      setRebootStatusLoaded(true);
      return;
    }
    try {
      const history = await fetchRebootHistory(db, 1);
      if (history && history.length > 0) {
        setLatestRebootEvent(history[0]);
        updateDatabaseRebootEvent(db, history[0].event_type);
      } else {
        setLatestRebootEvent(null);
      }
    } catch {
      // Non-blocking error handling
      setLatestRebootEvent(null);
    } finally {
      setRebootStatusLoaded(true);
    }
  }, [updateDatabaseRebootEvent]);

  const refreshIncidentStatus = useCallback(async (db: string) => {
    if (!db) {
      setLatestIncidentStatus(null);
      return;
    }
    try {
      const history = await fetchMonitoringIncidentHistory(1, db);
      if (history && history.length > 0) {
        const incStatus = history[0].status;
        setLatestIncidentStatus(incStatus);
        updateDatabaseIncidentStatus(db, incStatus);
      } else {
        setLatestIncidentStatus(null);
      }
    } catch {
      // Non-blocking fallback
      setLatestIncidentStatus(null);
    }
  }, [updateDatabaseIncidentStatus]);

  useEffect(() => {
    if (!selectedDb || isDbInventoryLoading) return;
    void refreshIncidentStatus(selectedDb);
    if (isProd) {
      setRebootStatusLoaded(false);
      void refreshRebootStatus(selectedDb, isProd);
    } else {
      setLatestRebootEvent(null);
      setRebootStatusLoaded(true);
    }
  }, [selectedDb, isProd, isDbInventoryLoading, refreshRebootStatus, refreshIncidentStatus]);

  useEffect(() => {
    const handleMonitoringUpdate = () => {
      if (selectedDb) {
        void refreshIncidentStatus(selectedDb);
      }
    };

    const handleDatabaseUpdate = (e: Event) => {
      const customEv = e as CustomEvent<{ db?: string; event_type?: string }>;
      if (customEv.detail?.db && selectedDb && customEv.detail.db.toUpperCase() === selectedDb.toUpperCase()) {
        if (isProd) {
          void refreshRebootStatus(selectedDb, isProd);
        }
        void refreshIncidentStatus(selectedDb);
      }
    };

    const handleRunStateChange = (e: Event) => {
      const customEv = e as CustomEvent<{
        type: string;
        db: string;
        action: DbaAction;
        runState: RunState;
      }>;
      if (
        customEv.detail?.type === "db-control" &&
        selectedDb &&
        customEv.detail.db.toUpperCase() === selectedDb.toUpperCase()
      ) {
        const detail = customEv.detail;
        if (detail.runState.status === "loading") {
          setLoading(detail.action);
          setRunState(detail.runState);
        } else {
          setLoading(null);
          setRunState(detail.runState);
          if (isProd) {
            void refreshRebootStatus(selectedDb, isProd);
          }
          void refreshIncidentStatus(selectedDb);
        }
      }
    };

    window.addEventListener("dba-monitoring-incident", handleMonitoringUpdate);
    window.addEventListener("dba-notification", handleMonitoringUpdate);
    window.addEventListener("dba-database-update", handleDatabaseUpdate);
    window.addEventListener("general-admin-runstate-change", handleRunStateChange);

    return () => {
      window.removeEventListener("dba-monitoring-incident", handleMonitoringUpdate);
      window.removeEventListener("dba-notification", handleMonitoringUpdate);
      window.removeEventListener("dba-database-update", handleDatabaseUpdate);
      window.removeEventListener("general-admin-runstate-change", handleRunStateChange);
    };
  }, [selectedDb, isProd, refreshRebootStatus, refreshIncidentStatus]);

  const effectiveIncidentStatus = (
    latestIncidentStatus ??
    selectedDbTarget?.incident_status ??
    ""
  ).trim().toUpperCase();

  const isLatestIncidentActive =
    effectiveIncidentStatus === "DOWN" || effectiveIncidentStatus === "ACKNOWLEDGED";

  // Is Stop Database disabled:
  // If latest incident_status is "DOWN" or "ACKNOWLEDGED" (not resolved) -> STOP is DISABLED (overrides existing condition).
  // If latest incident_status is "RESOLVED" (or not active) -> keep existing condition in place.
  const isStopDisabled =
    isDbInventoryLoading ||
    (isLatestIncidentActive
      ? true
      : isProd &&
        (!rebootStatusLoaded ||
          latestRebootEvent?.event_type === "PRE_SHUTDOWN" ||
          latestRebootEvent?.event_type === "POST_MOUNT_FAILED"));

  // Is Start Database disabled:
  // If latest incident_status is "DOWN" or "ACKNOWLEDGED" (not resolved) -> START is ENABLED (isStartDisabled = false, overrides existing condition).
  // If latest incident_status is "RESOLVED" (or not active) -> keep existing condition in place.
  const isStartDisabled =
    isDbInventoryLoading ||
    (isLatestIncidentActive
      ? false
      : isProd &&
        (!rebootStatusLoaded ||
          latestRebootEvent?.event_type === "POST_MOUNT_COMPLIANT"));

  // ── Generic execute helper ─────────────────────────────────────────────────

  const execute = async (action: DbaAction, params: Record<string, unknown> = {}) => {
    if (!selectedDb) return;
    setLoading(action);
    setRunState({ status: "loading", output: null, timestamp: null, action, response: null });
    return executeDbControlBackground(selectedDb, action, params, isProd);
  };

  // ── Generic card click handler ─────────────────────────────────────────────

  const handleClick = (card: ActionCard) => {
    if (card.action === "stop_database" && isStopDisabled) {
      return;
    }
    if (card.action === "start_database" && isStartDisabled) {
      return;
    }
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
      {/* ── Section header with Reboot History button (PROD only) ────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Instance Control Actions
          </span>
          {selectedDb && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {selectedDb}
              {selectedDbTarget?.env_label && (
                <span className={cn(
                  "rounded px-1.5 py-0.2 text-[10px] font-bold uppercase",
                  isProd
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                    : "bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-500/30"
                )}>
                  {selectedDbTarget.env_label}
                </span>
              )}
            </span>
          )}
        </div>

        {selectedDb && isProd && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRebootHistoryOpen(true)}
              className="flex items-center gap-1.5 border-indigo-200 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20 dark:hover:border-indigo-500/50 text-xs font-semibold transition-all shadow-2xs"
            >
              <History className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Reboot History</span>
            </Button>
          </div>
        )}
      </div>

      {/* ── Action grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">

        {/* Static action cards */}
        {DB_ACTIONS.map((card) => {
          const Icon = card.icon;
          const isRunning = loading === card.action;
          const isStopAction = card.action === "stop_database";
          const isStartAction = card.action === "start_database";
          const cardStopDisabled = isStopAction && isStopDisabled;
          const cardStartDisabled = isStartAction && isStartDisabled;
          const isActionDisabled = cardStopDisabled || cardStartDisabled;
          const isDisabled = !selectedDb || isDbInventoryLoading || !selectedDbTarget || loading !== null || isActionDisabled;

          return (
            <button
              key={card.action}
              onClick={() => handleClick(card)}
              disabled={isDisabled}
              className={cn(
                "group relative flex flex-col items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-5 text-left",
                "hover:border-border hover:bg-card/90 hover:scale-[1.02]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-card/60 disabled:hover:border-border/60",
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

              <div className="flex-1 w-full">
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
          disabled={!selectedDb || isDbInventoryLoading || !selectedDbTarget || loading !== null}
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
        response={runState.response}
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
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span><strong>Note:</strong> The Oracle listener will be stopped before database shutdown.</span>
              </div>
              <label className="text-sm font-semibold text-muted-foreground block">
                Select Shutdown Option:
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                {SHUTDOWN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setSelectedShutdownOption(opt.value);
                      if (selectedDb) {
                        saveSessionData(`general_admin_shutdown_option_${selectedDb}`, opt.value);
                      }
                    }}
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

      {/* ── Reboot History Modal (PROD only) ───────────────────────────────── */}
      {selectedDb && isProd && (
        <RebootHistoryModal
          open={rebootHistoryOpen}
          onOpenChange={setRebootHistoryOpen}
          db={selectedDb}
        />
      )}
    </div>
  );
}
