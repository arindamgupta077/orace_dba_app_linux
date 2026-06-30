import { redirect } from "next/navigation";
import { Terminal } from "lucide-react";

import { requireAuthenticatedSession } from "@/lib/server/session";
import { DbaConsoleTabs } from "@/components/admin/dba-console/dba-console-tabs";

export const dynamic = "force-dynamic";

export default async function DbaConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthenticatedSession();
  if (!session || (session.user.role !== "app_admin" && session.user.role !== "dba_admin")) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="dba-hero-gradient flex flex-col gap-4 rounded-xl border border-border/70 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-2.5 text-cyan-200 shadow-[0_0_18px_rgba(35,211,238,0.12)]">
            <Terminal className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">DBA Console</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Shift management, daily operational checklists, and reporting for DBA teams.
            </p>
          </div>
        </div>
        <DbaConsoleTabs />
      </div>
      {children}
    </div>
  );
}
