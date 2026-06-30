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
        description="Operational dashboard with attendance, login trends, handover status, and checklist completion metrics. Export data as CSV."
        icon={BarChart3}
      />
      <ShiftReportSection />
    </>
  );
}
