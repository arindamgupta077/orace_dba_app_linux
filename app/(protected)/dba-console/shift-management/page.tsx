import { PageHeader } from "@/components/layout/page-header";
import { ShiftManagementSection } from "@/components/admin/dba-console/shift-management-section";
import { ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default function ShiftManagementPage() {
  return (
    <>
      <PageHeader
        title="Shift Management"
        description="Login to your shift, write handover notes, get acknowledgement from fellow DBA and logout "
        icon={ClipboardCheck}
      />
      <ShiftManagementSection />
    </>
  );
}
