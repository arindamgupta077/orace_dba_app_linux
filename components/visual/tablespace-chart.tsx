"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DbaStatus, TablespaceRow } from "@/types/dba";

const STATUS_COLORS: Record<DbaStatus, string> = {
  healthy: "#18c37e",
  warning: "#ffb020",
  critical: "#ff312e",
  unknown: "#8ea3b8"
};

interface ChartRow extends TablespaceRow {
  total_gb: number;
}

function buildChartData(rows: TablespaceRow[]): ChartRow[] {
  return [...rows]
    .sort((a, b) => b.pct_used - a.pct_used)
    .map((row) => ({
      ...row,
      total_gb: +(row.used_gb + row.free_gb).toFixed(1)
    }));
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 p-3 text-xs shadow-2xl backdrop-blur-md min-w-[170px] z-50 text-slate-800 dark:text-slate-100">
      <p className="font-bold text-slate-900 dark:text-slate-100 text-sm font-mono tracking-tight mb-2 border-b border-slate-200 dark:border-slate-800 pb-1.5">{d.name}</p>
      <div className="flex flex-col gap-1.5">
        <Row label="Utilization" value={`${d.pct_used.toFixed(1)}%`} color={STATUS_COLORS[d.status]} />
        <Row label="Used" value={`${d.used_gb.toFixed(1)} GB`} />
        <Row label="Free" value={`${d.free_gb.toFixed(1)} GB`} />
        <Row label="Total" value={`${d.total_gb.toFixed(1)} GB`} />
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-slate-500 dark:text-slate-400 text-xs">{label}</span>
      <span className={cn("text-xs font-medium tabular-nums", color ? "font-bold" : "text-slate-700 dark:text-slate-300")} style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

export function TablespaceChartContent({ rows }: { rows: TablespaceRow[] }) {
  if (!rows.length) return null;

  const data = buildChartData(rows);
  const chartHeight = Math.max(190, data.length * 56 + 60);

  const statusCounts = data.reduce<Partial<Record<DbaStatus, number>>>(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {}
  );

  return (
    <div className="space-y-4">
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 16, right: 52, bottom: 20, left: 90 }}
            barCategoryGap="38%"
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgba(142,163,184,0.1)" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              stroke="#8ea3b8"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: "rgba(142,163,184,0.2)" }}
              ticks={[0, 20, 40, 60, 80, 90, 100]}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#8ea3b8"
              fontSize={11}
              width={85}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <ReferenceLine
              x={80}
              stroke="#ffb020"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{ value: "80%", position: "insideTopLeft", fill: "#ffb020", fontSize: 10, dy: -6 }}
            />
            <ReferenceLine
              x={90}
              stroke="#ff312e"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{ value: "90%", position: "insideTopLeft", fill: "#ff312e", fontSize: 10, dy: -6 }}
            />
            <Bar dataKey="pct_used" name="Used %" radius={[0, 5, 5, 0]} maxBarSize={22}>
              {data.map((entry, i) => (
                <Cell key={`cell-${i}`} fill={STATUS_COLORS[entry.status]} fillOpacity={0.9} />
              ))}
              <LabelList
                dataKey="pct_used"
                position="right"
                formatter={(v: number) => `${v.toFixed(0)}%`}
                style={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/40 pt-3 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {(["critical", "warning", "healthy", "unknown"] as DbaStatus[]).map((status) => {
            const count = statusCounts[status];
            if (!count) return null;
            return (
              <span key={status} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: STATUS_COLORS[status] }}
                />
                <span className="capitalize text-muted-foreground">
                  {status}:{" "}
                  <span className="font-semibold text-foreground">{count}</span>
                </span>
              </span>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0"
              style={{ width: 18, borderTop: "2px dashed #ffb020", display: "inline-block" }}
            />
            <span className="text-muted-foreground">Warning 80%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0"
              style={{ width: 18, borderTop: "2px dashed #ff312e", display: "inline-block" }}
            />
            <span className="text-muted-foreground">Critical 90%</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function TablespaceChart({ rows }: { rows: TablespaceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tablespace Utilization</CardTitle>
      </CardHeader>
      <CardContent>
        <TablespaceChartContent rows={rows} />
      </CardContent>
    </Card>
  );
}
