import { CheckCircle2, Clock3, Circle, XCircle } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import type { ApprovalStep } from "@/types/dba";

const iconMap = {
  done: CheckCircle2,
  current: Clock3,
  pending: Circle,
  failed: XCircle
};

export function ApprovalTimeline({ steps }: { steps: ApprovalStep[] }) {
  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const Icon = iconMap[step.status];
        return (
          <div key={step.label} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border",
                step.status === "done" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
                step.status === "current" && "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
                step.status === "pending" && "border-slate-400/25 bg-slate-400/10 text-slate-400",
                step.status === "failed" && "border-red-400/40 bg-red-500/10 text-red-300"
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium">{step.label}</p>
              {step.timestamp ? <p className="text-xs text-muted-foreground">{formatDateTime(step.timestamp)}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
