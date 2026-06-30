"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fetchActiveDbas } from "@/services/api";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

interface ActiveDbaState {
  active_shifts: number[];
  shift_label: string;
  overlap: boolean;
  active_dbas: Array<{ session_id: number; username: string; shift_number: 1 | 2 | 3 }>;
}

export function ActiveDbaPill() {
  const [state, setState] = useState<ActiveDbaState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchActiveDbas();
        if (!cancelled) {
          setState(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error || !state) {
    return (
      <div className="hidden items-center gap-1.5 rounded-md border border-border/70 bg-background/40 px-2.5 py-1.5 text-xs text-muted-foreground sm:flex">
        <Radio className="h-3 w-3 opacity-50" />
        <span>On shift: —</span>
      </div>
    );
  }

  const dbaNames = state.active_dbas.map((d) => d.username);
  const label = dbaNames.length > 0 ? dbaNames.join(", ") : "No DBA on shift";

  return (
    <div
      className={cn(
        "hidden items-center gap-1.5 rounded-md border bg-background/40 px-2.5 py-1.5 text-xs sm:flex",
        dbaNames.length > 0
          ? "border-green-500/30 text-green-300"
          : "border-border/70 text-muted-foreground"
      )}
      title={`Current shift: ${state.shift_label}`}
    >
      <Radio className={cn("h-3 w-3 shrink-0", dbaNames.length > 0 && "animate-pulse text-green-400")} />
      <span className="whitespace-nowrap">
        On shift: <strong>{label}</strong>
      </span>
      {state.overlap && (
        <Badge className="ml-1 border-amber-500/30 bg-amber-500/10 px-1 py-0 text-[10px] text-amber-300">
          overlap
        </Badge>
      )}
    </div>
  );
}
