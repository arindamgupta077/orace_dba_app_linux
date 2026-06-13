"use client";

import { GitBranch } from "lucide-react";
import { ActionWorkspace } from "@/components/action/action-workspace";
import { getActionDefinition } from "@/lib/action-catalog";

export default function LocksPage() {
  const actions = [getActionDefinition("lock_check")!, getActionDefinition("session_list")!, getActionDefinition("kill_session")!];
  return (
    <ActionWorkspace
      title="Lock Monitoring"
      description="Visualize blockers, waiters, lock duration, and critical contention paths before controlled remediation."
      icon={GitBranch}
      primaryAction="lock_check"
      actions={actions}
    />
  );
}
