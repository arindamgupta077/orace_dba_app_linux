"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Download,
  HardDrive,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRound,
  Users,
  X,
  XCircle,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/components/providers/theme-provider";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { ChatMessage, DatabaseTarget } from "@/types/dba";

// ---------------------------------------------------------------------------
// Constants & Suggested Prompts Catalog
// ---------------------------------------------------------------------------

export type PromptTypeFilter = "all" | "action" | "query";

export type SuggestedCategory =
  | "All"
  | "Actions"
  | "Performance"
  | "Storage"
  | "Sessions"
  | "Backup & Health"
  | "Security & Objects";

export interface SuggestedPromptItem {
  id: string;
  type: "action" | "query";
  category: Exclude<SuggestedCategory, "All">;
  shortTitle: string;
  prompt: string;
  description: string;
  oracleViews: string;
  badgeColor?: string;
}

export const SUGGESTED_CATEGORIES: { id: SuggestedCategory; label: string; icon: React.ElementType }[] = [
  { id: "All", label: "All Topics", icon: Sparkles },
  { id: "Actions", label: "⚡ Executable Actions", icon: Zap },
  { id: "Performance", label: "Performance & SQL", icon: Activity },
  { id: "Storage", label: "Storage & Space", icon: HardDrive },
  { id: "Sessions", label: "Sessions & Memory", icon: Users },
  { id: "Backup & Health", label: "Backup & Health", icon: ShieldCheck },
  { id: "Security & Objects", label: "Security & Objects", icon: Shield },
];

