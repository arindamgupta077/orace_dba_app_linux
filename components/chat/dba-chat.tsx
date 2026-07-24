"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Maximize2,
  MessageSquare,
  Minimize2,
  Send,
  Sparkles,
  Terminal,
  UserRound,
  X,
  XCircle,
  Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/components/providers/theme-provider";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
import type { ChatMessage, DatabaseTarget } from "@/types/dba";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUGGESTED_PROMPTS = [
  "Show all tablespaces and their usage",
  "List active sessions right now",
  "Find blocking locks in the database",
  "Show top 10 long running queries",
  "What is the RMAN backup status for the last 7 days?",
  "Show invalid objects in APPS schema",
  "Check CPU and memory usage",
  "List all wait events"
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
    // Restore from sessionStorage if available (survives page navigation)
    const cached = loadChatFromSession(selectedDb);
    return cached && cached.length > 0 ? cached : [buildWelcomeMessage(selectedDb, dbTarget)];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // session being polled for approval
  const [pollingSessionId, setPollingSessionId] = useState<string | null>(null);
  // session that has a submitted approval in-flight
  const [submittingSessionId, setSubmittingSessionId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSelectedDb = useRef(selectedDb);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, []);

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
  // Persist messages to sessionStorage whenever they change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    saveChatToSession(selectedDb, messages);
  }, [messages, selectedDb]);

  // ---------------------------------------------------------------------------
  // Fix #1 — Reset chat session immediately when DB changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (prevSelectedDb.current !== selectedDb) {
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
      // Try to restore from sessionStorage for this DB, otherwise fresh welcome
      const cached = loadChatFromSession(selectedDb);
      setMessages(cached && cached.length > 0 ? cached : [buildWelcomeMessage(selectedDb, newDbTarget)]);
    }
  }, [databases, selectedDb]);

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
      {/* Fix #4: Fullscreen backdrop overlay */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 dark:bg-black/70 backdrop-blur-sm"
          onClick={() => setIsFullscreen(false)}
        />
      )}

      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl dark:border-slate-700/50 dark:bg-slate-900/60 dark:shadow-2xl dark:shadow-black/40 dark:backdrop-blur-xl transition-all duration-300",
          isFullscreen
            ? "fixed inset-4 z-50 h-auto"
            : "h-[calc(100vh-10rem)]"
        )}
      >

        {/* ── Header ── */}
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
                  AI online · Ask in plain English
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
              <button
                type="button"
                onClick={handleDownloadChat}
                title="Download chat history"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-300"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              {/* Fix #4: Fullscreen toggle button */}
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

        {/* ── Suggested prompts strip ── */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-muted/30 dark:border-slate-800/60 dark:bg-slate-900/40 px-4 py-2.5 scrollbar-none">
          <span className="hidden shrink-0 items-center gap-1 pr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-slate-600 sm:flex">
            <Sparkles className="h-3 w-3 text-cyan-600/70 dark:text-cyan-500/70" />
            Try
          </span>
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => sendQuery(prompt)}
              disabled={isLoading}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary text-muted-foreground dark:border-slate-700/50 dark:bg-slate-800/50 dark:text-slate-400 px-3 py-1 text-[11px] transition-all hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-700 dark:hover:text-cyan-200 hover:shadow-[0_0_12px_rgba(6,182,212,0.15)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3 text-cyan-600/60 dark:text-cyan-500/60 transition-colors group-hover:text-cyan-300" />
              {prompt}
            </button>
          ))}
        </div>

        {/* ── Messages ── */}
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

        {/* ── Input area ── */}
        <div className="border-t border-border bg-card/80 dark:border-slate-700/50 dark:bg-slate-900/80 p-4">
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/60 dark:border-slate-700/60 dark:bg-slate-800/50 px-4 py-3 transition-all focus-within:border-cyan-500/50 focus-within:bg-secondary dark:focus-within:bg-slate-800/70 focus-within:shadow-[0_0_0_1px_rgba(6,182,212,0.25),0_0_24px_rgba(6,182,212,0.12)]">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground transition-colors focus-within:text-cyan-600 dark:focus-within:text-cyan-400" />
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your Oracle DB…  (Shift+Enter for new line)"
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
            {/* Fix #5: Center-aligned footer text */}
            <div className="mt-2 flex items-center justify-center gap-4 px-1">
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground dark:text-slate-600">
                <ChevronRight className="h-3 w-3" />
                Results are AI-generated · Always review before acting
              </p>
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages([buildWelcomeMessage(selectedDb, dbTarget)]);
                    // Also clear sessionStorage for this DB
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
