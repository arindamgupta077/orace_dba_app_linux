import { PageHeader } from "@/components/layout/page-header";
import { DailyChecklistSection } from "@/components/admin/dba-console/daily-checklist-section";
import { ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default function DailyChecklistPage() {
  return (
    <>
      <PageHeader
        title="Daily Checklist"
        description="Verify database availability and backup status for each shift. Managers can maintain backup template definitions."
        icon={ClipboardList}
      />
      <DailyChecklistSection />
    </>
  );
}