export const SUGGESTED_PROMPTS: SuggestedPromptItem[] = [
  // ⚡ Executable Database Activities (Require DBA approval in n8n)
  {
    id: "act-1",
    type: "action",
    category: "Actions",
    shortTitle: "Kill Blocking Session",
    prompt: "Kill blocking session SID 142 serial# 5210",
    description: "Generates ALTER SYSTEM KILL SESSION command with mandatory DBA review",
    oracleViews: "ALTER SYSTEM KILL SESSION",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-2",
    type: "action",
    category: "Actions",
    shortTitle: "Add Datafile to Tablespace",
    prompt: "Add a 10GB datafile to USERS tablespace with autoextend enabled",
    description: "Expands tablespace storage by creating and attaching a new datafile",
    oracleViews: "ALTER TABLESPACE ADD DATAFILE",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-3",
    type: "action",
    category: "Actions",
    shortTitle: "Recompile Invalid Objects",
    prompt: "Recompile all invalid packages, procedures, and views in APPS schema",
    description: "Executes parallel recompilation for invalid schema packages and triggers",
    oracleViews: "UTL_RECOMP.RECOMP_PARALLEL",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-4",
    type: "action",
    category: "Actions",
    shortTitle: "Gather Optimizer Statistics",
    prompt: "Gather optimizer statistics for table ORDERS in APPS schema with cascade",
    description: "Runs DBMS_STATS.GATHER_TABLE_STATS for updated CBO query plans",
    oracleViews: "DBMS_STATS.GATHER_TABLE_STATS",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-5",
    type: "action",
    category: "Actions",
    shortTitle: "Flush Shared Pool",
    prompt: "Flush shared pool to clear invalid cursor cache and bad execution plans",
    description: "Purges cached execution plans and SQL statements from SGA shared pool",
    oracleViews: "ALTER SYSTEM FLUSH SHARED_POOL",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-6",
    type: "action",
    category: "Actions",
    shortTitle: "Unlock Account & Expire Password",
    prompt: "Unlock user account HR and expire password for security reset",
    description: "Unlocks locked database user account and forces password reset on next login",
    oracleViews: "ALTER USER ACCOUNT UNLOCK",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-7",
    type: "action",
    category: "Actions",
    shortTitle: "Trigger RMAN Database Backup",
    prompt: "Take an immediate RMAN full database backup including archivelogs",
    description: "Dispatches RMAN backup command for database files and archived redo logs",
    oracleViews: "EXEC RMAN BACKUP DATABASE",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },
  {
    id: "act-8",
    type: "action",
    category: "Actions",
    shortTitle: "Trigger Data Pump Export",
    prompt: "Start a schema Data Pump export (expdp) for SCOTT schema to DATA_PUMP_DIR",
    description: "Launches Oracle Data Pump export job via DBMS_DATAPUMP API",
    oracleViews: "DBMS_DATAPUMP.OPEN",
    badgeColor: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
  },

  // 🔍 Diagnostic Read-Only Queries
  {
    id: "perf-1",
    type: "query",
    category: "Performance",
    shortTitle: "Blocking Locks",
    prompt: "Find blocking sessions and lock details in the database",
    description: "Identify session SIDs, lock types, blocked wait trees, and holding queries",
    oracleViews: "V$LOCK, V$SESSION",
    badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
  },
  {
    id: "perf-2",
    type: "query",
    category: "Performance",
    shortTitle: "Top SQL by CPU & I/O",
    prompt: "Show top 10 SQL queries consuming highest CPU and disk reads",
    description: "Retrieve SQL ID, execution count, CPU time, buffer gets, and SQL text",
    oracleViews: "V$SQL, V$SQLAREA",
    badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
  },
  {
    id: "perf-3",
    type: "query",
    category: "Performance",
    shortTitle: "Long Running Operations",
    prompt: "Show long running operations currently in progress",
    description: "Track progress percentage, elapsed time, remaining time, and target tables",
    oracleViews: "V$SESSION_LONGOPS",
    badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
  },
  {
    id: "perf-4",
    type: "query",
    category: "Performance",
    shortTitle: "Top System Wait Events",
    prompt: "List top database wait events and system wait statistics right now",
    description: "Identify wait classes, total waits, and time waited in seconds",
    oracleViews: "V$SYSTEM_EVENT, V$SESSION_WAIT",
    badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
  },

  // Storage & Space
  {
    id: "storage-1",
    type: "query",
    category: "Storage",
    shortTitle: "Tablespace Free Space",
    prompt: "Show all tablespaces, total allocated size, free space, and usage percentage",
    description: "Summary of used MB, free MB, max size, and percent free per tablespace",
    oracleViews: "DBA_TABLESPACES, DBA_DATA_FILES, DBA_FREE_SPACE",
    badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  },
  {
    id: "storage-2",
    type: "query",
    category: "Storage",
    shortTitle: "Full & Autoextend Files",
    prompt: "Find datafiles near full capacity or with autoextend disabled",
    description: "Check file name, allocated size, max size, and autoextensible status",
    oracleViews: "DBA_DATA_FILES",
    badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  },
  {
    id: "storage-3",
    type: "query",
    category: "Storage",
    shortTitle: "TEMP Space & Sort Usage",
    prompt: "Check TEMP tablespace usage and active sort segments by session",
    description: "Identify sessions allocating temporary segments and sort blocks",
    oracleViews: "V$SORT_USAGE, V$TEMP_SPACE_HEADER",
    badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  },
  {
    id: "storage-4",
    type: "query",
    category: "Storage",
    shortTitle: "ASM Diskgroups",
    prompt: "Show ASM diskgroups total capacity, free space, and redundancy state",
    description: "Disk group health, total GB, usable free GB, and offline disks",
    oracleViews: "V$ASM_DISKGROUP",
    badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  },

  // Sessions & Memory
  {
    id: "sessions-1",
    type: "query",
    category: "Sessions",
    shortTitle: "Active User Sessions",
    prompt: "List active user sessions with username, machine, program, and current SQL",
    description: "Filter non-background active user sessions with connection details",
    oracleViews: "V$SESSION, V$SQL",
    badgeColor: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  },
  {
    id: "sessions-2",
    type: "query",
    category: "Sessions",
    shortTitle: "Top PGA / Memory Usage",
    prompt: "Find top 10 sessions consuming maximum PGA and UGA memory",
    description: "Process memory consumption by session SID, username, and OS process ID",
    oracleViews: "V$PROCESS, V$SESSION",
    badgeColor: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  },

  // Backup & Health
  {
    id: "backup-1",
    type: "query",
    category: "Backup & Health",
    shortTitle: "RMAN Backup Status",
    prompt: "Check RMAN backup summary and execution status for the last 7 days",
    description: "Status and duration of full, incremental, and archivelog backups",
    oracleViews: "V$RMAN_STATUS, V$RMAN_BACKUP_JOB_DETAILS",
    badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300"
  },
  {
    id: "backup-2",
    type: "query",
    category: "Backup & Health",
    shortTitle: "Data Guard Standby Sync",
    prompt: "Check Data Guard standby synchronization gap and apply lag",
    description: "Transport lag, apply lag, and missing archived log sequences",
    oracleViews: "V$DATAGUARD_STATS, V$MANAGED_STANDBY",
    badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300"
  },

  // Security & Objects
  {
    id: "security-1",
    type: "query",
    category: "Security & Objects",
    shortTitle: "Invalid Objects Summary",
    prompt: "Show invalid objects in database grouped by owner schema and object type",
    description: "Packages, procedures, triggers, and views needing compilation",
    oracleViews: "DBA_OBJECTS",
    badgeColor: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
  },
  {
    id: "security-2",
    type: "query",
    category: "Security & Objects",
    shortTitle: "Locked & Expired Users",
    prompt: "Show locked user accounts, expired passwords, and password change dates",
    description: "User account status, lock date, profile, and expiry date",
    oracleViews: "DBA_USERS",
    badgeColor: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
  },
  {
    id: "security-3",
    type: "query",
    category: "Security & Objects",
    shortTitle: "DBA & SYSDBA Privileges",
    prompt: "List users granted SYSDBA privilege or DBA role in the database",
    description: "Audit user accounts holding administrative privileges",
    oracleViews: "DBA_ROLE_PRIVS, V$PWFILE_USERS",
    badgeColor: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
  }
];

