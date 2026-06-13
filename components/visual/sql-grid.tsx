"use client";

import { useState } from "react";
import { Code2, Eye } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SqlMetricRow } from "@/types/dba";

export function SQLGrid({ rows }: { rows: SqlMetricRow[] }) {
  const [selected, setSelected] = useState<SqlMetricRow | null>(null);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <div className="rounded-lg border border-border/70 bg-background/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SQL ID</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Execs</TableHead>
              <TableHead>CPU ms</TableHead>
              <TableHead>Buffer Gets</TableHead>
              <TableHead className="text-right">Text</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.sql_id}>
                <TableCell className="font-mono text-cyan-200">{row.sql_id}</TableCell>
                <TableCell>{row.module}</TableCell>
                <TableCell>{row.executions}</TableCell>
                <TableCell>{row.cpu_ms.toLocaleString()}</TableCell>
                <TableCell>{row.buffer_gets.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setSelected(row)} title="Open SQL text">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="h-80 rounded-lg border border-border/70 bg-background/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Code2 className="h-4 w-4 text-cyan-300" />
          CPU Time
        </div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={rows} margin={{ left: -10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(142,163,184,0.18)" />
            <XAxis dataKey="sql_id" stroke="#8ea3b8" fontSize={11} />
            <YAxis stroke="#8ea3b8" fontSize={11} />
            <Tooltip contentStyle={{ background: "#101722", border: "1px solid rgba(142,163,184,.25)", borderRadius: 8 }} />
            <Bar dataKey="cpu_ms" fill="#23d3ee" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SQL Text {selected?.sql_id}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto rounded-md border border-border/70 bg-black/40 p-4 text-sm text-cyan-100">
            {selected?.sql_text}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
