"use client";

import { Gauge } from "lucide-react";
import { ActionWorkspace } from "@/components/action/action-workspace";
import { getActionDefinition } from "@/lib/action-catalog";
import type { DbaAction } from "@/types/dba";

export default function SqlPerformancePage() {
  const actions = (["top_sql", "long_queries", "index_analysis", "stats_refresh"] as DbaAction[]).map((action) => getActionDefinition(action)!);
  return (
    <ActionWorkspace
      title="SQL Performance Center"
      description="Top SQL grids, execution metrics, CPU charts, buffer-get analysis, SQL text review, and AI optimization suggestions."
      icon={Gauge}
      primaryAction="top_sql"
      actions={actions}
    />
  );
}
