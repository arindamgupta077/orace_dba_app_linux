"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DatabaseZap, ShieldAlert, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import { fetchPendingApprovalCount } from "@/services/api";

const BASE_TABS = [
  { href: "/admin-panel/database-inventory", label: "DATABASE INVENTORY", icon: DatabaseZap },
  { href: "/admin-panel/app-users",          label: "APP USER MANAGEMENT", icon: Users },
  { href: "/admin-panel/pending-approvals",  label: "PENDING APPROVALS",   icon: ShieldAlert }
];

export function AdminPanelTabs() {
  const pathname    = usePathname();
  const user        = useAppStore((s) => s.user);
  const isAdmin     = user?.role === "app_admin";
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const load = async () => {
      try {
        const count = await fetchPendingApprovalCount();
        if (!cancelled) setPendingCount(count);
      } catch {
        // silently ignore — badge is non-critical
      }
    };

    void load();
    const interval = setInterval(load, 30_000); // refresh every 30 s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAdmin]);

  return (
    <nav className="flex flex-wrap gap-2">
      {BASE_TABS.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
        const isPendingTab = tab.href === "/admin-panel/pending-approvals";
        const showBadge    = isPendingTab && pendingCount > 0;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "group relative flex items-center gap-2 rounded-lg border border-border/70 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-secondary/60 hover:text-foreground",
              isActive && "dba-tab-active"
            )}
          >
            <tab.icon
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isActive ? "scale-110" : "group-hover:scale-105"
              )}
            />
            {tab.label}
            {isActive && (
              <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(35,211,238,0.6)]" />
            )}
            {showBadge && !isActive && (
              <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}