"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  XCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { useDbaAction } from "@/hooks/use-dba-action";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { DbaAction } from "@/types/dba";

interface LogViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: DbaAction; // "expdp_check_log" | "impdp_check_log"
  title: string;
  description: string;
}

export function LogViewerModal({ open, onOpenChange, action, title, description }: LogViewerModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const { runAction, status, response, error } = useDbaAction();

  const [logfileParam, setLogfileParam] = useState("");
  const [lineLimit, setLineLimit] = useState("1000");
  const [filterText, setFilterText] = useState("");
  const [filterPreset, setFilterPreset] = useState<"all" | "errors" | "warnings">("all");
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const isLoading = status === "loading";

  const fetchLog = () => {
    const params: Record<string, unknown> = {};
    if (logfileParam.trim()) {
      params.logfile = logfileParam.trim();
    }
    if (lineLimit && lineLimit !== "all") {
      params.lines = Number(lineLimit);
    }
    runAction(action, params, selectedDb)
      .then(() => setLastFetchedAt(new Date()))
      .catch(() => {});
  };

  useEffect(() => {
    if (open) {
      setLogfileParam(action === "expdp_check_log" ? "exp.log" : "imp.log");
      setFilterText("");
      setFilterPreset("all");
      fetchLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  // Extract raw log text safely from n8n response
  const rawLogText = useMemo(() => {
    if (!response) return "";
    return (
      response.raw_output ||
      (response.raw_data as Record<string, unknown> | undefined)?.log as string ||
      (response.raw_data as Record<string, unknown> | undefined)?.stdout as string ||
      (response.raw_data as Record<string, unknown> | undefined)?.output as string ||
      ""
    );
  }, [response]);

  // Split lines and calculate metrics
  const lines = useMemo(() => (rawLogText ? rawLogText.split("\n") : []), [rawLogText]);
  const totalLines = lines.length;

  const errorCount = useMemo(() => {
    return lines.filter((l) => /ORA-|ERROR|FAILED|SEVERE/i.test(l)).length;
  }, [lines]);

  const warningCount = useMemo(() => {
    return lines.filter((l) => /WARNING|W-/i.test(l)).length;
  }, [lines]);

  // Filtered log text based on search and presets
  const displayedLog = useMemo(() => {
    if (!rawLogText) return "";
    let filtered = lines;

    if (filterPreset === "errors") {
      filtered = filtered.filter((l) => /ORA-|ERROR|FAILED|SEVERE/i.test(l));
    } else if (filterPreset === "warnings") {
      filtered = filtered.filter((l) => /WARNING|W-/i.test(l));
    }

    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      filtered = filtered.filter((l) => l.toLowerCase().includes(q));
    }

    return filtered.join("\n");
  }, [rawLogText, lines, filterPreset, filterText]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] h-[94vh] max-w-[96vw] w-[96vw] overflow-hidden flex flex-col p-4 md:p-6 bg-background/95 backdrop-blur-xl border border-cyan-500/20 shadow-2xl">
        <DialogHeader className="pb-3 border-b border-border/50 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-2.5 shadow-sm">
                <FileText className="h-6 w-6 text-cyan-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-xl font-bold tracking-tight">{title}</DialogTitle>
                  <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-mono text-xs gap-1">
                    <Database className="h-3 w-3" />
                    {selectedDb || "PROD"}
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {description} — Fetched directly from Oracle server via n8n automation
                </DialogDescription>
              </div>
            </div>

            {/* Top controls: Log file name, lines, refresh */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1">
                <span className="text-[11px] font-medium text-muted-foreground">Log File:</span>
                <Input
                  value={logfileParam}
                  onChange={(e) => setLogfileParam(e.target.value)}
                  placeholder="e.g. exp.log"
                  className="h-7 w-32 text-xs font-mono border-none bg-transparent focus-visible:ring-0 p-0"
                />
              </div>

              <Select value={lineLimit} onValueChange={setLineLimit}>
                <SelectTrigger className="h-8 w-32 text-xs font-mono">
                  <SelectValue placeholder="Lines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="200">Tail 200 lines</SelectItem>
                  <SelectItem value="500">Tail 500 lines</SelectItem>
                  <SelectItem value="1000">Tail 1,000 lines</SelectItem>
                  <SelectItem value="5000">Tail 5,000 lines</SelectItem>
                  <SelectItem value="all">Full Log File</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchLog}
                disabled={isLoading}
                className="h-8 gap-1.5 bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 text-xs"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                Fetch Log
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Toolbar & Live Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-2 shrink-0 border-b border-border/40 bg-secondary/10 px-3 rounded-lg my-1">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search / filter log (e.g. ORA-, TABLE, COMPLETED)..."
              className="h-8 pl-8 pr-8 text-xs font-mono bg-background/60"
            />
            {filterText && (
              <button
                onClick={() => setFilterText("")}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Preset Chips */}
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setFilterPreset("all")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border",
                filterPreset === "all"
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                  : "border-border/50 text-muted-foreground hover:bg-secondary/40"
              )}
            >
              All Lines ({totalLines.toLocaleString()})
            </button>
            <button
              onClick={() => setFilterPreset("errors")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 border",
                filterPreset === "errors"
                  ? "bg-red-500/20 text-red-300 border-red-500/40"
                  : errorCount > 0
                  ? "border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/10"
                  : "border-border/50 text-muted-foreground hover:bg-secondary/40"
              )}
            >
              <AlertCircle className="h-3 w-3 text-red-400" />
              Errors ({errorCount})
            </button>
            <button
              onClick={() => setFilterPreset("warnings")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 border",
                filterPreset === "warnings"
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : warningCount > 0
                  ? "border-amber-500/30 text-amber-400 bg-amber-500/5 hover:bg-amber-500/10"
                  : "border-border/50 text-muted-foreground hover:bg-secondary/40"
              )}
            >
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              Warnings ({warningCount})
            </button>
          </div>

          {/* Last Updated Timestamp */}
          {lastFetchedAt && (
            <span className="text-[11px] text-muted-foreground font-mono">
              Last fetched: {lastFetchedAt.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Main Terminal Area */}
        <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col mt-1">
          {isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-8 text-cyan-200">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mb-3" />
              <p className="font-semibold text-base">Fetching log file from n8n…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connecting via SSH to {selectedDb} server to extract {logfileParam || "latest log"}
              </p>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100 my-auto">
              <XCircle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="font-semibold">Log fetch failed</p>
                <p className="text-xs opacity-90 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {!isLoading && displayedLog && (
            <div className="flex-1 min-h-0 h-full w-full overflow-hidden">
              <TerminalViewer output={displayedLog} title={title} className="flex-1 h-full min-h-[500px] w-full" />
            </div>
          )}

          {!isLoading && !displayedLog && !error && (
            <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-border/50 bg-secondary/10 py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No log content returned</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Ensure a Data Pump operation has run on {selectedDb} or click &quot;Fetch Log&quot;
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <DialogFooter className="pt-3 border-t border-border/50 shrink-0 flex items-center justify-between w-full">
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            <span>Size: {Math.round((rawLogText.length / 1024) * 10) / 10} KB</span>
            <span>•</span>
            <span>
              Lines shown: {displayedLog ? displayedLog.split("\n").length.toLocaleString() : 0} / {totalLines.toLocaleString()}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close Viewer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
