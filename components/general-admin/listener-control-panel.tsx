"use client";

import {
  AlertTriangle,
  FileText,
  PlayCircle,
  Radio,
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
}

export function ListenerControlPanel() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [runState, setRunState] = useState<RunState>({
    status: "idle",
    output: null,
    timestamp: null,
    action: null
  });
  const [confirmAction, setConfirmAction] = useState<ActionCard | null>(null);
  const [loading, setLoading] = useState<DbaAction | null>(null);

  const execute = async (card: ActionCard) => {
    if (!selectedDb) return;
    setLoading(card.action);
    setRunState({ status: "loading", output: null, timestamp: null, action: card.action });
    try {
      const result = await executeDBAAction(card.action, selectedDb, {});
      setRunState({
        status: result.status === "error" ? "error" : "success",
        output: result.raw_output || result.ai_summary || "(no output)",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action: card.action
      });
    } catch (err) {
      setRunState({
        status: "error",
        output: err instanceof Error ? err.message : "Unknown error occurred.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        action: card.action
      });
    } finally {
      setLoading(null);
    }
  };

  const handleClick = (card: ActionCard) => {
    if (card.destructive) {
      setConfirmAction(card);
    } else {
      void execute(card);
    }
  };

  const handleConfirm = () => {
    if (confirmAction) {
      void execute(confirmAction);
      setConfirmAction(null);
    }
  };

  return (
    <div>
      {/* Action cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {LISTENER_ACTIONS.map((card) => {
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
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white",
                  "transition-all duration-300 group-hover:scale-110",
                  card.colorClass
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