const POLL_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
// SessionStorage helpers — persist chat across page navigation, clear on
// hard refresh (sessionStorage is scoped to the browser tab lifecycle).
// ---------------------------------------------------------------------------

const CHAT_STORAGE_PREFIX = "dba_chat_messages_";

function saveChatToSession(dbName: string, messages: ChatMessage[]) {
  try {
    const serializable = messages.map((m) => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    }));
    sessionStorage.setItem(CHAT_STORAGE_PREFIX + dbName, JSON.stringify(serializable));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

function loadChatFromSession(dbName: string): ChatMessage[] | null {
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_PREFIX + dbName);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMessage[];
    // Re-hydrate Date objects
    return parsed.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 dark:bg-cyan-400 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 dark:bg-cyan-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-500 dark:bg-cyan-400 [animation-delay:300ms]" />
    </div>
  );
}

function MessageTimestamp({ date }: { date: Date }) {
  return (
    <span className="text-[10px] text-muted-foreground">
      {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Markdown Renderer (Fix #3)
// ---------------------------------------------------------------------------

function MarkdownContent({ content }: { content: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const syntaxStyle = isDark ? oneDark : oneLight;
  const codeBlockBorder = isDark ? "!border-slate-700/60" : "!border-border";
  const codeBlockBg = isDark ? "" : "!bg-muted/50";

  return (
    <div className="markdown-body max-w-none text-sm leading-relaxed text-foreground dark:text-slate-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks with syntax highlighting
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeStr = String(children).replace(/\n$/, "");
            if (match) {
              return (
                <SyntaxHighlighter
                  style={syntaxStyle as Record<string, React.CSSProperties>}
                  language={match[1]}
                  PreTag="div"
                  className={cn("!rounded-lg !text-xs !my-2 !border", codeBlockBorder, codeBlockBg)}
                >
                  {codeStr}
                </SyntaxHighlighter>
              );
            }
            // Inline code — detect SQL keywords
            const isSql = /^(SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK)\b/i.test(codeStr);
            return (
              <code
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-mono",
                  isSql
                    ? "bg-cyan-500/10 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300 border border-cyan-500/20"
                    : "bg-secondary text-foreground dark:bg-slate-700/60 dark:text-amber-300 border border-border dark:border-slate-600/40"
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          // Tables with full styling
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto rounded-lg border border-border dark:border-slate-700/60">
                <table className="min-w-full divide-y divide-border dark:divide-slate-700/50 text-xs">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted dark:bg-slate-800/70">{children}</thead>;
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-border dark:divide-slate-800/60 bg-card dark:bg-slate-900/30">
                {children}
              </tbody>
            );
          },
          tr({ children }) {
            return (
              <tr className="transition-colors hover:bg-muted/60 dark:hover:bg-slate-700/20">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-400/80">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 text-muted-foreground dark:text-slate-300 font-mono text-[11px]">
                {children}
              </td>
            );
          },
          // Headings
          h1({ children }) {
            return <h1 className="mb-2 mt-4 text-base font-bold text-cyan-700 dark:text-cyan-300 border-b border-border dark:border-slate-700/60 pb-1">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="mb-1.5 mt-3 text-sm font-semibold text-cyan-700 dark:text-cyan-400">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="mb-1 mt-2 text-xs font-semibold text-foreground dark:text-slate-300">{children}</h3>;
          },
          // Paragraphs - handle status badges inline
          p({ children }) {
            return <p className="mb-2 last:mb-0 whitespace-pre-wrap break-words text-foreground dark:text-slate-200">{children}</p>;
          },
          // Lists
          ul({ children }) {
            return <ul className="mb-2 ml-4 list-disc space-y-0.5 text-foreground dark:text-slate-300">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-foreground dark:text-slate-300">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-foreground dark:text-slate-300 text-xs leading-relaxed">{children}</li>;
          },
          // Blockquotes (used for status sections)
          blockquote({ children }) {
            return (
              <blockquote className="my-2 border-l-2 border-cyan-500/50 bg-cyan-500/5 pl-3 py-1 text-muted-foreground dark:text-slate-300 text-xs italic">
                {children}
              </blockquote>
            );
          },
          // Bold & strong text
          strong({ children }) {
            const text = String(children);
            // Color-code status keywords
            if (/🔴|error|critical|failed/i.test(text)) {
              return <strong className="font-semibold text-red-600 dark:text-red-400">{children}</strong>;
            }
            if (/🟠|warning/i.test(text)) {
              return <strong className="font-semibold text-amber-600 dark:text-amber-400">{children}</strong>;
            }
            if (/🟢|success|healthy|ok\b/i.test(text)) {
              return <strong className="font-semibold text-emerald-600 dark:text-emerald-400">{children}</strong>;
            }
            if (/🔵|info/i.test(text)) {
              return <strong className="font-semibold text-blue-600 dark:text-blue-400">{children}</strong>;
            }
            return <strong className="font-semibold text-foreground dark:text-slate-100">{children}</strong>;
          },
          // Horizontal rules as section dividers
          hr() {
            return <hr className="my-3 border-border dark:border-slate-700/60" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface SqlApprovalPanelProps {
  sessionId: string;
  initialSql: string;
  onDecision: (decision: "approved" | "rejected", sql: string) => void;
  isSubmitting: boolean;
}

function SqlApprovalPanel({ sessionId, initialSql, onDecision, isSubmitting }: SqlApprovalPanelProps) {
  const [sql, setSql] = useState(initialSql);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/5 dark:border-amber-500/30 dark:bg-amber-500/5 shadow-[0_0_24px_rgba(245,158,11,0.08)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-amber-500/30 dark:border-amber-500/20 bg-amber-500/10 px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Unsafe Query — Requires Approval</span>
        <span className="ml-auto text-[10px] text-amber-600/70 dark:text-amber-500/70">Session: {sessionId.slice(-8)}</span>
      </div>

      {/* SQL editor */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Generated SQL <span className="text-amber-600/70 dark:text-amber-400/70">(editable)</span></span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-foreground/5 dark:hover:bg-white/5 hover:text-foreground dark:hover:text-slate-200"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <Textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={5}
          className="font-mono text-xs text-cyan-700 dark:text-cyan-100 bg-muted/60 dark:bg-black/40 border-amber-500/30 dark:border-amber-500/20 focus-visible:ring-amber-500/40 resize-y"
          spellCheck={false}
        />
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          ✏ You can edit the SQL above before approving. The modified query will be executed.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 border-t border-amber-500/30 dark:border-amber-500/20 bg-muted/40 dark:bg-black/20 px-4 py-3">
        <Button
          size="sm"
          disabled={isSubmitting || !sql.trim()}
          onClick={() => onDecision("approved", sql)}
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isSubmitting ? "Executing…" : "Approve & Execute"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => onDecision("rejected", sql)}
          className="gap-1.5 border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </Button>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onDecision: (sessionId: string, decision: "approved" | "rejected", sql: string) => void;
  submittingSessionId: string | null;
}

function MessageBubble({ message, onDecision, submittingSessionId }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" || message.status === "sending";
  const isWaitingApproval = message.status === "waiting_approval";

  return (
    <div
      className={cn(
        "flex w-full gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {/* Avatar — assistant side */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 shadow-[0_0_14px_rgba(6,182,212,0.25)] dark:shadow-[0_0_14px_rgba(6,182,212,0.25)]">
          <Bot className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        </div>
      )}

      {/* Bubble */}
      <div className={cn("flex max-w-[80%] flex-col gap-1.5", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md",
            isUser
              ? "rounded-tr-sm bg-primary/15 border border-primary/30 text-foreground dark:text-slate-100"
              : "rounded-tl-sm bg-secondary border border-border text-foreground dark:bg-slate-800/70 dark:border-slate-700/60 dark:text-slate-100 backdrop-blur-sm"
          )}
        >
          {isStreaming ? (
            <TypingIndicator />
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}

          {/* SQL Approval panel */}
          {isWaitingApproval && message.sqlApproval && (
            <SqlApprovalPanel
              sessionId={message.sqlApproval.sessionId}
              initialSql={message.sqlApproval.sqlQuery}
              isSubmitting={submittingSessionId === message.sqlApproval.sessionId}
              onDecision={(decision, sql) =>
                onDecision(message.sqlApproval!.sessionId, decision, sql)
              }
            />
          )}
        </div>

        <div className="flex items-center gap-2 px-1">
          <MessageTimestamp date={message.timestamp} />
          {isWaitingApproval && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Awaiting approval
            </span>
          )}
          {message.status === "error" && (
            <span className="text-[10px] text-red-600 dark:text-red-400">Failed to get response</span>
          )}
        </div>
      </div>

      {/* Avatar — user side */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/30 shadow-[0_0_12px_rgba(255,49,46,0.2)]">
          <UserRound className="h-4 w-4 text-primary" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome message builder
// ---------------------------------------------------------------------------
function buildWelcomeMessage(selectedDb: string, dbTarget?: DatabaseTarget): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `👋 Hi! I'm connected to **${selectedDb}** (${dbTarget?.env_label ?? "PROD"} · ${dbTarget?.db_type ?? "Standalone"} · ${dbTarget?.os ?? "Windows"}).\n\nAsk me anything about your database in plain English — I'll write the SQL, run it, and explain the results. Pick a suggestion below or type your own question.`,
    timestamp: new Date(),
    status: "done"
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChatWithDb() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const databases = useAppStore((s) => s.databases);
  const dbTarget = databases.find((db) => db.name === selectedDb);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Restore from sessionStorage if available and contains actual user conversation
    const cached = loadChatFromSession(selectedDb);
    const hasUserMessages = cached?.some((m) => m.role === "user");
    return cached && hasUserMessages ? cached : [buildWelcomeMessage(selectedDb, dbTarget)];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // session being polled for approval
  const [pollingSessionId, setPollingSessionId] = useState<string | null>(null);
  // session that has a submitted approval in-flight
  const [submittingSessionId, setSubmittingSessionId] = useState<string | null>(null);

  // DB Prompts & Actions sidebar drawer state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [promptTypeFilter, setPromptTypeFilter] = useState<PromptTypeFilter>("all");
  const [activeCategory, setActiveCategory] = useState<SuggestedCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSelectedDb = useRef(selectedDb);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, []);

  // Filtered prompts based on type, category, and search
  const filteredPrompts = useMemo(() => {
    return SUGGESTED_PROMPTS.filter((item) => {
      const matchesType = promptTypeFilter === "all" || item.type === promptTypeFilter;
      const matchesCategory = activeCategory === "All" || item.category === activeCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.shortTitle.toLowerCase().includes(q) ||
        item.prompt.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.oracleViews.toLowerCase().includes(q);
      return matchesType && matchesCategory && matchesSearch;
    });
  }, [promptTypeFilter, activeCategory, searchQuery]);

  const handleDownloadChat = useCallback(() => {
    if (messages.length === 0) return;

    let content = `Chat Export - DB: ${selectedDb}\n`;
    content += `Date: ${new Date().toLocaleString()}\n`;
    content += `==================================================\n\n`;

    messages.forEach((msg) => {
      const role = msg.role === "user" ? "You" : "DBA Assistant";
      const time = msg.timestamp.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      content += `[${time}] ${role}:\n${msg.content}\n\n`;
      
      if (msg.sqlApproval && msg.sqlApproval.sqlQuery) {
        content += `[Generated SQL]:\n${msg.sqlApproval.sqlQuery}\n\n`;
      }
    });

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dba-chat-${selectedDb}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [messages, selectedDb]);

  // ---------------------------------------------------------------------------
  // Persist messages to sessionStorage whenever they change (only if messages belong to selectedDb)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (prevSelectedDb.current === selectedDb) {
      saveChatToSession(selectedDb, messages);
    }
  }, [messages, selectedDb]);

  // ---------------------------------------------------------------------------
  // Fix #1 — Reset chat session immediately when DB changes or update welcome metadata
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (prevSelectedDb.current !== selectedDb) {
      // Save previous DB chat session if it contains user interaction
      if (prevSelectedDb.current && messages.some((m) => m.role === "user")) {
        saveChatToSession(prevSelectedDb.current, messages);
      }

      prevSelectedDb.current = selectedDb;

      // Stop any in-flight polling
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setPollingSessionId(null);
      setSubmittingSessionId(null);
      setIsLoading(false);
      setInput("");

      const newDbTarget = databases.find((db) => db.name === selectedDb);
      const cached = loadChatFromSession(selectedDb);
      const hasUserMessages = cached?.some((m) => m.role === "user");

      setMessages(cached && hasUserMessages ? cached : [buildWelcomeMessage(selectedDb, newDbTarget)]);
    } else if (messages.length === 1 && messages[0].id === "welcome") {
      const currentWelcome = buildWelcomeMessage(selectedDb, dbTarget);
      if (messages[0].content !== currentWelcome.content) {
        setMessages([currentWelcome]);
      }
    }
  }, [databases, selectedDb, dbTarget, messages]);

  // ---------------------------------------------------------------------------
  // Polling for approval
  // ---------------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (sessionId: string, assistantMsgId: string) => {
      stopPolling();
      setPollingSessionId(sessionId);

      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/chat/approval/${sessionId}`);
          if (!res.ok) return;
          const data = (await res.json()) as {
            status: "none" | "pending";
            sql_query?: string;
          };

          if (data.status === "pending" && data.sql_query) {
            stopPolling();
            setPollingSessionId(null);

            // Update the streaming assistant message to show approval panel
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      status: "waiting_approval",
                      content: "A query was generated that requires your approval before execution:",
                      sqlApproval: {
                        sessionId,
                        sqlQuery: data.sql_query!,
                        resumeUrl: "",
                        status: "pending"
                      }
                    }
                  : m
              )
            );
            scrollToBottom();
          }
        } catch {
          // network error — keep polling
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, scrollToBottom]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ---------------------------------------------------------------------------
  // Send query
  // ---------------------------------------------------------------------------
  const sendQuery = useCallback(
    async (queryText: string) => {
      const query = queryText.trim();
      if (!query || isLoading) return;

      setInput("");
      setIsLoading(true);

      const sessionId = `chat-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const userMsg: ChatMessage = {
        id: `U-${Date.now()}`,
        role: "user",
        content: query,
        timestamp: new Date(),
        status: "done"
      };

      const assistantId = `A-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        status: "streaming"
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      scrollToBottom();

      // Start polling for unsafe-query approval callbacks
      startPolling(sessionId, assistantId);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, db: selectedDb, session_id: sessionId })
        });

        stopPolling();
        setPollingSessionId(null);

        if (!response.ok) {
          const err = (await response.json()) as { message?: string };
          throw new Error(err.message || `HTTP ${response.status}`);
        }

        const data = (await response.json()) as {
          status?: string;
          reply?: string;
          sql_query?: string;
        };

        stopPolling();
        setPollingSessionId(null);

        // Check if n8n sent this query for approval (either returned by /api/chat or in pending store)
        let pendingSqlQuery = data.status === "pending" ? data.sql_query : undefined;

        if (!pendingSqlQuery) {
          try {
            const checkRes = await fetch(`/api/chat/approval/${sessionId}`);
            if (checkRes.ok) {
              const checkData = (await checkRes.json()) as { status: string; sql_query?: string };
              if (checkData.status === "pending" && checkData.sql_query) {
                pendingSqlQuery = checkData.sql_query;
              }
            }
          } catch {
            // ignore network error
          }
        }

        if (pendingSqlQuery) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    status: "waiting_approval",
                    content: "A query was generated that requires your approval before execution:",
                    sqlApproval: {
                      sessionId,
                      sqlQuery: pendingSqlQuery!,
                      resumeUrl: "",
                      status: "pending"
                    }
                  }
                : m
            )
          );
        } else if (data.reply) {
          const reply = data.reply;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === assistantId || m.sqlApproval?.sessionId === sessionId) {
                if (m.sqlApproval?.status === "rejected") return m;
                return { ...m, content: reply, status: "done" };
              }
              return m;
            })
          );
        }
      } catch (error) {
        stopPolling();
        setPollingSessionId(null);

        const msg = error instanceof Error ? error.message : "Request failed.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠ Error: ${msg}`, status: "error" }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        scrollToBottom();
        inputRef.current?.focus();
      }
    },
    [isLoading, selectedDb, startPolling, stopPolling, scrollToBottom]
  );

  // ---------------------------------------------------------------------------
  // Handle approval decision (in-place single-card updates)
  // ---------------------------------------------------------------------------
  const handleDecision = useCallback(
    async (sessionId: string, decision: "approved" | "rejected", sql: string) => {
      setSubmittingSessionId(sessionId);

      if (decision === "rejected") {
        setMessages((prev) =>
          prev.map((m) =>
            m.sqlApproval?.sessionId === sessionId
              ? {
                  ...m,
                  status: "done",
                  content: "❌ Query rejected.",
                  sqlApproval: { ...m.sqlApproval!, status: "rejected" }
                }
              : m
          )
        );
      } else {
        // Approved: transition card in-place to streaming state with executing indicator
        setMessages((prev) =>
          prev.map((m) =>
            m.sqlApproval?.sessionId === sessionId
              ? {
                  ...m,
                  status: "streaming",
                  content: "⏳ Executing query…",
                  sqlApproval: { ...m.sqlApproval!, status: "approved" }
                }
              : m
          )
        );
      }

      try {
        const response = await fetch(`/api/chat/approval/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, sql_query: sql })
        });

        const data = (await response.json()) as {
          status?: string;
          decision?: string;
          reply?: string | null;
          message?: string;
        };

        if (!response.ok) {
          throw new Error(data.message || `HTTP ${response.status}`);
        }

        // If n8n returned a direct execution reply on the resume call, update the card in-place
        if (decision === "approved" && data.reply) {
          const reply = data.reply;
          setMessages((prev) =>
            prev.map((m) =>
              m.sqlApproval?.sessionId === sessionId
                ? {
                    ...m,
                    content: reply,
                    status: "done"
                  }
                : m
            )
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to submit decision.";
        setMessages((prev) =>
          prev.map((m) =>
            m.sqlApproval?.sessionId === sessionId
              ? {
                  ...m,
                  content: `⚠ ${msg}`,
                  status: "error"
                }
              : m
          )
        );
      } finally {
        setSubmittingSessionId(null);
        scrollToBottom();
      }
    },
    [scrollToBottom]
  );

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------
  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    sendQuery(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Fullscreen backdrop overlay */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 dark:bg-black/70 backdrop-blur-sm"
          onClick={() => setIsFullscreen(false)}
        />
      )}

      <div
        className={cn(
          "flex overflow-hidden rounded-2xl border border-border bg-card shadow-xl dark:border-slate-700/50 dark:bg-slate-900/60 dark:shadow-2xl dark:shadow-black/40 dark:backdrop-blur-xl transition-all duration-300",
          isFullscreen
            ? "fixed inset-4 z-50 h-auto"
            : "h-[calc(100vh-10rem)]"
        )}
      >

        {/* ── Main Chat Container (Clean Chat Window) ── */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Header */}
          <div className="relative border-b border-border bg-card/80 dark:border-slate-700/50 dark:bg-slate-900/80 px-5 py-3.5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 dark:via-cyan-400/50 to-transparent" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 shadow-[0_0_18px_rgba(6,182,212,0.15)] dark:shadow-[0_0_18px_rgba(6,182,212,0.25)]">
                  <Terminal className="h-4.5 w-4.5 text-cyan-600 dark:text-cyan-300" />
                  <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400 border border-card dark:border-slate-900" />
                  </span>
                </div>
                <div className="leading-tight">
                  <h2 className="text-sm font-semibold bg-gradient-to-r from-cyan-600 to-foreground dark:from-cyan-200 dark:to-slate-100 bg-clip-text text-transparent">
                    Chat with DB
                  </h2>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="inline-block h-1 w-1 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    AI Online · Text-to-SQL & DB Activities via n8n
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {pollingSessionId && (
                  <span className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-600 dark:border-amber-500/30 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 dark:bg-amber-400" />
                    Waiting for unsafe query review…
                  </span>
                )}
                <div className="flex items-center gap-1.5 rounded-full border border-border bg-secondary text-muted-foreground dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-400 px-3 py-1.5 text-[11px]">
                  <Database className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
                  <span className="font-medium text-foreground dark:text-slate-200">{selectedDb}</span>
                  <span className="text-muted-foreground/50 dark:text-slate-600">·</span>
                  <span>{dbTarget?.env_label ?? "PROD"}</span>
                </div>

                {/* Sidebar drawer toggle button */}
                <button
                  type="button"
                  onClick={() => setSidebarOpen((s) => !s)}
                  title={sidebarOpen ? "Hide Prompts & Actions sidebar" : "Show Prompts & Actions sidebar"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all",
                    sidebarOpen
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
                      : "border-border bg-secondary text-muted-foreground hover:bg-muted dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300"
                  )}
                >
                  {sidebarOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="hidden sm:inline">DB Prompts &amp; Actions</span>
                  <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.2 text-[9px] font-semibold text-cyan-700 dark:text-cyan-300">
                    {SUGGESTED_PROMPTS.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadChat}
                  title="Download chat history"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-300"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreen((f) => !f)}
                  title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-300"
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* ── Messages (Clean Message Window) ── */}
          <ScrollArea className="relative flex-1 px-4 py-4">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-card/80 to-transparent dark:from-slate-900/80" />
            <div className="relative space-y-5">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onDecision={handleDecision}
                  submittingSessionId={submittingSessionId}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* ── Input Area ── */}
          <div className="border-t border-border bg-card/80 dark:border-slate-700/50 dark:bg-slate-900/80 p-4">
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/60 dark:border-slate-700/60 dark:bg-slate-800/50 px-4 py-3 transition-all focus-within:border-cyan-500/50 focus-within:bg-secondary dark:focus-within:bg-slate-800/70 focus-within:shadow-[0_0_0_1px_rgba(6,182,212,0.25),0_0_24px_rgba(6,182,212,0.12)]">
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground transition-colors focus-within:text-cyan-600 dark:focus-within:text-cyan-400" />
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything or run database activities… (Shift+Enter for new line)"
                  rows={1}
                  disabled={isLoading}
                  className="min-h-0 flex-1 resize-none border-none bg-transparent p-0 text-sm text-foreground dark:text-slate-100 placeholder:text-muted-foreground dark:placeholder:text-slate-500 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading || !input.trim()}
                  className="h-8 shrink-0 gap-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 px-3.5 text-white shadow-[0_0_16px_rgba(6,182,212,0.25)] transition-all hover:from-cyan-500 hover:to-blue-500 hover:shadow-[0_0_22px_rgba(6,182,212,0.4)] disabled:from-slate-400 dark:disabled:from-slate-700 dark:disabled:to-slate-700 disabled:shadow-none disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:300ms]" />
                    </span>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Send
                    </>
                  )}
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-center gap-4 px-1">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground dark:text-slate-600">
                  <ChevronRight className="h-3 w-3" />
                  Results are AI-generated · Unsafe DML/DDL queries require explicit approval
                </p>
                {messages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessages([buildWelcomeMessage(selectedDb, dbTarget)]);
                      try { sessionStorage.removeItem(CHAT_STORAGE_PREFIX + selectedDb); } catch {}
                    }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground dark:text-slate-600 transition hover:text-amber-600 dark:hover:text-amber-400"
                  >
                    <X className="h-3 w-3" />
                    Clear chat
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* ── Dedicated DB Prompts & Actions Sidebar Panel ── */}
        {sidebarOpen && (
          <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col border-l border-border bg-card/95 dark:border-slate-800/80 dark:bg-slate-900/90 shadow-lg backdrop-blur-md transition-all duration-300">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between border-b border-border dark:border-slate-800/80 px-4 py-3 bg-muted/40 dark:bg-slate-900/60">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-foreground dark:text-slate-100 uppercase tracking-wider">
                    DB Prompts &amp; Actions
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    {filteredPrompts.length} templates available
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Type Filters & Search */}
            <div className="p-3 border-b border-border/60 dark:border-slate-800/60 bg-muted/20 dark:bg-slate-900/40 space-y-2.5">
              {/* Type filter tabs (All / Actions / Queries) */}
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1 dark:bg-slate-800/60 text-[10px] font-medium">
                <button
                  type="button"
                  onClick={() => setPromptTypeFilter("all")}
                  className={cn(
                    "rounded-md py-1 text-center transition-all",
                    promptTypeFilter === "all"
                      ? "bg-card text-foreground font-semibold shadow-sm dark:bg-slate-700 dark:text-slate-100"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All ({SUGGESTED_PROMPTS.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPromptTypeFilter("action")}
                  className={cn(
                    "rounded-md py-1 text-center transition-all flex items-center justify-center gap-1",
                    promptTypeFilter === "action"
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Zap className="h-2.5 w-2.5 text-amber-500" />
                  Actions ({SUGGESTED_PROMPTS.filter((p) => p.type === "action").length})
                </button>
                <button
                  type="button"
                  onClick={() => setPromptTypeFilter("query")}
                  className={cn(
                    "rounded-md py-1 text-center transition-all flex items-center justify-center gap-1",
                    promptTypeFilter === "query"
                      ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Queries ({SUGGESTED_PROMPTS.filter((p) => p.type === "query").length})
                </button>
              </div>

              {/* Search bar */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search actions or SQL..."
                  className="w-full rounded-lg border border-border bg-card dark:border-slate-700/60 dark:bg-slate-800/50 pl-7 pr-6 py-1.5 text-[11px] text-foreground dark:text-slate-200 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Category tabs */}
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pt-0.5">
                {SUGGESTED_CATEGORIES.map((cat) => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all",
                        isActive
                          ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40"
                          : "bg-secondary text-muted-foreground hover:text-foreground dark:bg-slate-800/60"
                      )}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Prompts & Actions list */}
            <ScrollArea className="flex-1 p-3">
              {filteredPrompts.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No DB actions or queries match your filter.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredPrompts.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setInput(item.prompt);
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                      className={cn(
                        "group flex flex-col justify-between cursor-pointer rounded-xl border p-3 transition-all shadow-sm hover:shadow-md",
                        item.type === "action"
                          ? "border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/60 dark:border-amber-500/20 dark:bg-amber-500/[0.03] dark:hover:border-amber-500/50"
                          : "border-border bg-card hover:border-cyan-500/50 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-cyan-500/40"
                      )}
                    >
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-1.5">
                          <span
                            className={cn(
                              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                              item.type === "action"
                                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                : "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300"
                            )}
                          >
                            {item.type === "action" ? <Zap className="h-2.5 w-2.5 fill-amber-500" /> : <Search className="h-2.5 w-2.5" />}
                            {item.type === "action" ? "Executable Action" : "Read-Only Query"}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground truncate max-w-[130px] bg-muted/60 dark:bg-slate-900/60 px-1 py-0.5 rounded">
                            {item.oracleViews}
                          </span>
                        </div>

                        <h4 className="text-xs font-semibold text-foreground dark:text-slate-100 group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors">
                          {item.shortTitle}
                        </h4>
                        <p className="mt-1 text-[11px] font-medium leading-snug text-muted-foreground dark:text-slate-300">
                          &quot;{item.prompt}&quot;
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70 dark:text-slate-400">
                          {item.description}
                        </p>
                      </div>

                      <div className="mt-2.5 flex items-center justify-end pt-1.5 border-t border-border/30 dark:border-slate-700/30">
                        <span
                          className={cn(
                            "flex items-center gap-1 text-[10px] font-semibold transition-transform group-hover:translate-x-0.5",
                            item.type === "action" ? "text-amber-600 dark:text-amber-400" : "text-cyan-600 dark:text-cyan-400"
                          )}
                        >
                          Use Template
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Inline styles for markdown prose inside dark chat bubbles */}
      <style jsx global>{`
        .markdown-body p:last-child { margin-bottom: 0; }
        .markdown-body pre { margin: 0; }
        .markdown-body > *:first-child { margin-top: 0; }
        .markdown-body > *:last-child { margin-bottom: 0; }
      `}</style>
    </>
  );
}
