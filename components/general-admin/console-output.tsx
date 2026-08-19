"use client";

import { CheckCircle2, ClipboardCopy, Loader2, ShieldCheck, Sparkles, Terminal, XCircle, Code2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DbaResponse } from "@/types/dba";

// ── Compliance Validation Helpers ──────────────────────────────────────────

function checkSpfileCompliant(val?: string | null): boolean {
  if (!val) return true;
  const normalized = val.trim().toLowerCase();
  return normalized === "" || normalized === "none" || normalized === "(blank)";
}

function checkAuditSysOpsCompliant(val?: string | null): boolean {
  if (!val) return false;
  return val.trim().toLowerCase() === "true";
}

function checkAuditTrailCompliant(val?: string | null): boolean {
  if (!val) return false;
  const normalized = val.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "db, extended" ||
    normalized === "db,extended" ||
    normalized === "db_extended"
  );
}

function getDbStatusBadgeClass(statusStr?: string | null): string {
  if (!statusStr) return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  const s = statusStr.trim().toUpperCase();
  if (["OPEN", "OPEN_READ_WRITE", "HEALTHY", "UP", "ONLINE", "READY"].includes(s)) {
    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }
  if (["MOUNTED", "MOUNT", "STARTED", "NOMOUNT", "WARNING", "RESTRICTED"].includes(s)) {
    return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  }
  if (["SHUTDOWN", "DOWN", "STOPPED", "CLOSED", "CRITICAL", "OFFLINE", "ERROR", "FAILED"].includes(s)) {
    return "bg-red-500/15 text-red-400 border-red-500/30";
  }
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}

interface ConsoleOutputProps {
  output: string | null;
  status: "idle" | "loading" | "success" | "error";
  action?: string;
  timestamp?: string;
  className?: string;
  response?: DbaResponse | Record<string, unknown> | null;
}

