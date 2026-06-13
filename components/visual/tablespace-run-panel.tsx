"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart2, Clock, Loader2, RefreshCcw, Table2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TablespaceChartContent } from "@/components/visual/tablespace-chart";
import { StatusBadge } from "@/components/visual/status-badge";
import { cn, formatDateTime } from "@/lib/utils";
import { fetchTablespaceRuns } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import type { TablespaceRow } from "@/types/dba";

interface RunData {
  rows: TablespaceRow[];
  lastRunAt: string | null;
  lastRunBy: string | null;
  hasData: boolean;
}

export function TablespaceRunPanel() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const tablespaceRefreshTrigger = useAppStore((state) => state.tablespaceRefreshTrigger);

  const [runData, setRunData] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (showSuccessToast = false) => {
    setLoading(true);
    try {
      const result = await fetchTablespaceRuns(selectedDb);
      setRunData({
        rows: result.rows,
        lastRunAt: result.last_run_at,
        lastRunBy: result.last_run_by,
        hasData: result.has_data
      });
      if (showSuccessToast) toast.success("Tablespace data refreshed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tablespace data.");
    } finally {
      setLoading(false);
    }
  }, [selectedDb]);

  // Clear stale report data when the selected database changes
  useEffect(() => {
    setRunData(null);
  }, [selectedDb]);

  // Initial data load and refresh on db change / manual trigger
  useEffect(() => {
    loadData();
  }, [loadData, tablespaceRefreshTrigger]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <CardTitle className="text-base">Tablespace Utilization Report</CardTitle>
              {selectedDb && (
                <span className="rounded border border-border/60 bg-secondary/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {selectedDb}
                </span>
              )}
            </div>
            {runData?.hasData ? (
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {runData.lastRunAt && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Last run:&nbsp;
                    <span className="font-medium text-foreground" title={runData.lastRunAt}>
                      {formatDateTime(runData.lastRunAt)}
                    </span>
                  </span>
                )}
                {runData.lastRunBy && (
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    Run by:&nbsp;
                    <span className="font-medium text-foreground">{runData.lastRunBy}</span>
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run a Tablespace Check for{" "}
                <span className="font-medium text-foreground">{selectedDb}</span> to populate this report.
              </p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={loading}
          >
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading && !runData ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tablespace data…
          </div>
        ) : !runData?.hasData ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground">
            No tablespace data yet. Run a Tablespace Check to see results here.
          </div>
        ) : (
          <Tabs defaultValue="chart">
            <TabsList>
              <TabsTrigger value="chart" className="gap-1.5">
                <BarChart2 className="h-3.5 w-3.5" />
                Chart View
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-1.5">
                <Table2 className="h-3.5 w-3.5" />
                Table View
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chart" className="mt-4">
              <TablespaceChartContent rows={runData.rows} />
            </TabsContent>

            <TabsContent value="table" className="mt-4">
              <TablespaceDataTable rows={runData.rows} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function TablespaceDataTable({ rows }: { rows: TablespaceRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-secondary/40">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tablespace</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Used&nbsp;GB</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Free&nbsp;GB</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Utilization</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.name}-${i}`}
              className="border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/20"
            >
              <td className="px-4 py-3 font-medium">{row.name}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.used_gb.toFixed(1)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.free_gb.toFixed(1)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Progress value={row.pct_used} className="h-1.5 flex-1" />
                  <span className="w-12 text-right tabular-nums text-xs text-muted-foreground">
                    {row.pct_used.toFixed(1)}%
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-center">
                  <StatusBadge status={row.status} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
