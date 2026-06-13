import { GitBranch, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/visual/status-badge";

export function LockTreeView({ rows }: { rows: Array<Record<string, string | number>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-cyan-300" />
          Blocking Tree
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => (
          <div key={`${row.blocker_sid}-${row.waiter_sid}`} className="grid gap-3 rounded-lg border border-border/70 bg-secondary/30 p-4 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Blocker</p>
              <p className="mt-1 font-mono text-red-200">SID {row.blocker_sid}</p>
            </div>
            <Link2 className="hidden h-5 w-5 text-amber-300 md:block" />
            <div>
              <p className="text-xs uppercase text-muted-foreground">Waiter</p>
              <p className="mt-1 font-mono text-cyan-200">SID {row.waiter_sid}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.object} / {row.mode}</p>
            </div>
            <StatusBadge status={Number(row.wait_min) > 10 ? "critical" : "warning"} className="w-fit" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
