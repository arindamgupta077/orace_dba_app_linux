import { redirect } from "next/navigation";

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
      <div className="flex justify-center">
        <DbaConsoleTabs />
      </div>
      {children}
    </div>
  );
}
