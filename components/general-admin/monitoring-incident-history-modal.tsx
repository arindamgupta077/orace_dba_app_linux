"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { fetchMonitoringIncidentHistory } from "@/services/api";
import type { MonitoringIncident } from "@/types/dba";

interface MonitoringIncidentHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTimestamp(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return isoDate;
  }
}

function StatusBadge({ status }: { status: MonitoringIncident["status"] }) {
  if (status === "DOWN") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
        <WifiOff className="h-3 w-3" />
        Down
      </span>
    );
  }
  if (status === "ACKNOWLEDGED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
        <Eye className="h-3 w-3" />
        Acknowledged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      Resolved
    </span>
  );
}

export function MonitoringIncidentHistoryModal({
  open,
  onOpenChange
}: MonitoringIncidentHistoryModalProps) {
  const [incidents, setIncidents] = useState<MonitoringIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMonitoringIncidentHistory(200);
      setIncidents(data);
    } catch (err) {
      console.error("[MonitoringIncidentHistoryModal] Error fetching history:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadHistory();
    }
  }, [open, loadHistory]);

  const filteredIncidents = incidents.filter((inc) => {
    const matchesSearch =
      search.trim() === "" ||
      inc.db_name.toLowerCase().includes(search.toLowerCase()) ||
      inc.incident_id.toLowerCase().includes(search.toLowerCase()) ||
      (inc.acknowledged_by && inc.acknowledged_by.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus =
      filterStatus === "ALL" || inc.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/40">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <History className="h-5 w-5 text-cyan-400" />
              Database Monitoring History
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Historical record of all database down notifications and incident resolutions
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadHistory()}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 pt-4 pb-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by database name, incident ID, user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-muted/20 border-border/60"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
            {["ALL", "DOWN", "ACKNOWLEDGED", "RESOLVED"].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-medium rounded-md transition-all",
                  filterStatus === st
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {st === "ALL" ? "All" : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Incident List */}
        <ScrollArea className="flex-1 pr-3 -mr-3">
          {loading && incidents.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading monitoring history…
            </div>
          ) : filteredIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2">
              <ShieldAlert className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">No monitoring records found</p>
              <p className="text-xs">No incidents match the selected filter criteria.</p>
            </div>
          ) : (
            <div className="space-y-2.5 pt-2">
              {filteredIncidents.map((inc) => (
                <div
                  key={inc.incident_id}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all text-xs",
                    inc.status === "DOWN"
                      ? "border-red-500/30 bg-red-500/5 hover:border-red-500/50"
                      : inc.status === "ACKNOWLEDGED"
                      ? "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50"
                      : "border-border/50 bg-card/40 hover:border-border"
                  )}
                >
                  {/* Left info: DB name & ID */}
                  <div className="space-y-1 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-foreground">
                        {inc.db_name}
                      </span>
                      <StatusBadge status={inc.status} />
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      {inc.incident_id}
                    </p>
                  </div>

                  {/* Middle info: Timestamps & report count */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground text-[11px]">
                    <div>
                      <span className="text-muted-foreground/60 block">First Reported:</span>
                      <span className="font-mono text-foreground/90">{formatTimestamp(inc.first_reported)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 block">Last Reported:</span>
                      <span className="font-mono text-foreground/90">{formatTimestamp(inc.last_reported)}</span>
                    </div>
                  </div>

                  {/* Right info: Ack / Resolved details */}
                  <div className="flex flex-col justify-center sm:items-end text-[11px] text-muted-foreground space-y-0.5">
                    {inc.report_count > 1 && (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        {inc.report_count} notifications
                      </span>
                    )}
                    {inc.acknowledged_by && (
                      <span>
                        Ack by <strong className="text-foreground">{inc.acknowledged_by}</strong> ({formatTimestamp(inc.acknowledged_at || "")})
                      </span>
                    )}
                    {inc.resolved_at && (
                      <span className="text-emerald-400 font-medium">
                        Resolved: {formatTimestamp(inc.resolved_at)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
