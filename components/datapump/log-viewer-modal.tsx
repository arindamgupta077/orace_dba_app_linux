"use client";

import { useEffect } from "react";
import { FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { useDbaAction } from "@/hooks/use-dba-action";
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

  const isLoading = status === "loading";

  const fetchLog = () => {
    runAction(action, {}, selectedDb).catch(() => {});
  };

  useEffect(() => {
    if (open) fetchLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const logText =
    response?.raw_output ||
    (response?.raw_data as Record<string, unknown> | undefined)?.log as string ||
    "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-2">
              <FileText className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-3 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-200">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
              <div>
                <p className="font-medium">Fetching latest log…</p>
                <p className="text-xs text-muted-foreground">n8n is reading the log file via SSH</p>
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
              <p>{error}</p>
            </div>
          )}

          {!isLoading && logText && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <TerminalViewer output={logText} title={title} />
            </div>
          )}

          {!isLoading && !logText && !error && (
            <div className="rounded-xl border border-border/50 bg-secondary/20 py-12 text-center text-sm text-muted-foreground">
              No log content returned
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/50 pt-4">
          <Button variant="outline" size="sm" onClick={fetchLog} disabled={isLoading} className="gap-2">
            <RefreshCw className={"h-3.5 w-3.5" + (isLoading ? " animate-spin" : "")} />
            Refresh Log
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
