"use client";

import { FileWarning } from "lucide-react";
import { AlertLogPage } from "@/components/action/alert-log-page";

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 border border-primary/20 text-primary">
          <FileWarning className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Alert Log</h1>
          <p className="text-sm text-muted-foreground">
            Oracle alert monitoring · real-time ORA-error tracking · integrated n8n automation
          </p>
        </div>
      </div>

      <AlertLogPage />
    </div>
  );
}
