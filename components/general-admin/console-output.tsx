"use client";

import { CheckCircle2, ClipboardCopy, Loader2, Terminal, XCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ConsoleOutputProps {
  output: string | null;
  status: "idle" | "loading" | "success" | "error";
  action?: string;
  timestamp?: string;
  className?: string;
}

export function ConsoleOutput({ output, status, action, timestamp, className }: ConsoleOutputProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (status === "idle") return null;

  return (
    <div className={cn("keep-dark mt-5 rounded-xl overflow-hidden border border-border/60 shadow-xl", className)}>
      {/* Console header bar */}
      <div className="flex items-center justify-between gap-3 bg-[#161b22] border-b border-[#30363d] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {/* Traffic-light dots */}
          <span className="h-3 w-3 rounded-full bg-red-500/80" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          <div className="ml-2 flex items-center gap-2 text-xs text-slate-400 font-mono">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span>Console Output</span>
            {action && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-400/80">{action}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {timestamp && (
            <span className="hidden sm:block text-[10px] text-slate-600 font-mono">{timestamp}</span>
          )}
          {status === "success" && (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          {status === "error" && (
            <XCircle className="h-4 w-4 text-red-400" />
          )}
          {status === "loading" && (
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          )}
          {output && status !== "loading" && (
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
              title="Copy output"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
      </div>

      {/* Console body */}
      <div className="bg-[#0d1117] min-h-[140px] max-h-[480px] overflow-y-auto">
        {status === "loading" && (
          <div className="flex flex-col gap-3 px-5 py-8">
            <div className="flex items-center gap-3 text-slate-400 font-mono text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400 shrink-0" />
              <span className="animate-pulse">Executing command, please wait...</span>
            </div>
            {/* Blinking cursor */}
            <div className="flex items-center gap-1 pl-7 font-mono text-xs text-slate-600">
              <span>$</span>
              <span className="inline-block w-2 h-3.5 bg-amber-400/60 animate-pulse rounded-sm" />
            </div>
          </div>
        )}
        {(status === "success" || status === "error") && (
          <pre
            className={cn(
              "px-5 py-4 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words",
              status === "error" ? "text-red-300" : "text-emerald-300"
            )}
          >
            {output || "(no output returned)"}
          </pre>
        )}
      </div>

      {/* ─── Status footer ─────────────────────────────────────────────
          IMPORTANT: Only rendered AFTER execution completes.
          During "loading" we show a neutral amber bar — never red.
          ──────────────────────────────────────────────────────────── */}
      {status === "loading" && (
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono border-t bg-amber-950/30 border-amber-900/30 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Running...
        </div>
      )}
      {status === "success" && (
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono border-t bg-emerald-950/40 border-emerald-900/30 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Command completed successfully
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono border-t bg-red-950/40 border-red-900/30 text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          Command returned an error
        </div>
      )}
    </div>
  );
}
