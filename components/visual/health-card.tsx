import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/visual/status-badge";
import { cn } from "@/lib/utils";
import type { DbaStatus } from "@/types/dba";

interface HealthCardProps {
  title: string;
  value: string | number;
  detail: string;
  status: DbaStatus;
  trend?: "up" | "down" | "flat";
  icon: LucideIcon;
}

export function HealthCard({ title, value, detail, status, trend = "flat", icon: Icon }: HealthCardProps) {
  const TrendIcon = trend === "down" ? ArrowDownRight : ArrowUpRight;

  return (
    <Card className="scan-line">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{title}</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-2xl font-semibold">{value}</span>
              <StatusBadge status={status} />
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-secondary/60 p-2 text-cyan-200">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {trend !== "flat" ? (
            <TrendIcon className={cn("h-4 w-4", trend === "up" ? "text-amber-300" : "text-emerald-300")} />
          ) : (
            <span className="h-2 w-2 rounded-full bg-cyan-300" />
          )}
          <span>{detail}</span>
        </div>
      </CardContent>
    </Card>
  );
}
