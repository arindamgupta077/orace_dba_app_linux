"use client";

import { PackageX } from "lucide-react";
import { ActionWorkspace } from "@/components/action/action-workspace";
import { getActionDefinition } from "@/lib/action-catalog";

export default function InvalidObjectsPage() {
  const actions = [getActionDefinition("invalid_objects")!, getActionDefinition("stats_refresh")!, getActionDefinition("health_report")!];
  return (
    <ActionWorkspace
      title="Invalid Objects Viewer"
      description="Inspect owner, type, status, DDL age, export results, and route recompilation-related work through approved automation."
      icon={PackageX}
      primaryAction="invalid_objects"
      actions={actions}
    />
  );
}
