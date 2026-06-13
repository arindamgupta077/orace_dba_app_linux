import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { STATUS_COLOR } from "@/lib/constants";
import { cn, titleCase } from "@/lib/utils";
import type { DbaStatus } from "@/types/dba";

export function StatusBadge({ status, className, children }: { status: DbaStatus | string; className?: string; children?: ReactNode }) {
  const safeStatus = status || "unknown";
  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_COLOR[safeStatus] || STATUS_COLOR.unknown, className)}>
      {children || titleCase(safeStatus)}
    </Badge>
  );
}
