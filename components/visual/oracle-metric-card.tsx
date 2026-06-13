import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface OracleMetricCardProps {
  label: string;
  value: number;
  suffix?: string;
  icon: LucideIcon;
  tone?: "red" | "cyan" | "green" | "amber";
}

const toneMap = {
  red: "text-red-300",
  cyan: "text-cyan-300",
  green: "text-emerald-300",
  amber: "text-amber-300"
};

export function OracleMetricCard({ label, value, suffix = "%", icon: Icon, tone = "cyan" }: OracleMetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className={cn("h-4 w-4", toneMap[tone])} />
        </div>
        <div className="mt-4 flex items-end gap-1">
          <span className="text-3xl font-semibold">{value}</span>
          <span className="pb-1 text-sm text-muted-foreground">{suffix}</span>
        </div>
        <Progress value={value} className="mt-4 h-2" />
      </CardContent>
    </Card>
  );
}
