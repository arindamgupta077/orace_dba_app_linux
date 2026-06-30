import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, ClipboardCheck, BarChart3 } from "lucide-react";

import { requireAuthenticatedSession } from "@/lib/server/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const tabs = [
  { href: "/dba-console/shift-management", label: "Shift Management", icon: ClipboardCheck },
  { href: "/dba-console/daily-checklist", label: "Daily Checklist", icon: ClipboardList },
  { href: "/dba-console/shift-report", label: "Shift Report", icon: BarChart3 }
];

export default async function DbaConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthenticatedSession();
  if (!session || (session.user.role !== "app_admin" && session.user.role !== "dba_admin")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/70 pb-3">
        <h1 className="text-xl font-bold">DBA Console</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border/70 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
