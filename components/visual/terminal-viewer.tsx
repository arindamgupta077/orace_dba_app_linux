"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Expand, Minimize2, TerminalSquare } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/utils";

export function TerminalViewer({ output, title = "Raw Output", className }: { output?: string; title?: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const safeOutput = output || "";

  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      fontFamily: "Consolas, Menlo, monospace",
      fontSize: 12,
      scrollback: 50000,
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
  }, [safeOutput, fullscreen]);

  return (
    <div className={fullscreen ? "fixed inset-4 z-[70] rounded-lg border border-border bg-black p-4 shadow-glass" : "rounded-lg border border-border/70 bg-black/70"}>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TerminalSquare className="h-4 w-4 text-cyan-300" />
          {title}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => navigator.clipboard.writeText(safeOutput)} title="Copy output">
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => downloadText("oracle-dba-output.log", safeOutput)} title="Download output">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setFullscreen((value) => !value)} title="Toggle fullscreen">
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div ref={ref} className={fullscreen ? "h-[calc(100vh-8rem)]" : (className || "h-[32rem]")} />
    </div>
  );
}
