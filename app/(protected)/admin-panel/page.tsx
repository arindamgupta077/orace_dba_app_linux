import { redirect } from "next/navigation";

import { AdminPanel } from "@/components/admin/admin-panel";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AdminPanelPage() {
  const session = await requireAuthenticatedSession();
  if (!session || session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return <AdminPanel />;
}
