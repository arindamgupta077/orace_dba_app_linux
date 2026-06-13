"use client";

import {
  DatabaseZap,
  HardDrive,
  Radio,
  Settings2,
  Terminal
} from "lucide-react";
import { useState } from "react";
import { DbControlPanel } from "@/components/general-admin/db-control-panel";
import { ListenerControlPanel } from "@/components/general-admin/listener-control-panel";
import { QueryPanel } from "@/components/general-admin/query-panel";
import { cn } from "@/lib/utils";

type TabKey = "db-control" | "listener-control" | "query";

interface Tab {
  key: TabKey;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  description: string;
  badgeColor: string;
}

const TABS: Tab[] = [
  {
    key: "db-control",
    label: "Database Control",
    shortLabel: "DB Control",
    icon: DatabaseZap,
    description: "Start, stop, mount and check the Oracle database instance via SSH",
    badgeColor: "from-cyan-500 to-blue-600"
  },
  {
    key: "listener-control",
    label: "Listener Control",
    shortLabel: "Listener",
    icon: Radio,
    description: "Manage the Oracle Net Listener via lsnrctl over SSH",
    badgeColor: "from-violet-500 to-purple-600"
  },
  {
    key: "query",
    label: "Execute Query",
    shortLabel: "Query",
    icon: Terminal,
    description: "Run any SQL statement via sqlplus / as sysdba and view raw console output",
    badgeColor: "from-emerald-500 to-teal-600"
  }
];

export function GeneralAdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("db-control");
  const activeTabDef = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 shadow-lg">
          <Settings2 className="h-6 w-6 text-slate-200" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">General Administration</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Database lifecycle control, listener management, and ad-hoc SQL execution via SSH
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-border/60 bg-muted/20 p-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              id={`general-admin-tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-background text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {/* Icon with gradient background when active */}
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md transition-all",
                  isActive
                    ? `bg-gradient-to-br ${tab.badgeColor} text-white shadow-sm`
                    : "text-muted-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Active tab description banner */}
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 px-4 py-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white",
            activeTabDef.badgeColor
          )}
        >
          <activeTabDef.icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{activeTabDef.label}</p>
          <p className="text-xs text-muted-foreground">{activeTabDef.description}</p>
        </div>
        <div className="ml-auto hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-mono">
          <HardDrive className="h-3 w-3" />
          SSH → Oracle Server
        </div>
      </div>

      {/* Panel content */}
      <div>
        {activeTab === "db-control" && <DbControlPanel />}
        {activeTab === "listener-control" && <ListenerControlPanel />}
        {activeTab === "query" && <QueryPanel />}
      </div>
    </div>
  );
}
