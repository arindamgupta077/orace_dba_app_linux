"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Download, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, formatAppDateTime } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { SecurityPostureProcessingStatus, SecurityPostureReport } from "@/types/dba";

const statusStyles: Record<SecurityPostureProcessingStatus, string> = {
  UPLOADED: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  PROCESSING: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  COMPLETED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  FAILED: "border-red-400/30 bg-red-500/10 text-red-300"
};

function formatDate(value?: string) {
  return value ? formatAppDateTime(value) : "—";
}

export function SecurityPostureCard() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const user = useAppStore((state) => state.user);
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<SecurityPostureReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

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
  useEffect(() => {
    if (!report || !["UPLOADED", "PROCESSING"].includes(report.processing_status)) return;
    const timer = window.setInterval(() => void loadReport(true), 10_000);
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

  const isOutdated = report ? Date.now() - new Date(report.uploaded_at).getTime() > 30 * 24 * 60 * 60 * 1000 : false;
  const canUpload = user?.role === "client";

  return (
    <>
      <section className="flex w-full max-w-[640px] flex-wrap items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.04] px-3 py-2 shadow-[0_0_16px_rgba(139,92,246,0.06)] sm:flex-nowrap" aria-label="Security Posture Management">
        <div className="flex min-w-0 shrink items-center gap-2">
          <span className="shrink-0 rounded-md border border-violet-400/25 bg-violet-400/10 p-1 text-violet-300"><ShieldCheck className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 leading-tight"><p className="text-xs font-semibold text-foreground">Security Posture</p><p className="text-[10px] text-muted-foreground">Nessus scan report</p></div>
          {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : report ? <Badge variant="outline" className={cn("h-5 shrink-0 text-[10px] font-bold", statusStyles[report.processing_status])}>{report.processing_status === "PROCESSING" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}{report.processing_status}</Badge> : <span className="truncate text-[11px] text-muted-foreground">No active report</span>}
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

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-violet-300" />AI Security Posture Summary</DialogTitle><DialogDescription>{selectedDb} · {report?.original_filename}</DialogDescription></DialogHeader>
          {report?.processing_status === "COMPLETED" ? <div className="space-y-4"><div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/50 p-3 text-sm leading-6">{report.ai_summary || "No summary was returned."}</div><div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">AI model</p><p className="font-medium">{report.ai_model || "Not reported"}</p></div><div><p className="text-muted-foreground">Generated</p><p className="font-medium">{formatDate(report.summary_generated_at)}</p></div></div></div> : report?.processing_status === "FAILED" ? <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{report.error_message || "AI summary generation failed."}</div> : <div className="flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-200"><Loader2 className="h-4 w-4 animate-spin" />Processing AI Summary...</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
