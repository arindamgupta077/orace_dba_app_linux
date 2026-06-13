"use client";

import { Users } from "lucide-react";
import { ActionWorkspace } from "@/components/action/action-workspace";
import { getActionDefinition } from "@/lib/action-catalog";
import type { DbaAction } from "@/types/dba";

export default function SessionsPage() {
  const actions = (["session_list", "long_queries", "kill_session", "lock_check"] as DbaAction[]).map((action) => getActionDefinition(action)!);
  return (
    <ActionWorkspace
      title="Session Monitoring"
      description="Real-time session visibility, wait-event highlighting, detail drawers, long-query detection, and approved session termination."
      icon={Users}
      primaryAction="session_list"
      actions={actions}
    />
  );
}
