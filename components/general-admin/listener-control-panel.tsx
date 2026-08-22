"use client";

import {
  AlertTriangle,
  FileText,
  PlayCircle,
  Radio,
  StopCircle
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { loadSessionData } from "@/components/general-admin/storage-helpers";
import {
  executeListenerControlBackground,
  getActiveAdminAction,
  isAdminActionRunning
} from "@/services/general-admin-service";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { DbaAction, DbaResponse } from "@/types/dba";

interface ActionCard {
  action: DbaAction;
  label: string;
  description: string;
  icon: React.ElementType;
  colorClass: string;
  glowClass: string;
  destructive?: boolean;
}

const LISTENER_ACTIONS: ActionCard[] = [
  {
    action: "check_listener",
    label: "Check Listener Status",
    description: "Run lsnrctl status — view all services, endpoints, and listener uptime",
    icon: Radio,
    colorClass: "from-violet-500 to-purple-600",
    glowClass: "shadow-[0_0_18px_rgba(139,92,246,0.35)]"
  },
  {
    action: "start_listener",
    label: "Start Listener",
    description: "Run lsnrctl start — bring the Oracle listener online",
    icon: PlayCircle,
    colorClass: "from-emerald-500 to-teal-600",
    glowClass: "shadow-[0_0_18px_rgba(16,185,129,0.35)]",
    destructive: true
  },
  {
    action: "stop_listener",
    label: "Stop Listener",
    description: "Run lsnrctl stop — halt the Oracle listener (drops incoming connections)",
    icon: StopCircle,
    colorClass: "from-red-500 to-rose-600",
    glowClass: "shadow-[0_0_18px_rgba(239,68,68,0.35)]",
    destructive: true
  },
  {
    action: "fetch_listener",
    label: "Check listener.ora File",
    description: "Fetch listener.ora content from the Oracle network admin directory",
    icon: FileText,
    colorClass: "from-sky-500 to-cyan-600",
    glowClass: "shadow-[0_0_18px_rgba(14,165,233,0.35)]"
  },
  {
    action: "fetch_tnsnames",
    label: "Check tnsnames.ora File",
    description: "Fetch tnsnames.ora content from the Oracle network admin directory",
    icon: FileText,
    colorClass: "from-amber-500 to-orange-600",
    glowClass: "shadow-[0_0_18px_rgba(245,158,11,0.35)]"
  }
];

interface RunState {
  status: "idle" | "loading" | "success" | "error";
  output: string | null;
  timestamp: string | null;
  action: DbaAction | null;
  response?: DbaResponse | null;
}

export function ListenerControlPanel() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const databases  = useAppStore((s) => s.databases);

  const isDbInventoryLoading = databases.length === 0;

  // Derive the env_label for the selected DB to gate PROD-only features
  const selectedDbTarget = databases.find(
    (d) => d.name.toUpperCase() === selectedDb?.toUpperCase()
  );
  const isProd = selectedDbTarget?.env_label === "PROD";

  const [loading, setLoading] = useState<DbaAction | null>(() => {
    return (getActiveAdminAction("listener-control", selectedDb) as DbaAction) || null;
  });
  const [runState, setRunState] = useState<RunState>(() => {
    const active = getActiveAdminAction("listener-control", selectedDb);
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
      `general_admin_listener_control_runstate_${selectedDb || "default"}`,
      {
        status: "idle",
        output: null,
        timestamp: null,
        action: null,
        response: null
      }
    );
  });
  const [confirmAction, setConfirmAction] = useState<ActionCard | null>(null);

  // Sync runState when selectedDb changes
  useEffect(() => {
    if (selectedDb) {
      const active = getActiveAdminAction("listener-control", selectedDb);
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
          `general_admin_listener_control_runstate_${selectedDb}`,
          {
            status: "idle",
            output: null,
            timestamp: null,
            action: null,
            response: null
          }
        );
        if (savedRunState.status === "loading" && !isAdminActionRunning("listener-control", selectedDb)) {
          setRunState({ status: "idle", output: null, timestamp: null, action: null, response: null });
          setLoading(null);
        } else {
          setRunState(savedRunState);
          setLoading(savedRunState.status === "loading" ? (savedRunState.action as DbaAction) : null);
        }
      }
    }
  }, [selectedDb]);

  // Listen to background runstate changes
  useEffect(() => {
    const handleRunStateChange = (e: Event) => {
      const customEv = e as CustomEvent<{
        type: string;
        db: string;
        action: DbaAction;
        runState: RunState;
      }>;
      if (
        customEv.detail?.type === "listener-control" &&
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
        }
      }
    };

    const handleStorageCleared = () => {
      setRunState({ status: "idle", output: null, timestamp: null, action: null, response: null });
      setLoading(null);
      setConfirmAction(null);
    };

    window.addEventListener("general-admin-runstate-change", handleRunStateChange);
    window.addEventListener("general-admin-storage-cleared", handleStorageCleared);
    return () => {
      window.removeEventListener("general-admin-runstate-change", handleRunStateChange);
      window.removeEventListener("general-admin-storage-cleared", handleStorageCleared);
    };
  }, [selectedDb]);

  const execute = async (card: ActionCard) => {
    if (!selectedDb) return;
    const isListenerStartOrStop = card.action === "start_listener" || card.action === "stop_listener";
    if (isProd && isListenerStartOrStop) return;
    setLoading(card.action);
    setRunState({ status: "loading", output: null, timestamp: null, action: card.action, response: null });
    return executeListenerControlBackground(selectedDb, card.action, {});
  };

  const handleClick = (card: ActionCard) => {
    const isListenerStartOrStop = card.action === "start_listener" || card.action === "stop_listener";
    if (isProd && isListenerStartOrStop) {
      return;
    }
    if (card.destructive) {
      setConfirmAction(card);
    } else {
      void execute(card);
    }
  };

  const handleConfirm = () => {
    if (confirmAction) {
      const isListenerStartOrStop = confirmAction.action === "start_listener" || confirmAction.action === "stop_listener";
      if (isProd && isListenerStartOrStop) {
        setConfirmAction(null);
        return;
      }
      void execute(confirmAction);
      setConfirmAction(null);
    }
  };

  return (
    <div>
      {/* ── Section header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Listener Control Actions
          </span>
          {selectedDb && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {selectedDb}
              {selectedDbTarget?.env_label && (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.2 text-[10px] font-bold uppercase",
                    isProd
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                      : "bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-500/30"
                  )}
                >
                  {selectedDbTarget.env_label}
                </span>
              )}
            </span>
          )}
        </div>

        {selectedDb && isProd && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Listener Start/Stop is disabled for Production databases</span>
          </div>
        )}
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {LISTENER_ACTIONS.map((card) => {
          const Icon = card.icon;
          const isRunning = loading === card.action;
          const isListenerStartOrStop =
            card.action === "start_listener" || card.action === "stop_listener";
          const isCardDisabledByProd = isProd && isListenerStartOrStop;
          const isDisabled =
            !selectedDb ||
            isDbInventoryLoading ||
            !selectedDbTarget ||
            loading !== null ||
            isCardDisabledByProd;

          return (
            <button
              key={card.action}
              onClick={() => handleClick(card)}
              disabled={isDisabled}
              title={
                isCardDisabledByProd
                  ? "Start and Stop Listener are disabled for production databases."
                  : undefined
              }
              className={cn(
                "group relative flex flex-col items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-5 text-left",
                "hover:border-border hover:bg-card/90 hover:scale-[1.02]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-card/60 disabled:hover:border-border/60",
                "transition-all duration-200 cursor-pointer"
              )}
            >
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

              {isCardDisabledByProd ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                  Disabled on PROD
                </span>
              ) : card.destructive ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                  Destructive
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {!selectedDb && (
        <p className="mt-4 text-sm text-amber-400/80 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Please select a database from the top selector first.
        </p>
      )}

      <ConsoleOutput
        status={runState.status}
        output={runState.output}
        action={runState.action ?? undefined}
        timestamp={runState.timestamp ?? undefined}
        response={runState.response}
      />

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
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
              This will affect client connectivity. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              Yes, Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
