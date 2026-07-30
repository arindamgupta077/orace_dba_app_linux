"use client";

import { useMemo, useState } from "react";

import type { DatabaseTarget } from "@/types/dba";
import { DatabaseZap, Building2, Cpu, ShieldAlert, Search, X, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/use-app-store";
import { fetchDataPumpJobsApi } from "@/services/api";
import { cn } from "@/lib/utils";

const ENV_PRIORITY: Record<string, number> = {
  PROD: 1,
  UAT: 2,
  DEV: 3,
  DR: 4,
};

const getEnvPriority = (env?: string) => {
  if (!env) return 99;
  return ENV_PRIORITY[env.toUpperCase()] ?? 50;
};

const ENV_FULL_NAMES: Record<string, string> = {
  PROD: "Production",
  UAT: "User Acceptance Testing",
  DEV: "Development",
  DR: "Disaster Recovery",
};

interface ActiveDbActivity {
  type: "expdp" | "impdp" | "rman";
  label: string;
  description: string;
  colorClass: string;
}

export function DatabaseSelector() {
  const databases = useAppStore((state) => state.databases);
  const selectedDb = useAppStore((state) => state.selectedDb);
  const setSelectedDb = useAppStore((state) => state.setSelectedDb);
  const setDatabases = useAppStore((state) => state.setDatabases);
  const dataPumpJobs = useAppStore((state) => state.dataPumpJobs);
  const rmanJobs = useAppStore((state) => state.rmanJobs);
  const upsertDataPumpJob = useAppStore((state) => state.upsertDataPumpJob);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEnvFilter, setSelectedEnvFilter] = useState<string>("ALL");

  const getActiveActivitiesForDb = (dbName?: string): ActiveDbActivity[] => {
    if (!dbName) return [];
    const normalized = dbName.trim().toUpperCase();
    const activities: ActiveDbActivity[] = [];

    // Data Pump running jobs (expdp / impdp)
    const runningDataPump = dataPumpJobs.filter(
      (j) => j.status === "running" && j.db && j.db.trim().toUpperCase() === normalized
    );
    for (const job of runningDataPump) {
      if (job.operation === "expdp" && !activities.some((a) => a.type === "expdp")) {
        activities.push({
          type: "expdp",
          label: "EXPDP",
          description: "Data Pump Export in progress",
          colorClass: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40"
        });
      } else if (job.operation === "impdp" && !activities.some((a) => a.type === "impdp")) {
        activities.push({
          type: "impdp",
          label: "IMPDP",
          description: "Data Pump Import in progress",
          colorClass: "bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-500/40"
        });
      }
    }

    // RMAN running jobs
    const runningRman = rmanJobs.filter(
      (j) => j.status === "running" && j.db && j.db.trim().toUpperCase() === normalized
    );
    if (runningRman.length > 0) {
      activities.push({
        type: "rman",
        label: "RMAN",
        description: "RMAN Backup in progress",
        colorClass: "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/40"
      });
    }

    return activities;
  };

  const logicalDatabases = useMemo(() => {
    const seenNames = new Set<string>();
    return databases.filter((database) => {
      const key = database.name.trim().toUpperCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
  }, [databases]);

  const selected = logicalDatabases.find((db) => db.name === selectedDb);
  const selectedActivities = getActiveActivitiesForDb(selected?.name);

  const refreshDatabaseStatuses = async () => {
    try {
      const [dbRes, dpRes] = await Promise.allSettled([
        fetch("/api/databases?selector=1", { cache: "no-store" }),
        fetchDataPumpJobsApi()
      ]);

      if (dbRes.status === "fulfilled" && dbRes.value.ok) {
        const { databases: refreshedDatabases } = (await dbRes.value.json()) as { databases?: DatabaseTarget[] };
        if (refreshedDatabases) setDatabases(refreshedDatabases);
      }

      if (dpRes.status === "fulfilled" && Array.isArray(dpRes.value?.active)) {
        dpRes.value.active.forEach((j) => upsertDataPumpJob(j));
      }
    } catch {
      // Retain existing selector data if background refresh fails.
    }
  };

  const getEnvBadgeStyle = (env?: string) => {
    switch (env?.toUpperCase()) {
      case "PROD":
        return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/25";
      case "DEV":
        return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25";
      case "UAT":
        return "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25";
      case "DR":
        return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 hover:bg-purple-500/25";
      default:
        return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30 hover:bg-slate-500/25";
    }
  };

  const getStatusDotStyle = (status?: string) => {
    switch (status?.toLowerCase()) {
      case "active":
      case "healthy":
        return "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]";
      case "inactive":
      case "warning":
        return "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]";
      default:
        return "bg-rose-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]";
    }
  };

  // Group and sort databases strictly environment back-to-back
  const groupedDatabases = useMemo(() => {
    const sorted = [...logicalDatabases].sort((a, b) => {
      const envA = getEnvPriority(a.env_label);
      const envB = getEnvPriority(b.env_label);
      if (envA !== envB) return envA - envB;

      const divA = (a.division || "PCPB").toUpperCase();
      const divB = (b.division || "PCPB").toUpperCase();
      if (divA !== divB) return divA.localeCompare(divB);

      return a.name.localeCompare(b.name);
    });

    const groups: Record<string, DatabaseTarget[]> = {};
    for (const db of sorted) {
      const envKey = (db.env_label || "PROD").toUpperCase();
      if (!groups[envKey]) groups[envKey] = [];
      groups[envKey].push(db);
    }
    return groups;
  }, [logicalDatabases]);

  // Filter grouped databases based on search query and selected environment tab
  const filteredGroups = useMemo(() => {
    const result: Record<string, DatabaseTarget[]> = {};
    const query = searchQuery.trim().toLowerCase();

    for (const [env, dbs] of Object.entries(groupedDatabases)) {
      if (selectedEnvFilter !== "ALL" && env !== selectedEnvFilter) continue;

      const filtered = dbs.filter((db) => {
        if (!query) return true;
        const nameMatch = db.name.toLowerCase().includes(query);
        const divMatch = (db.division || "").toLowerCase().includes(query);
        const osMatch = (db.os || "").toLowerCase().includes(query);
        return nameMatch || divMatch || osMatch;
      });

      if (filtered.length > 0) {
        result[env] = filtered;
      }
    }
    return result;
  }, [groupedDatabases, searchQuery, selectedEnvFilter]);

  const hasResults = Object.keys(filteredGroups).length > 0;
  const availableEnvironments = useMemo(() => {
    return Array.from(new Set(Object.keys(groupedDatabases)));
  }, [groupedDatabases]);

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selectedDb}
        onValueChange={setSelectedDb}
        onOpenChange={(open) => {
          if (open) void refreshDatabaseStatuses();
          if (!open) {
            setSearchQuery("");
            setSelectedEnvFilter("ALL");
          }
        }}
        disabled={!logicalDatabases.length}
      >
        <SelectTrigger className="h-9 w-auto min-w-[145px] max-w-[240px] rounded-xl border border-cyan-500/30 bg-background/60 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-foreground shadow-[0_1px_6px_rgba(6,182,212,0.12)] hover:border-cyan-500/60 hover:bg-background/90 hover:shadow-[0_2px_10px_rgba(6,182,212,0.2)] transition-all duration-200 focus:ring-cyan-500/30 focus:ring-1">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <DatabaseZap className="h-3.5 w-3.5 shrink-0 text-cyan-500 dark:text-cyan-400" />
              {selected ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold tracking-tight text-foreground truncate text-xs sm:text-sm">{selected.name}</span>
                  {selectedActivities.length > 0 && (
                    <div
                      className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 animate-pulse"
                      title={selectedActivities.map((a) => a.description).join(", ")}
                    >
                      <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />
                      <div className="flex items-center gap-0.5">
                        {selectedActivities.map((act) => (
                          <span
                            key={act.type}
                            className={cn(
                              "px-1 py-0 text-[8px] font-black rounded uppercase tracking-tight border",
                              act.colorClass
                            )}
                          >
                            {act.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 px-1.5 py-0 text-[8.5px] uppercase font-extrabold tracking-wider border shrink-0",
                      getEnvBadgeStyle(selected.env_label)
                    )}
                  >
                    {selected.env_label}
                  </Badge>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">Select Database</span>
              )}
            </div>

            {selected && (
              <span className="flex items-center gap-1 shrink-0 ml-1">
                <span className={cn("h-2 w-2 rounded-full", getStatusDotStyle(selected.status))} />
              </span>
            )}
          </div>
        </SelectTrigger>

        {/* Compact & High-Density Dropdown Content */}
        <SelectContent className="max-h-[460px] w-[300px] sm:w-[320px] rounded-xl border border-border/80 bg-popover/95 backdrop-blur-xl p-1.5 shadow-xl">
          {/* Top Search & Filter Bar */}
          <div
            className="sticky top-0 z-10 bg-popover/95 backdrop-blur-md p-1.5 border-b border-border/60 -mx-1.5 -mt-1.5 mb-1 space-y-1.5"
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search DB or division..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-6 py-1 text-[11px] bg-muted/40 border border-border/60 rounded-md focus:outline-none focus:border-cyan-500/50 text-foreground placeholder:text-muted-foreground/60 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground text-xs"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                onClick={() => setSelectedEnvFilter("ALL")}
                className={cn(
                  "px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors shrink-0 border",
                  selectedEnvFilter === "ALL"
                    ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40 shadow-sm"
                    : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60"
                )}
              >
                ALL ({logicalDatabases.length})
              </button>
              {availableEnvironments.map((env) => {
                const count = (groupedDatabases[env] || []).length;
                return (
                  <button
                    key={env}
                    onClick={() => setSelectedEnvFilter(env)}
                    className={cn(
                      "px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors shrink-0 border",
                      selectedEnvFilter === env
                        ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40 shadow-sm"
                        : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60"
                    )}
                  >
                    {env} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grouped Databases (Environment Back to Back with Clean Organized Layout) */}
          {hasResults ? (
            Object.entries(filteredGroups).map(([env, dbs], idx) => (
              <SelectGroup key={env} className="py-1">
                {idx > 0 && <SelectSeparator className="my-1.5 bg-border/40" />}
                <SelectLabel className="flex items-center justify-between px-2.5 py-1 text-[10.5px] font-extrabold tracking-wider uppercase text-foreground/90 bg-muted/40 rounded-md my-1 border-l-2 border-cyan-500 border-border/30">
                  <span className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn("h-4 px-1.5 py-0 text-[8.5px] uppercase font-extrabold border shrink-0", getEnvBadgeStyle(env))}
                    >
                      {env}
                    </Badge>
                    <span className="text-foreground/90 font-bold">{ENV_FULL_NAMES[env] || env}</span>
                  </span>
                  <span className="text-[9.5px] font-mono font-semibold text-muted-foreground">
                    {dbs.length} {dbs.length > 1 ? "DBs" : "DB"}
                  </span>
                </SelectLabel>
                {dbs.map((db) => {
                  const dbActivities = getActiveActivitiesForDb(db.name);
                  return (
                    <SelectItem
                      key={db.name}
                      value={db.name}
                      className="rounded-md py-1.5 px-2.5 pl-8 cursor-pointer focus:bg-cyan-500/10 focus:text-foreground text-foreground/90 transition-all border-b border-border/50 last:border-b-0 hover:bg-muted/30 pb-1.5 my-0.5"
                    >
                      <div className="flex flex-col gap-0.5 w-full">
                        {/* Top Row: Crisp DB Name + Activity Spinner + Health Status Dot */}
                        <div className="flex items-center justify-between gap-2 w-full">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-xs sm:text-[13.5px] tracking-tight text-foreground group-focus:text-cyan-600 dark:group-focus:text-cyan-300 truncate">
                              {db.name}
                            </span>
                            {dbActivities.length > 0 && (
                              <div
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-300 shrink-0"
                                title={dbActivities.map((a) => a.description).join(", ")}
                              >
                                <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />
                                <div className="flex items-center gap-0.5">
                                  {dbActivities.map((act) => (
                                    <span
                                      key={act.type}
                                      className={cn(
                                        "px-1 py-0 text-[8px] font-black rounded uppercase tracking-tight border",
                                        act.colorClass
                                      )}
                                    >
                                      {act.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={cn("h-2 w-2 rounded-full shrink-0", getStatusDotStyle(db.status))} />
                          </div>
                        </div>

                        {/* Subtitle Row: Division + OS + Security Posture */}
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                          <span className="flex items-center gap-1 font-semibold text-foreground/80">
                            <Building2 className="h-3 w-3 text-cyan-600 dark:text-cyan-400 shrink-0" />
                            <span>{db.division || "PCPB"}</span>
                          </span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3 text-muted-foreground/80 shrink-0" />
                            <span>{db.os}</span>
                          </span>
                          {db.security_posture_outdated && (
                            <>
                              <span className="text-muted-foreground/40">•</span>
                              <span
                                className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold"
                                aria-label="Security posture is outdated"
                                title="Security posture is outdated"
                                data-testid="posture"
                              >
                                <ShieldAlert className="h-3 w-3 text-rose-500 shrink-0" />
                                Posture
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ))
          ) : (
            <div className="p-3 text-center text-xs text-muted-foreground space-y-0.5">
              <p className="font-semibold text-foreground/80">No databases found</p>
              <p className="text-[10px]">Try adjusting search or filter.</p>
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}


