"use client";

import { AlertTriangle, Play, RotateCcw, Terminal } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConsoleOutput } from "@/components/general-admin/console-output";
import { executeDBAAction } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";

const SAMPLE_QUERIES = [
  "SELECT SYSDATE FROM DUAL",
  "SELECT STATUS FROM V$INSTANCE",
  "SELECT NAME, OPEN_MODE FROM V$DATABASE",
  "SELECT COUNT(*) FROM V$SESSION WHERE STATUS='ACTIVE'",
  "SELECT TABLESPACE_NAME, STATUS FROM DBA_TABLESPACES"
];

interface RunState {
  status: "idle" | "loading" | "success" | "error";
  output: string | null;
  timestamp: string | null;
}

export function QueryPanel() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const [query, setQuery] = useState("SELECT SYSDATE FROM DUAL");
  const [runState, setRunState] = useState<RunState>({ status: "idle", output: null, timestamp: null });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runQuery = async () => {
    if (!selectedDb || !query.trim()) return;
    setRunState({ status: "loading", output: null, timestamp: null });
    try {
      const result = await executeDBAAction("query", selectedDb, { sql_query: query.trim() });
      setRunState({
        status: result.status === "error" ? "error" : "success",
        output: result.raw_output || result.ai_summary || "(no output)",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false })
      });
    } catch (err) {
      setRunState({
        status: "error",
        output: err instanceof Error ? err.message : "Unknown error occurred.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false })
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void runQuery();
    }
    // Tab → insert 2 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = query.substring(0, start) + "  " + query.substring(end);
      setQuery(newValue);
      setTimeout(() => ta.setSelectionRange(start + 2, start + 2), 0);
    }
  };

  const clearAll = () => {
    setQuery("");
    setRunState({ status: "idle", output: null, timestamp: null });
    textareaRef.current?.focus();
  };

  return (
    <div className="space-y-4">
      {/* Quick sample buttons */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Templates</p>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => setQuery(q)}
              className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:border-border hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Editor area */}
      <div className="keep-dark rounded-xl overflow-hidden border border-border/60 shadow-lg">
        {/* Editor header */}
        <div className="flex items-center justify-between gap-3 bg-[#161b22] border-b border-[#30363d] px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span>SQL Editor</span>
            {selectedDb && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-400/90 font-semibold">{selectedDb}</span>
              </>
            )}
          </div>
          <span className="hidden sm:block text-[10px] text-slate-600 font-mono">Ctrl+Enter to run</span>
        </div>

        {/* Textarea with line-number gutter */}
        <div className="relative bg-[#0d1117] flex">
          {/* Line numbers */}
          <div
            aria-hidden
            className="select-none px-3 py-4 text-right text-xs font-mono text-slate-700 leading-[1.625rem] border-r border-[#30363d] min-w-[3rem]"
          >
            {query.split("\n").map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Actual textarea */}
          <textarea
            ref={textareaRef}
            id="general-admin-query-editor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="-- Write your SQL query here&#10;-- Press Ctrl+Enter to execute"
            rows={Math.max(8, query.split("\n").length + 2)}
            spellCheck={false}
            className="flex-1 resize-none bg-transparent px-4 py-4 text-sm font-mono leading-[1.625rem] text-emerald-300 placeholder:text-slate-700 outline-none caret-amber-400"
          />
        </div>

        {/* Editor footer / toolbar */}
        <div className="flex items-center justify-between gap-3 bg-[#161b22] border-t border-[#30363d] px-4 py-2.5">
          <div className="text-[11px] text-slate-600 font-mono">
            {query.trim().length} chars · {query.split("\n").length} lines
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-7 gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => void runQuery()}
              disabled={!selectedDb || !query.trim() || runState.status === "loading"}
              className="h-7 gap-1.5 text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-0 text-white"
            >
              {runState.status === "loading" ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run Query
            </Button>
          </div>
        </div>
      </div>

      {/* No database warning */}
      {!selectedDb && (
        <p className="text-sm text-amber-400/80 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Please select a database from the top selector first.
        </p>
      )}

      {/* Console output */}
      <ConsoleOutput
        status={runState.status}
        output={runState.output}
        action="query"
        timestamp={runState.timestamp ?? undefined}
      />
    </div>
  );
}
