"use client";

import * as Icons from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/visual/status-badge";
import type { DbaActionDefinition } from "@/types/dba";

export function ActionCard({ definition, onRun }: { definition: DbaActionDefinition; onRun: (definition: DbaActionDefinition) => void }) {
  const Icon = (Icons[definition.icon as keyof typeof Icons] || Icons.Activity) as Icons.LucideIcon;

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 p-2 text-cyan-200">
            <Icon className="h-5 w-5" />
          </span>
          {definition.destructive ? <StatusBadge status="critical">Approval</StatusBadge> : null}
        </div>
        <div className="mt-4 flex-1">
          <p className="font-medium">{definition.title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{definition.description}</p>
        </div>
        <Button className="mt-4 w-full" variant="outline" onClick={() => onRun(definition)}>
          Run Action
        </Button>
      </CardContent>
    </Card>
  );
}
