"use client";

import { useMemo, useState } from "react";
import { Eye, Search, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/visual/status-badge";
import type { SessionRow } from "@/types/dba";

export function SessionTable({ rows, onKill }: { rows: SessionRow[]; onKill?: (row: SessionRow) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SessionRow | null>(null);

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return rows.filter((row) =>
      [row.username, row.machine, row.program, row.wait_event, row.sql_id, `${row.sid}`].some((value) => value.toLowerCase().includes(needle))
    );
  }, [query, rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" className="pl-9" />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SID</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Machine</TableHead>
            <TableHead>Wait Event</TableHead>
            <TableHead>Wait</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow key={`${row.sid}-${row.serial}`}>
              <TableCell className="font-mono">{row.sid},{row.serial}</TableCell>
              <TableCell>{row.username}</TableCell>
              <TableCell>{row.machine}</TableCell>
              <TableCell className={row.wait_event.includes("lock") ? "text-amber-300" : ""}>{row.wait_event}</TableCell>
              <TableCell>{row.seconds_in_wait}s</TableCell>
              <TableCell>
                <StatusBadge status={row.status === "ACTIVE" ? "healthy" : "unknown"} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setSelected(row)} title="Session details">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="destructive" size="icon" onClick={() => onKill?.(row)} title="Kill session">
                    <ShieldX className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Session Details</DialogTitle>
            <DialogDescription>{selected?.username} on {selected?.machine}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {Object.entries(selected).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border/70 bg-secondary/30 p-3">
                  <p className="text-xs uppercase text-muted-foreground">{key}</p>
                  <p className="mt-1 break-words font-mono">{String(value)}</p>
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
