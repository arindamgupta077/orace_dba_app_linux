import { redirect } from "next/navigation";

import { requireAuthenticatedSession } from "@/lib/server/session";
import { AdminPanelTabs } from "@/components/admin/admin-panel/admin-panel-tabs";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuthenticatedSession();
  if (!session || session.user.role !== "app_admin") {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <AdminPanelTabs />
      </div>
      {children}
    </div>
  );
}