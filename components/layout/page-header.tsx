import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  descriptionClassName?: string;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actionLabel,
  onAction,
  actionDisabled,
  descriptionClassName,
  children
}: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <span className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-2 text-cyan-200">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className={cn("mt-1 max-w-3xl text-sm text-muted-foreground", descriptionClassName)}>{description}</p>
        </div>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {children}
        </div>
      ) : actionLabel && onAction ? (
        <Button onClick={onAction} disabled={actionDisabled}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
