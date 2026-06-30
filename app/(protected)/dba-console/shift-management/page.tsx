import { PageHeader } from "@/components/layout/page-header";
import { ShiftManagementSection } from "@/components/admin/dba-console/shift-management-section";
import { ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default function ShiftManagementPage() {
  return (
    <>
      <PageHeader
        title="Shift Management"
        description="Login to your shift, write handover notes, and acknowledge handovers from fellow DBAs. The current shift is determined automatically from server time."
        icon={ClipboardCheck}
      />
      <ShiftManagementSection />
    </>
  );
}
