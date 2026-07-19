"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Clock3, Download, FileUp, Loader2, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SECURITY_POSTURE_OUTDATED_AFTER_MS } from "@/lib/security-posture-policy";
import { formatAppDateTime } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { SecurityPostureProcessingStatus, SecurityPostureReport } from "@/types/dba";

/* ------------------------------------------------------------------ */
/*  Status indicator components                                        */
/* ------------------------------------------------------------------ */

/** Compact inline badge shown while AI is processing the report. */
function ProcessingBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-sp-glow rounded-full bg-cyan-400" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
      </span>
      <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
      <span className="text-[10px] font-semibold tracking-wide text-cyan-300">AI Processing</span>
    </span>
  );
}

/** Compact inline badge shown when AI summary is ready. */
function CompletedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5">
      <Sparkles className="h-3 w-3 text-emerald-400" />
      <span className="text-[10px] font-semibold tracking-wide text-emerald-300">AI Summary Ready</span>
    </span>
  );
}

/** Simple icon for UPLOADED / FAILED states. */
function StatusIcon({ status }: { status: SecurityPostureProcessingStatus }) {
  const map: Record<SecurityPostureProcessingStatus, { Icon: typeof Clock3; cls: string; label: string }> = {
    UPLOADED: { Icon: Clock3, cls: "text-slate-400", label: "Report uploaded" },
    PROCESSING: { Icon: Loader2, cls: "animate-spin text-cyan-400", label: "AI processing in progress" },
    COMPLETED: { Icon: CheckCircle2, cls: "text-emerald-400", label: "Report processing completed" },
    FAILED: { Icon: XCircle, cls: "text-red-400", label: "Report processing failed" }
  };
  const { Icon, cls, label } = map[status];
  return <span className="shrink-0" aria-label={label} title={label}><Icon className={`h-4 w-4 ${cls}`} /></span>;
}

function formatDate(value?: string) {
  return value ? formatAppDateTime(value) : "—";
}

