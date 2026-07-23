"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, ShieldCheck, Terminal } from "lucide-react";

interface ParamsDisplayProps {
  params?: Record<string, unknown>;
  className?: string;
}

export function ParamsDisplay({ params, className }: ParamsDisplayProps) {
  if (!params || !Object.keys(params).length) {
    return <span className="text-xs text-muted-foreground italic">None</span>;
  }

  const entries = Object.entries(params);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className || ""}`}>
      {entries.map(([key, val]) => {
        const formattedKey = key
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const displayVal = typeof val === "object" ? JSON.stringify(val) : String(val);

        return (
          <div
            key={key}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-100/80 px-2.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-800/60 transition-colors shadow-2xs"
          >
            <span className="font-medium text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wide">{formattedKey}:</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 font-mono">{displayVal}</span>
          </div>
        );
      })}
    </div>
  );
}

interface FormattedExecutionOutputProps {
  rawOutput?: string | null;
  action?: string;
  className?: string;
}

export function FormattedExecutionOutput({ rawOutput, className }: FormattedExecutionOutputProps) {
  const [copied, setCopied] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  if (!rawOutput || !rawOutput.trim()) {
    return (
      <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/40 p-3 text-xs text-muted-foreground italic">
        No console output recorded.
      </div>
    );
  }

  const trimmed = rawOutput.trim();

  // Try parsing JSON
  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch {
    parsedJson = null;
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(trimmed);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Collect records if JSON object or array of objects
  let records: Record<string, unknown>[] = [];
  if (Array.isArray(parsedJson)) {
    records = parsedJson.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r));
  } else if (parsedJson && typeof parsedJson === "object") {
    records = [parsedJson as Record<string, unknown>];
  }

  let userExistsVal: number | boolean | null = null;
  let profileExistsVal: number | boolean | null = null;
  const genericKV: Array<{ key: string; label: string; val: unknown }> = [];

  if (records.length > 0) {
    for (const rec of records) {
      for (const [k, v] of Object.entries(rec)) {
        const lowerK = k.toLowerCase();
        if (lowerK === "user_exists") {
          if (typeof v === "number" || typeof v === "boolean") {
            userExistsVal = typeof v === "boolean" ? (v ? 1 : 0) : v;
          }
        } else if (lowerK === "profile_exists") {
          if (typeof v === "number" || typeof v === "boolean") {
            profileExistsVal = typeof v === "boolean" ? (v ? 1 : 0) : v;
          }
        } else {
          const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          genericKV.push({ key: k, label, val: v });
        }
      }
    }
  }

  const hasStructuredOutput = userExistsVal !== null || profileExistsVal !== null || genericKV.length > 0;

  return (
    <div className={`space-y-2.5 ${className || ""}`}>
      {/* Drop User Result Card */}
      {userExistsVal !== null && (
        <div className={`flex items-start gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors ${
          userExistsVal === 0
            ? "border-emerald-500/30 bg-emerald-50/80 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "border-amber-500/30 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
        }`}>
          {userExistsVal === 0 ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div className="space-y-1 text-xs flex-1">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm text-emerald-950 dark:text-emerald-100">
                {userExistsVal === 0 ? "User Successfully Dropped" : "User Still Exists"}
              </p>
              <span className="font-mono rounded-md bg-emerald-500/15 dark:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                USER_EXISTS = {String(userExistsVal)}
              </span>
            </div>
            <p className="text-emerald-900/90 dark:text-emerald-300/80 font-medium">
              {userExistsVal === 0
                ? "Confirmed: User has been completely removed from the Oracle database."
                : "Warning: User is still present in the database."}
            </p>
          </div>
        </div>
      )}

      {/* Drop Profile Result Card */}
      {profileExistsVal !== null && (
        <div className={`flex items-start gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors ${
          profileExistsVal === 0
            ? "border-emerald-500/30 bg-emerald-50/80 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "border-amber-500/30 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
        }`}>
          {profileExistsVal === 0 ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <div className="space-y-1 text-xs flex-1">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm text-emerald-950 dark:text-emerald-100">
                {profileExistsVal === 0 ? "Profile Successfully Dropped" : "Profile Still Exists"}
              </p>
              <span className="font-mono rounded-md bg-emerald-500/15 dark:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                PROFILE_EXISTS = {String(profileExistsVal)}
              </span>
            </div>
            <p className="text-emerald-900/90 dark:text-emerald-300/80 font-medium">
              {profileExistsVal === 0
                ? "Confirmed: Profile has been completely removed from the Oracle database."
                : "Warning: Profile is still present in the database."}
            </p>
          </div>
        </div>
      )}

      {/* Generic key-value grid if parsed */}
      {genericKV.length > 0 && userExistsVal === null && profileExistsVal === null && (
        <div className="grid gap-2 sm:grid-cols-2">
          {genericKV.map(({ key, label, val }) => (
            <div key={key} className="flex flex-col gap-0.5 rounded-lg border border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60 p-2.5 text-xs">
              <span className="font-medium text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wide">{label}</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-cyan-300 break-all">
                {typeof val === "object" ? JSON.stringify(val) : String(val)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Output Display */}
      {!hasStructuredOutput ? (
        <div className="relative group space-y-1.5">
          <div className="flex items-center justify-between border-b border-slate-200/70 dark:border-slate-800 pb-1.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Terminal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
              Execution Console Output
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-52 overflow-y-auto rounded-lg bg-slate-950 dark:bg-black/90 p-3.5 font-mono text-xs text-emerald-400 dark:text-cyan-300 leading-relaxed border border-slate-800 shadow-inner">
            {trimmed}
          </pre>
        </div>
      ) : (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowRawJson((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
          >
            {showRawJson ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showRawJson ? "Hide Raw Response Payload" : "View Raw Response Payload"}
          </button>
          {showRawJson && (
            <div className="mt-1.5 relative">
              <button
                onClick={handleCopy}
                className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded bg-slate-800 text-slate-200 dark:bg-black/80 px-2 py-0.5 text-[10px] hover:bg-slate-700 dark:hover:text-foreground border border-slate-700/60 shadow-xs"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <pre className="max-h-40 overflow-y-auto rounded-lg bg-slate-950 dark:bg-black/90 p-3 font-mono text-[11px] text-cyan-300 dark:text-cyan-300/90 border border-slate-800 shadow-inner">
                {trimmed}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

