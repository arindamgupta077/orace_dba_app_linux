"use client";

import type { DatabaseTarget } from "@/types/dba";
import { DatabaseZap, Terminal, Cpu, ShieldAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";

export function DatabaseSelector() {
  const databases = useAppStore((state) => state.databases);
  const selectedDb = useAppStore((state) => state.selectedDb);
  const setSelectedDb = useAppStore((state) => state.setSelectedDb);
  const setDatabases = useAppStore((state) => state.setDatabases);
  const selected = databases.find((db) => db.name === selectedDb);

  const refreshDatabaseStatuses = async () => {
    try {
      const response = await fetch("/api/databases", { cache: "no-store" });
      if (!response.ok) return;
      const { databases: refreshedDatabases } = await response.json() as { databases?: DatabaseTarget[] };
      if (refreshedDatabases) setDatabases(refreshedDatabases);
    } catch {
      // Retain the existing selector data if its background refresh fails.
    }
  };

  const getEnvBadgeStyle = (env: string) => {
    switch (env?.toUpperCase()) {
      case "PROD":
        return "bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/20";
      case "DEV":
        return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20";
      case "UAT":
        return "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/20";
      case "DR":
        return "bg-purple-500/20 text-purple-300 border-purple-500/30 hover:bg-purple-500/20";
      default:
        return "bg-slate-500/20 text-slate-300 border-slate-500/30 hover:bg-slate-500/20";
    }
  };

  const getStatusDotStyle = (status: string) => {
    switch (status?.toLowerCase()) {
      case "active":
      case "healthy":
        return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]";
      case "inactive":
      case "warning":
        return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]";
      default:
        return "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]";
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selectedDb}
        onValueChange={setSelectedDb}
        onOpenChange={(open) => {
          if (open) void refreshDatabaseStatuses();
        }}
        disabled={!databases.length}
      >
        <SelectTrigger className="h-10 min-w-[210px] rounded-xl border border-cyan-500/20 bg-background/20 backdrop-blur-md px-3 py-2 text-sm font-medium text-foreground shadow-[0_0_12px_rgba(6,182,212,0.05)] hover:border-cyan-500/40 hover:bg-background/40 hover:shadow-[0_0_15px_rgba(6,182,212,0.15)] transition-all duration-300 focus:ring-cyan-500/30 focus:ring-1">
          <div className="flex w-full items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <DatabaseZap className="h-4 w-4 shrink-0 text-cyan-400" />
              {selected ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold tracking-tight text-foreground truncate">{selected.name}</span>
                  <Badge variant="outline" className={cn("h-5 px-1.5 py-0 text-[10px] uppercase font-extrabold tracking-wider border shrink-0", getEnvBadgeStyle(selected.env_label))}>
                    {selected.env_label}
                  </Badge>
                </div>
              ) : (
                <span className="text-muted-foreground text-sm">Select Database</span>
              )}
            </div>
            
            {selected && (
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={cn("h-2 w-2 rounded-full", getStatusDotStyle(selected.status))} />
              </span>
            )}
          </div>
        </SelectTrigger>
        <SelectContent className="max-h-[300px] w-[260px] rounded-xl border border-border/80 bg-background/95 backdrop-blur-xl p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
          {databases.map((db) => (
            <SelectItem 
              key={db.name} 
              value={db.name} 
              className="rounded-lg py-2 px-3 pl-8 cursor-pointer focus:bg-cyan-950/20 focus:text-foreground text-foreground/90 transition-colors"
            >
              <div className="flex flex-col gap-1 w-full">
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="font-semibold text-sm tracking-tight">{db.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className={cn("h-4.5 px-1 py-0 text-[9px] uppercase font-bold tracking-wider border", getEnvBadgeStyle(db.env_label))}>
                      {db.env_label}
                    </Badge>
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", getStatusDotStyle(db.status))} />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 font-medium">
                  <span className="flex items-center gap-0.5">
                    <Terminal className="h-2.5 w-2.5" />
                    {db.db_type}
                  </span>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/45" />
                  <span className="flex items-center gap-0.5">
                    <Cpu className="h-2.5 w-2.5" />
                    {db.os}
                  </span>
                  {db.security_posture_outdated && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/45" />
                      <span
                        className="flex items-center gap-0.5 text-red-500"
                        aria-label="Security posture is outdated"
                        title="Security posture is outdated"
                        data-testid="posture"
                      >
                        <ShieldAlert className="h-2.5 w-2.5" />
                        Posture
                      </span>
                    </>
                  )}
                </div>
              </div>
            </SelectItem>
          ))}
          {!databases.length && (
            <div className="p-3 text-center text-xs text-muted-foreground">
              No databases available
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
