import { redirect } from "next/navigation";

import { DbInventory } from "@/components/admin/db-inventory";
import { requireAuthenticatedSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function DbInventoryPage() {
  const session = await requireAuthenticatedSession();
  if (!session || session.user.role !== "app_admin") {
    redirect("/dashboard");
  }

  return <DbInventory />;
}
