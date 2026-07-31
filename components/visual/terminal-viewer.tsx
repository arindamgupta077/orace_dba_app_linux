"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Expand, FileText, Minimize2, TerminalSquare } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { Button } from "@/components/ui/button";
import { cn, downloadText } from "@/lib/utils";

export function TerminalViewer({ output, title = "Raw Output", className }: { output?: string; title?: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"terminal" | "text">("terminal");

  const safeOutput = output || "";
  const lineCount = safeOutput ? safeOutput.split("\n").length : 0;

  useEffect(() => {
    if (viewMode !== "terminal" || !ref.current) return;
    const container = ref.current;

    const getCellMetrics = () => {
      const cellH = 14;
      let cellW = 7.2;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.font = "12px Consolas, Menlo, Monaco, 'Courier New', monospace";
          const measuredW = ctx.measureText("M").width;
          if (measuredW > 0) cellW = measuredW;
        }
      } catch {
        // Fallback
      }
      return { cellH, cellW };
    };

    const calcDimensions = () => {
      const h = container.clientHeight || 400;
      const w = container.clientWidth || 800;
      const { cellH, cellW } = getCellMetrics();
      const rows = Math.max(Math.floor((h - 16) / cellH), 5);
      const cols = Math.max(Math.floor((w - 16) / cellW), 40);
      return { rows, cols };
    };

    const initialDim = calcDimensions();

    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      fontFamily: "Consolas, Menlo, Monaco, 'Courier New', monospace",
      fontSize: 12,
      rows: initialDim.rows,
      cols: initialDim.cols,
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

    term.open(container);

    // Recalculate dimensions to fit container exactly
    const preciseDim = calcDimensions();
    try {
      term.resize(preciseDim.cols, preciseDim.rows);
    } catch {
      // ignore
    }

    term.write(safeOutput.replace(/\n/g, "\r\n"));
    termRef.current = term;

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const { rows: r, cols: c } = calcDimensions();
      try {
        term.resize(c, r);
      } catch {
        // ignore if term is disposed
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [safeOutput, fullscreen, viewMode, lineCount]);

  return (
    <div
      className={
        fullscreen
          ? "keep-dark fixed inset-3 z-[100] flex flex-col rounded-xl border border-cyan-500/30 bg-[#05070b] p-4 shadow-2xl backdrop-blur-2xl"
          : cn(
              "keep-dark flex flex-col w-full rounded-xl border border-border/70 bg-[#05070b]/95 overflow-hidden shadow-inner",
              className || "h-full min-h-[16rem] max-h-[34rem]"
            )
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
          className="relative flex-1 min-h-0 w-full overflow-hidden"
        />
      ) : (
        <pre
          className="flex-1 min-h-0 w-full overflow-auto terminal-scroll p-4 font-mono text-xs text-cyan-200 bg-[#05070b] leading-relaxed whitespace-pre-wrap select-text"
        >
          {safeOutput || "No output logs available."}
        </pre>
      )}
    </div>
  );
}
