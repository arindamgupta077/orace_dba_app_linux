import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ShiftReportSection } from "@/components/admin/dba-console/shift-report-section";
import { requireAuthenticatedSession } from "@/lib/server/session";
import { BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ShiftReportPage() {
  const session = await requireAuthenticatedSession();
  if (!session || session.user.role !== "app_admin") {
    redirect("/dba-console/shift-management");
  }

  return (
    <>
      <PageHeader
        title="Shift Report"
        description="Manager-grade operational dashboard: shift coverage, checklist compliance, exceptions, and audit-ready PDF/Excel exports (login/logout, checklists, handovers)."
        descriptionClassName="max-w-none whitespace-nowrap"
        icon={BarChart3}
      />
      <ShiftReportSection />
    </>
  );
}