export function ConsoleOutput({ output, status, action, timestamp, className, response }: ConsoleOutputProps) {
  const [copied, setCopied] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const copyToClipboard = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (status === "idle") return null;

  // ── Parse n8n Response Object (either from prop or from stringified output) ──
  let resObj: Record<string, unknown> | null = null;
  if (response && typeof response === "object") {
    resObj = response as Record<string, unknown>;
  } else if (output && typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
          resObj = parsed[0] as Record<string, unknown>;
        } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resObj = parsed as Record<string, unknown>;
        }
      } catch {
        resObj = null;
      }
    }
  }

  // Extract structured fields
  const rawData = resObj?.raw_data && typeof resObj.raw_data === "object" ? (resObj.raw_data as Record<string, unknown>) : null;
  const auditSnapshot = rawData?.audit_snapshot && typeof rawData.audit_snapshot === "object"
    ? (rawData.audit_snapshot as Record<string, string>)
    : null;

  const requestId = typeof resObj?.request_id === "string" ? resObj.request_id : null;
  const actionName = (typeof resObj?.action === "string" ? resObj.action : action) || "Database Activity";
  const dbStatus =
    (typeof resObj?.db_status === "string" && resObj.db_status.trim()) ||
    (typeof resObj?.dbStatus === "string" && resObj.dbStatus.trim()) ||
    (typeof resObj?.database_status === "string" && resObj.database_status.trim()) ||
    (typeof resObj?.instance_status === "string" && resObj.instance_status.trim()) ||
    (typeof rawData?.db_status === "string" && String(rawData.db_status).trim()) ||
    (typeof rawData?.status === "string" && String(rawData.status).trim()) ||
    null;
  const aiSummary = typeof resObj?.ai_summary === "string" ? resObj.ai_summary : null;
  const rawOut = typeof resObj?.raw_output === "string" ? resObj.raw_output : (typeof output === "string" && !resObj ? output : null);

  // Collect any custom top-level fields (e.g. myNewField)
  const knownKeys = new Set([
    "status", "request_id", "action", "db_status", "dbStatus", "database_status", 
    "instance_status", "ai_summary", "findings", "recommendations", "raw_output", "raw_data"
  ]);
  const customFields: Array<[string, unknown]> = resObj
    ? Object.entries(resObj).filter(([k]) => !knownKeys.has(k))
    : [];

  const textToCopy = rawOut || aiSummary || output || "";

  return (
    <div className={cn("keep-dark mt-5 rounded-xl overflow-hidden border border-border/60 shadow-2xl bg-[#0d1117]", className)}>
      {/* ── Console Header Bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 bg-[#161b22] border-b border-[#30363d] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {/* Traffic-light dots */}
          <span className="h-3 w-3 rounded-full bg-red-500/80" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          
          <div className="ml-2 flex items-center gap-2 text-xs text-slate-400 font-mono">
            <Terminal className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-semibold text-slate-200">Execution Results</span>
            {actionName && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-400/90 font-mono">{actionName}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {requestId && (
            <span className="hidden md:inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300 border border-slate-700/60">
              ID: {requestId}
            </span>
          )}
          {timestamp && (
            <span className="hidden sm:block text-[10px] text-slate-500 font-mono">{timestamp}</span>
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
          {textToCopy && status !== "loading" && (
            <button
              onClick={() => void copyToClipboard(textToCopy)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
              title="Copy output"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
      </div>

      {/* ── Loading State ────────────────────────────────────────────────── */}
      {status === "loading" && (
        <div className="flex flex-col gap-3 px-5 py-8 bg-[#0d1117]">
          <div className="flex items-center gap-3 text-slate-300 font-mono text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400 shrink-0" />
            <span className="animate-pulse">Executing n8n workflow & verifying database state...</span>
          </div>
          <div className="flex items-center gap-1 pl-7 font-mono text-xs text-slate-500">
            <span>$</span>
            <span className="inline-block w-2 h-3.5 bg-amber-400/60 animate-pulse rounded-sm" />
          </div>
        </div>
      )}

      {/* ── Finished State: Rich Response Rendering ─────────────────────── */}
      {(status === "success" || status === "error") && (
        <div className="flex flex-col">

          {/* 1. AI Summary Card (if available) */}
          {aiSummary && (
            <div className="border-b border-[#30363d] bg-gradient-to-r from-slate-900 via-slate-900/90 to-[#161b22] p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Execution Summary
                    </span>
                    {dbStatus && (
                      <span className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border font-mono",
                        getDbStatusBadgeClass(dbStatus)
                      )}>
                        DB Status: {dbStatus}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-emerald-300 leading-relaxed">
                    {aiSummary}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 2. Audit Compliance Snapshot Grid (if audit_snapshot exists) */}
          {auditSnapshot && (() => {
            const spfileVal = auditSnapshot.SPFILE_VALUE ?? auditSnapshot.spfile_value ?? "";
            const sysOpsVal = auditSnapshot.AUDIT_SYS_OPS ?? auditSnapshot.audit_sys_ops ?? "";
            const auditTrailVal = auditSnapshot.AUDIT_TRAIL ?? auditSnapshot.audit_trail ?? "";

            // Compliance validation rules
            const isSpfileOk = checkSpfileCompliant(spfileVal);
            const isSysOpsOk = checkAuditSysOpsCompliant(sysOpsVal);
            const isAuditTrailOk = checkAuditTrailCompliant(auditTrailVal);

            const allCompliant = isSpfileOk && isSysOpsOk && isAuditTrailOk;
            const failCount = [isSpfileOk, isSysOpsOk, isAuditTrailOk].filter((v) => !v).length;

            return (
              <div className="border-b border-[#30363d] bg-slate-950/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={cn("h-4 w-4", allCompliant ? "text-emerald-400" : "text-amber-400")} />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      PROD Audit Compliance Snapshot
                    </span>
                  </div>
                  {allCompliant ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400 font-mono">
                      ✓ ALL PARAMETERS COMPLIANT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-0.5 text-[11px] font-bold text-red-400 font-mono">
                      ⚠️ {failCount} PARAMETER{failCount > 1 ? "S" : ""} NON-COMPLIANT
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {/* Database Name */}
                  <div className="rounded-lg border border-slate-800 bg-[#161b22] p-2.5 space-y-1">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block">Database Name</span>
                    <span className="font-mono text-xs font-bold text-cyan-300">{auditSnapshot.DB_NAME || "ORCL"}</span>
                  </div>

                  {/* Captured Timestamp */}
                  <div className="rounded-lg border border-slate-800 bg-[#161b22] p-2.5 space-y-1">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block">Captured Timestamp</span>
                    <span className="font-mono text-xs font-bold text-slate-300">{auditSnapshot.CAPTURED_AT || "N/A"}</span>
                  </div>

                  {/* spfile check */}
                  <div className={cn(
                    "rounded-lg border p-2.5 space-y-1 transition-colors",
                    isSpfileOk ? "border-slate-800 bg-[#161b22]" : "border-red-500/40 bg-red-950/20"
                  )}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
                        SPFILE Parameter
                        {isSpfileOk && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                      </span>
                      {!isSpfileOk && (
                        <span className="text-[9px] font-bold text-red-400 bg-red-500/10 px-1.5 rounded border border-red-500/30">NON-COMPLIANT</span>
                      )}
                    </div>
                    <span className={cn("font-mono text-xs font-bold block", isSpfileOk ? "text-emerald-300" : "text-red-300")}>
                      {spfileVal.trim() === "" ? "(Blank / Read-Only Pfile)" : spfileVal}
                    </span>
                  </div>

                  {/* audit_sys_operations */}
                  <div className={cn(
                    "rounded-lg border p-2.5 space-y-1 transition-colors",
                    isSysOpsOk ? "border-slate-800 bg-[#161b22]" : "border-red-500/40 bg-red-950/20"
                  )}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
                        AUDIT_SYS_OPERATIONS
                        {isSysOpsOk && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                      </span>
                      {!isSysOpsOk && (
                        <span className="text-[9px] font-bold text-red-400 bg-red-500/10 px-1.5 rounded border border-red-500/30">NON-COMPLIANT</span>
                      )}
                    </div>
                    <span className={cn("font-mono text-xs font-bold block", isSysOpsOk ? "text-emerald-300" : "text-red-300")}>
                      {sysOpsVal || "FALSE"}
                    </span>
                  </div>

                  {/* audit_trail */}
                  <div className={cn(
                    "rounded-lg border p-2.5 space-y-1 sm:col-span-2 md:col-span-1 transition-colors",
                    isAuditTrailOk ? "border-slate-800 bg-[#161b22]" : "border-red-500/40 bg-red-950/20"
                  )}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
                        AUDIT_TRAIL
                        {isAuditTrailOk && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                      </span>
                      {!isAuditTrailOk && (
                        <span className="text-[9px] font-bold text-red-400 bg-red-500/10 px-1.5 rounded border border-red-500/30">
                          EXPECTED: DB, EXTENDED
                        </span>
                      )}
                    </div>
                    <span className={cn("font-mono text-xs font-bold block", isAuditTrailOk ? "text-emerald-300" : "text-red-300")}>
                      {auditTrailVal || "NONE"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 3. Custom Fields (e.g. myNewField) */}
          {customFields.length > 0 && (
            <div className="border-b border-[#30363d] bg-slate-900/40 px-4 py-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Custom Fields:</span>
              {customFields.map(([k, val]) => (
                <span key={k} className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-mono text-amber-300">
                  <span className="text-amber-400/70 font-semibold">{k}:</span>
                  <span className="font-bold">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
                </span>
              ))}
            </div>
          )}

          {/* 4. Raw Console Output Block */}
          <div className="p-4 bg-[#0d1117]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                <Terminal className="h-3 w-3 text-slate-500" />
                <span>Execution Output (raw_output)</span>
              </div>

              {resObj && (
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <Code2 className="h-3 w-3" />
                  {showRawJson ? "Hide Raw JSON" : "View Raw JSON"}
                </button>
              )}
            </div>

            {showRawJson && resObj ? (
              <pre className="p-3 rounded-lg border border-[#30363d] bg-[#161b22] text-xs font-mono text-cyan-200 overflow-x-auto leading-relaxed max-h-[300px]">
                {JSON.stringify(resObj, null, 2)}
              </pre>
            ) : (
              <pre
                className={cn(
                  "p-3 rounded-lg border border-[#30363d] bg-[#161b22] text-xs font-mono leading-relaxed whitespace-pre-wrap break-words",
                  status === "error" ? "text-red-300" : "text-emerald-300"
                )}
              >
                {rawOut || (typeof output === "string" ? output : "(no output returned)")}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ── Status Footer ───────────────────────────────────────────────── */}
      {status === "loading" && (
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono border-t bg-amber-950/30 border-amber-900/30 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Workflow execution in progress...
        </div>
      )}
      {status === "success" && (
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono border-t bg-emerald-950/40 border-emerald-900/30 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Database operation completed successfully
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-mono border-t bg-red-950/40 border-red-900/30 text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          Database operation returned an error
        </div>
      )}
    </div>
  );
}