function SummaryContent({ summary }: { summary?: string }) {
  const content = summary?.replace(/\\n/g, "\n").trim() || "No summary was returned.";
  return (
    <div className="overflow-hidden rounded-xl border border-violet-500/20 bg-muted/30 shadow-inner">
      <div className="flex items-center gap-2 border-b border-violet-500/15 bg-violet-500/[0.06] px-4 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-800 dark:text-violet-200">AI findings</p>
      </div>
      <div className="max-h-[65vh] overflow-y-auto p-4 text-sm leading-6 text-foreground/90">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h2 className="mb-3 mt-1 border-b border-violet-500/20 pb-2 text-base font-bold tracking-tight text-violet-800 first:mt-0 dark:text-violet-100">{children}</h2>,
            h2: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-bold text-cyan-800 first:mt-0 dark:text-cyan-100">{children}</h3>,
            h3: ({ children }) => <h4 className="mb-1 mt-4 text-sm font-semibold text-foreground">{children}</h4>,
            p: ({ children }) => <p className="mb-3 text-foreground/85 last:mb-0 dark:text-foreground/90">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc space-y-1.5 pl-5 marker:text-cyan-600 dark:marker:text-cyan-400">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-cyan-700 dark:marker:text-cyan-400">{children}</ol>,
            li: ({ children }) => <li className="pl-0.5 text-foreground/85 dark:text-foreground/90">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-cyan-800 dark:text-cyan-100">{children}</strong>,
            em: ({ children }) => <em className="text-foreground/80">{children}</em>,
            blockquote: ({ children }) => <blockquote className="my-4 rounded-r-md border-l-4 border-amber-500 bg-amber-500/10 py-2 pl-3 pr-2 text-amber-950 dark:text-amber-100">{children}</blockquote>,
            code: ({ className, children }) => className
              ? <code className="block overflow-x-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100 dark:bg-black/50">{children}</code>
              : <code className="rounded bg-violet-500/10 px-1 py-0.5 font-mono text-[0.8em] text-violet-800 dark:text-violet-100">{children}</code>,
            pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md">{children}</pre>,
            hr: () => <hr className="my-4 border-border/70" />,
            table: ({ children }) => <div className="my-4 overflow-x-auto rounded-lg border border-border/70 bg-background"><table className="w-full text-left text-xs">{children}</table></div>,
            th: ({ children }) => <th className="border-b border-border/70 bg-muted/70 px-3 py-2 font-semibold text-cyan-900 dark:text-cyan-100">{children}</th>,
            td: ({ children }) => <td className="border-b border-border/50 px-3 py-2 align-top text-foreground/85 last:border-b-0">{children}</td>,
            a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-cyan-700 underline underline-offset-2 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-200">{children}</a>
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main card                                                          */
/* ------------------------------------------------------------------ */

export function SecurityPostureCard() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const user = useAppStore((state) => state.user);
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<SecurityPostureReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Track the previous processing status so we can fire a toast on transition.
  const prevStatusRef = useRef<SecurityPostureProcessingStatus | null>(null);

  const loadReport = useCallback(async (quiet = false) => {
    if (!selectedDb) return setReport(null);
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/security-posture?database=${encodeURIComponent(selectedDb)}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { message?: string }).message || "Unable to load report.");
      const payload = await response.json() as { report: SecurityPostureReport | null };
      setReport(payload.report);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load security posture.");
      setReport(null);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [selectedDb]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  // Detect status transitions and notify the user.
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = report?.processing_status ?? null;
    if (prev && curr && prev !== curr) {
      if (curr === "PROCESSING") {
        toast.info("AI is now analysing the Nessus report…");
      } else if (curr === "COMPLETED") {
        toast.success("AI security summary is ready.", { icon: "✨" });
      } else if (curr === "FAILED") {
        toast.error(report?.error_message || "AI summary generation failed.");
      }
    }
    prevStatusRef.current = curr;
  }, [report]);

  const isProcessing = report?.processing_status === "PROCESSING";

  useEffect(() => {
    if (!report || !["UPLOADED", "PROCESSING"].includes(report.processing_status)) return;
    // Poll faster (3s) when UPLOADED — waiting for n8n to flip to PROCESSING.
    // Once PROCESSING, poll at 8s — just waiting for completion.
    const interval = report.processing_status === "UPLOADED" ? 3_000 : 8_000;
    const timer = window.setInterval(() => void loadReport(true), interval);
    return () => window.clearInterval(timer);
  }, [loadReport, report]);

  const upload = async (file?: File) => {
    if (!file || !selectedDb) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF Nessus scan reports may be uploaded.");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("database", selectedDb);
      body.append("file", file);
      const response = await fetch("/api/security-posture", { method: "POST", body });
      const payload = await response.json().catch(() => ({})) as { report?: SecurityPostureReport; message?: string };
      if (!response.ok || !payload.report) throw new Error(payload.message || "Upload failed.");
      setReport(payload.report);
      toast.success(payload.report.processing_status === "FAILED" ? "Report uploaded, but AI processing could not start." : "Nessus report uploaded. AI processing has started.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const isOutdated = report ? Date.now() - new Date(report.uploaded_at).getTime() > SECURITY_POSTURE_OUTDATED_AFTER_MS : false;
  const canUpload = user?.role === "client";

  /* ---------- Status-dependent inline indicator ---------- */
  const statusIndicator = (() => {
    if (loading) return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
    if (!report) return <span className="truncate text-[11px] text-muted-foreground">No active report</span>;
    if (report.processing_status === "PROCESSING") return <ProcessingBadge />;
    if (report.processing_status === "COMPLETED") return <StatusIcon status={report.processing_status} />;
    return <StatusIcon status={report.processing_status} />;
  })();

  /* ---------- Card wrapper — shimmer border when processing ---------- */
  const cardContent = (
    <section
      className={[
        "flex w-fit max-w-full flex-wrap items-center gap-4 rounded-xl border px-3 py-2 sm:flex-nowrap transition-all duration-500",
        isProcessing
          ? "border-cyan-500/25 bg-gradient-to-r from-cyan-500/[0.04] via-transparent to-cyan-500/[0.04] shadow-[0_0_20px_rgba(34,211,238,0.08)]"
          : "border-violet-400/20 bg-violet-500/[0.04] shadow-[0_0_16px_rgba(139,92,246,0.06)]"
      ].join(" ")}
      aria-label="Security Posture Management"
    >
      <div className="flex min-w-0 shrink items-center gap-2">
        <span className={`shrink-0 rounded-md border p-1 transition-colors duration-500 ${isProcessing ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-300" : "border-violet-400/25 bg-violet-400/10 text-violet-300"}`}>
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 leading-tight"><p className="text-xs font-semibold text-foreground">Security Posture</p><p className="text-[10px] text-muted-foreground">Nessus scan report</p></div>
        {statusIndicator}
        {report && isOutdated && <span className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-400/60 bg-red-500/20 px-1.5 text-[9px] font-bold text-red-200 shadow-[0_0_10px_rgba(239,68,68,0.4)] motion-safe:animate-pulse"><AlertTriangle className="h-2.5 w-2.5 motion-safe:animate-bounce" />Outdated</span>}
      </div>
      <div className="min-w-0 flex-1 text-[10px] text-muted-foreground sm:order-2">
        {report ? <span className="block truncate">Uploaded {formatDate(report.uploaded_at)} by {report.uploaded_by}</span> : <span className="block truncate">Select a report to begin AI security analysis.</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:order-3">
        {report && <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setSummaryOpen(true)} aria-label="Open AI security summary" title="AI Summary"><Bot className="h-3.5 w-3.5" /></Button>}
        {canUpload && <><Input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} /><Button size="icon" variant="outline" className="h-7 w-7" onClick={() => inputRef.current?.click()} disabled={!selectedDb || uploading} aria-label="Upload Nessus scan report" title="Upload report">{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}</Button></>}
        {report && <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Download Nessus scan report" title="Download report" asChild><a href={`/api/security-posture/${report.id}/download`}><Download className="h-3.5 w-3.5" /></a></Button>}
      </div>
    </section>
  );

  return (
    <>
      {/* During processing, wrap the card in a shimmer-border container */}
      {isProcessing ? (
        <div className="relative w-fit rounded-[13px] p-px" aria-hidden="false">
          {/* Animated gradient border */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[13px] animate-sp-shimmer"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.25) 25%, rgba(139,92,246,0.2) 50%, rgba(34,211,238,0.25) 75%, transparent 100%)",
              backgroundSize: "200% 100%",
              mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
              maskComposite: "exclude",
              WebkitMaskComposite: "xor",
              padding: "1.5px"
            }}
          />
          {cardContent}
        </div>
      ) : cardContent}

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-violet-300" />AI Security Posture Summary</DialogTitle><DialogDescription>{selectedDb} · {report?.original_filename}</DialogDescription></DialogHeader>
          {report?.processing_status === "COMPLETED" ? <div className="space-y-4"><SummaryContent summary={report.ai_summary} /><div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-background/30 p-3 text-xs"><div><p className="text-muted-foreground">AI model</p><p className="mt-0.5 font-medium text-foreground">{report.ai_model || "Not reported"}</p></div><div><p className="text-muted-foreground">Generated</p><p className="mt-0.5 font-medium text-foreground">{formatDate(report.summary_generated_at)}</p></div></div></div> : report?.processing_status === "FAILED" ? <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{report.error_message || "AI summary generation failed."}</div> : <div className="flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-200"><Loader2 className="h-4 w-4 animate-spin" />Processing AI Summary...</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
