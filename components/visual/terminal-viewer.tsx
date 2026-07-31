"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Expand, FileText, Minimize2, TerminalSquare } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/utils";

export function TerminalViewer({ output, title = "Raw Output", className }: { output?: string; title?: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"terminal" | "text">("terminal");

  const safeOutput = output || "";
  const lineCount = safeOutput ? safeOutput.split("\n").length : 0;

  useEffect(() => {
    if (viewMode !== "terminal" || !ref.current) return;
    const computedRows = Math.min(Math.max(lineCount, 25), 1000);
    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      fontFamily: "Consolas, Menlo, Monaco, 'Courier New', monospace",
      fontSize: 12,
      rows: computedRows,
      cols: 120,
      scrollback: Math.max(lineCount + 50000, 1000000),
      theme: {
        background: "#05070b",
        foreground: "#d8eef8",
        cursor: "#23d3ee",
        red: "#ff312e",
        green: "#18c37e",
        yellow: "#ffb020",
        blue: "#23d3ee"
      }
    });
    term.open(ref.current);
    term.write(safeOutput.replace(/\n/g, "\r\n"));
    termRef.current = term;
    return () => term.dispose();
  }, [safeOutput, fullscreen, viewMode, lineCount]);

  return (
    <div
      className={
        fullscreen
          ? "keep-dark fixed inset-3 z-[100] flex flex-col rounded-xl border border-cyan-500/30 bg-[#05070b] p-4 shadow-2xl backdrop-blur-2xl"
          : "keep-dark flex flex-col h-full w-full rounded-xl border border-border/70 bg-[#05070b]/95 overflow-hidden shadow-inner"
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-secondary/10 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-cyan-300">
          <TerminalSquare className="h-4 w-4 shrink-0 text-cyan-400" />
          <span>{title}</span>
          {lineCount > 0 && (
            <span className="ml-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200">
              {lineCount.toLocaleString()} lines
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-cyan-300 gap-1"
            onClick={() => setViewMode((m) => (m === "terminal" ? "text" : "terminal"))}
            title="Toggle view mode"
          >
            <FileText className="h-3.5 w-3.5" />
            {viewMode === "terminal" ? "Text View" : "Terminal View"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-cyan-300"
            onClick={() => navigator.clipboard.writeText(safeOutput)}
            title="Copy output"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-cyan-300"
            onClick={() => downloadText(`${title.toLowerCase().replace(/\s+/g, "_")}.log`, safeOutput)}
            title="Download output"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-cyan-300"
            onClick={() => setFullscreen((value) => !value)}
            title="Toggle fullscreen"
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {viewMode === "terminal" ? (
        <div
          ref={ref}
          className={
            fullscreen
              ? "flex-1 h-[calc(100vh-7rem)] w-full overflow-auto"
              : className || "max-h-[34rem] min-h-[16rem] w-full overflow-auto"
          }
        />
      ) : (
        <pre
          className={
            fullscreen
              ? "flex-1 h-[calc(100vh-7rem)] w-full overflow-auto p-4 font-mono text-xs text-cyan-200 bg-[#05070b] leading-relaxed whitespace-pre-wrap select-text"
              : "max-h-[34rem] min-h-[16rem] w-full overflow-auto p-4 font-mono text-xs text-cyan-200 bg-[#05070b] leading-relaxed whitespace-pre-wrap select-text"
          }
        >
          {safeOutput || "No output logs available."}
        </pre>
      )}
    </div>
  );
}
