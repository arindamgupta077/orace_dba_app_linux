"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardCheck, ClipboardList } from "lucide-react";

import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dba-console/shift-management", label: "Shift Management", icon: ClipboardCheck, adminOnly: false },
  { href: "/dba-console/daily-checklist", label: "Daily Checklist", icon: ClipboardList, adminOnly: false },
  { href: "/dba-console/shift-report", label: "Shift Report", icon: BarChart3, adminOnly: true }
];

export function DbaConsoleTabs() {
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);
  const isAppAdmin = user?.role === "app_admin";

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAppAdmin);

  return (
    <nav className="flex flex-wrap gap-2">
      {visibleTabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "group flex items-center gap-2 rounded-lg border border-border/70 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-secondary/60 hover:text-foreground",
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
          </Link>
        );
      })}
    </nav>
  );
}
