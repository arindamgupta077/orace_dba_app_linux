"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import {
  acknowledgeMonitoringIncident,
  checkMonitoringIncidentStatus,
  fetchMonitoringIncidents
} from "@/services/api";
import type { MonitoringIncident } from "@/types/dba";

const POLL_INTERVAL_MS = 30_000;

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function StatusBadge({ status }: { status: MonitoringIncident["status"] }) {
  if (status === "DOWN") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-red-400">
        <WifiOff className="h-3 w-3" />
        Down
      </span>
    );
  }
  if (status === "ACKNOWLEDGED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-400">
        <Eye className="h-3 w-3" />
        Acknowledged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      Resolved
    </span>
  );
}

export function MonitoringIncidentsPanel() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [incidents, setIncidents] = useState<MonitoringIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchMonitoringIncidents(selectedDb);
      if (mountedRef.current) {
        setIncidents(data);
      }
    } catch (err) {
      console.error("[MonitoringIncidentsPanel] fetch error:", err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedDb]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const intervalId = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [refresh]);

  // Listen for live monitoring notifications to trigger a refresh
  useEffect(() => {
    function onNotification(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "db_monitoring") {
        void refresh();
      }
    }
    window.addEventListener("dba-notification", onNotification);
    return () => window.removeEventListener("dba-notification", onNotification);
  }, [refresh]);

  const handleAcknowledge = async (incidentId: string) => {
    setActionLoading((prev) => ({ ...prev, [incidentId]: "acknowledge" }));
    try {
      const { incident } = await acknowledgeMonitoringIncident(incidentId);
      toast.info(`Incident acknowledged for database ${incident.db_name}`);
      setIncidents((prev) =>
        prev.map((inc) => (inc.incident_id === incidentId ? incident : inc))
      );
      window.dispatchEvent(new CustomEvent("dba-monitoring-incident"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to acknowledge incident");
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[incidentId];
        return next;
      });
    }
  };

  const handleCheckStatus = async (incidentId: string) => {
    setActionLoading((prev) => ({ ...prev, [incidentId]: "check" }));
    try {
      const targetInc = incidents.find((i) => i.incident_id === incidentId);
      const dbName = targetInc?.db_name || "database";
      const result = await checkMonitoringIncidentStatus(incidentId);

      if (result.resolved || result.status === "UP") {
        toast.success(`Database ${dbName} is confirmed UP!`, {
          description: "Status check test_connection returned UP. Incident resolved."
        });
        // Remove resolved incident from list
        setIncidents((prev) => prev.filter((inc) => inc.incident_id !== incidentId));
      } else {
        toast.warning(`Database ${dbName} is still unreachable (DOWN).`, {
          description: "Status check test_connection returned DOWN."
        });
        if (result.incident) {
          setIncidents((prev) =>
            prev.map((inc) => (inc.incident_id === incidentId ? result.incident! : inc))
          );
        }
      }
      window.dispatchEvent(new CustomEvent("dba-monitoring-incident"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check status");
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[incidentId];
        return next;
      });
    }
  };

  const visibleIncidents = incidents.filter(
    (inc) => !selectedDb || inc.db_name.toUpperCase() === selectedDb.toUpperCase()
  );

  // Don't render anything if there are no active incidents for the selected database
  if (visibleIncidents.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/20">
          <ShieldAlert className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            Monitoring Notifications
            {visibleIncidents.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/90 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-red-500/40">
                {visibleIncidents.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            Active database availability incidents detected by the Monitoring Agent
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Incident cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleIncidents.map((incident) => {
          const action = actionLoading[incident.incident_id];
          const isAcking = action === "acknowledge";
          const isChecking = action === "check";
          const isBusy = !!action;

          return (
            <div
              key={incident.incident_id}
              className={cn(
                "relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200",
                incident.status === "DOWN"
                  ? "border-red-500/40 bg-red-500/5 hover:border-red-500/60"
                  : "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
              )}
            >
              {/* Pulsing indicator for DOWN status */}
              {incident.status === "DOWN" && (
                <span className="absolute right-3 top-3 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                </span>
              )}

              {/* Database name + status */}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                    incident.status === "DOWN"
                      ? "from-red-500 to-rose-600"
                      : "from-amber-500 to-orange-600"
                  )}
                >
                  {incident.status === "DOWN" ? (
                    <WifiOff className="h-4 w-4" />
                  ) : (
                    <Wifi className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-bold text-foreground truncate">
                    {incident.db_name}
                  </p>
                  <StatusBadge status={incident.status} />
                </div>
              </div>

              {/* Details */}
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>First reported: {timeAgo(incident.first_reported)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3 shrink-0" />
                  <span>Last reported: {timeAgo(incident.last_reported)}</span>
                </div>
                {incident.report_count > 1 && (
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                    <span className="text-amber-400 font-medium">
                      {incident.report_count} notifications received
                    </span>
                  </div>
                )}
                {incident.acknowledged_by && (
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3 w-3 shrink-0 text-amber-400" />
                    <span>
                      Acknowledged by <span className="font-medium text-foreground">{incident.acknowledged_by}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mt-auto pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={incident.status === "ACKNOWLEDGED" || isBusy}
                  onClick={() => void handleAcknowledge(incident.incident_id)}
                  className={cn(
                    "flex-1 text-xs h-8",
                    incident.status !== "ACKNOWLEDGED" &&
                      "border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60"
                  )}
                >
                  {isAcking ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Eye className="h-3 w-3 mr-1" />
                  )}
                  {incident.status === "ACKNOWLEDGED" ? "Acknowledged" : "Acknowledge"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void handleCheckStatus(incident.incident_id)}
                  className="flex-1 text-xs h-8 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300 hover:border-cyan-500/60"
                >
                  {isChecking ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Wifi className="h-3 w-3 mr-1" />
                  )}
                  Check Status
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
