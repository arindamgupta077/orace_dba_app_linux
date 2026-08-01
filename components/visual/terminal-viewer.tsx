"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Expand, FileText, Minimize2, TerminalSquare } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { Button } from "@/components/ui/button";
import { cn, downloadText } from "@/lib/utils";

export function TerminalViewer({ output, title = "Raw Output", className }: { output?: string; title?: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const lastDimRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"terminal" | "text">("terminal");

  const safeOutput = output || "";
  const lineCount = safeOutput ? safeOutput.split("\n").length : 0;

  useEffect(() => {
    if (viewMode !== "terminal" || !containerRef.current) return;
    const container = containerRef.current;

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
      const rect = container.getBoundingClientRect();
      const h = rect.height || container.clientHeight || 400;
      const w = rect.width || container.clientWidth || 800;
      const { cellH, cellW } = getCellMetrics();
      const rows = Math.max(Math.floor((h - 16) / cellH), 5);
      const cols = Math.max(Math.floor((w - 16) / cellW), 40);
      return { rows, cols };
    };

    const safeResize = (term: Terminal, cols: number, rows: number) => {
      if (cols <= 0 || rows <= 0) return;
      if (lastDimRef.current.cols === cols && lastDimRef.current.rows === rows) return;

      try {
        const core = (term as Terminal & { _core?: { _renderService?: { dimensions?: unknown } } })._core;
        if (core && core._renderService && core._renderService.dimensions) {
          term.resize(cols, rows);
          lastDimRef.current = { cols, rows };
        }
      } catch {
        // Safe catch for missing xterm dimensions during mount/unmount
      }
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
    termRef.current = term;

    const animationFrameId = requestAnimationFrame(() => {
      const preciseDim = calcDimensions();
      safeResize(term, preciseDim.cols, preciseDim.rows);
      try {
        term.write(safeOutput.replace(/\n/g, "\r\n"));
      } catch {
        // ignore
      }
    });

    let resizeRafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (!container || !termRef.current) return;
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        const { rows: r, cols: c } = calcDimensions();
        if (termRef.current) {
          safeResize(termRef.current, c, r);
        }
      });
    });

    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeObserver.disconnect();
      try {
        term.dispose();
      } catch {
        // ignore
      }
      termRef.current = null;
      lastDimRef.current = { cols: 0, rows: 0 };
    };
  }, [safeOutput, fullscreen, viewMode, lineCount]);

  return (
    <div
      className={
        fullscreen
          ? "keep-dark fixed inset-3 z-[100] flex flex-col rounded-xl border border-cyan-500/30 bg-[#05070b] p-4 shadow-2xl backdrop-blur-2xl"
          : cn(
              "keep-dark flex flex-col w-full min-w-0 max-w-full rounded-xl border border-border/70 bg-[#05070b]/95 overflow-hidden shadow-inner",
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
        <div className="relative flex-1 min-h-0 w-full max-w-full overflow-hidden">
          <div
            ref={containerRef}
            className="absolute inset-0 overflow-hidden"
          />
        </div>
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
