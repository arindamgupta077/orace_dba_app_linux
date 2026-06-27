"use client";

import { DatabaseZap } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/visual/status-badge";
import { useAppStore } from "@/store/use-app-store";

export function DatabaseSelector() {
  const databases = useAppStore((state) => state.databases);
  const selectedDb = useAppStore((state) => state.selectedDb);
  const setSelectedDb = useAppStore((state) => state.setSelectedDb);
  const selected = databases.find((db) => db.name === selectedDb);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/40 p-2">
      <DatabaseZap className="h-4 w-4 shrink-0 text-cyan-300" />
      <Select value={selectedDb} onValueChange={setSelectedDb} disabled={!databases.length}>
        <SelectTrigger className="h-8 min-w-36 border-0 bg-transparent px-1 focus:ring-0">
          <SelectValue placeholder={databases.length ? "Database" : "No databases"} />
        </SelectTrigger>
        <SelectContent>
          {databases.map((db) => (
            <SelectItem key={db.name} value={db.name}>
              {db.name} - {db.env_label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? <StatusBadge status={selected.status} className="hidden sm:inline-flex" /> : null}
    </div>
  );
}
