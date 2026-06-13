"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Clock,
  Database,
  FileInput,
  FileOutput,
  Server,
  Shield,
  Zap
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ExpdpModal } from "@/components/datapump/expdp-modal";
import { ImpdpModal } from "@/components/datapump/impdp-modal";
import { LogViewerModal } from "@/components/datapump/log-viewer-modal";
import { ActiveJobsBanner } from "@/components/datapump/active-jobs-banner";
import { findDatabaseTarget } from "@/lib/constants";
import { useAppStore } from "@/store/use-app-store";

/* ------------------------------------------------------------------ */
/* Action Card                                                           */
/* ------------------------------------------------------------------ */

interface ActionCardProps {
  section: "expdp" | "impdp";
  title: string;
  subtitle: string;
  description: string;
  features: Array<{ icon: React.ElementType; label: string }>;
  actions: Array<{
    id: string;
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    primary?: boolean;
  }>;
}

function ActionCard({ section, title, subtitle, description, features, actions }: ActionCardProps) {
  const isExpdp = section === "expdp";

  // Color tokens
  const accent = isExpdp
    ? {
        border: "border-amber-400/20 hover:border-amber-400/40",
        glow: "bg-amber-500/8 group-hover:bg-amber-500/12",
        glow2: "bg-orange-500/5",
        shadow: "hover:shadow-amber-500/10",
        iconBg: "border-amber-400/30 bg-amber-400/10 group-hover:border-amber-400/50 group-hover:bg-amber-400/15",
        iconColor: "text-amber-300",
        label: "text-amber-400/60",
        title: "text-amber-100",
        pill: "border-amber-400/10 bg-amber-400/5 text-amber-200/70",
        pillIcon: "text-amber-400/50",
        primaryBtn: "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:border-amber-400/55 hover:bg-amber-400/20 hover:text-amber-100 hover:shadow-amber-500/15",
        secondaryBtn: "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
        gradient: "from-amber-500/5 via-orange-500/5 to-amber-600/10"
      }
    : {
        border: "border-violet-400/20 hover:border-violet-400/40",
        glow: "bg-violet-500/8 group-hover:bg-violet-500/12",
        glow2: "bg-purple-500/5",
        shadow: "hover:shadow-violet-500/10",
        iconBg: "border-violet-400/30 bg-violet-400/10 group-hover:border-violet-400/50 group-hover:bg-violet-400/15",
        iconColor: "text-violet-300",
        label: "text-violet-400/60",
        title: "text-violet-100",
        pill: "border-violet-400/10 bg-violet-400/5 text-violet-200/70",
        pillIcon: "text-violet-400/50",
        primaryBtn: "border-violet-400/30 bg-violet-400/10 text-violet-200 hover:border-violet-400/55 hover:bg-violet-400/20 hover:text-violet-100 hover:shadow-violet-500/15",
        secondaryBtn: "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
        gradient: "from-violet-500/5 via-purple-500/5 to-violet-600/10"
      };

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${accent.border} bg-gradient-to-br ${accent.gradient} p-6 transition-all duration-300 hover:shadow-xl ${accent.shadow}`}
    >
      {/* Decorative glows */}
      <div className={`pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full ${accent.glow} blur-3xl transition-all duration-500`} />
      <div className={`pointer-events-none absolute -bottom-6 -left-6 h-32 w-32 rounded-full ${accent.glow2} blur-2xl`} />

      <div className="relative space-y-5">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className={`shrink-0 rounded-xl border ${accent.iconBg} p-3.5 shadow-lg transition-all duration-300`}>
            {isExpdp
              ? <ArrowUpFromLine className={`h-6 w-6 ${accent.iconColor}`} />
              : <ArrowDownToLine className={`h-6 w-6 ${accent.iconColor}`} />
            }
          </div>
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${accent.label}`}>{subtitle}</p>
            <h2 className={`mt-0.5 text-xl font-bold ${accent.title} tracking-tight`}>{title}</h2>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>

        {/* Feature pills */}
        <div className="grid grid-cols-2 gap-2">
          {features.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className={`flex items-center gap-2 rounded-lg border ${accent.pill} px-2.5 py-1.5 text-xs`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${accent.pillIcon}`} />
              {label}
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          {actions.map(({ id, label, icon: Icon, onClick, primary }) => (
            <button
              key={id}
              id={id}
              onClick={onClick}
              className={`flex w-full items-center justify-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold shadow-inner transition-all duration-200 active:scale-[0.98] ${
                primary ? accent.primaryBtn : accent.secondaryBtn
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                             */
/* ------------------------------------------------------------------ */

export function DataPumpDashboard() {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const dbTarget = findDatabaseTarget(selectedDb);

  // Show IMPDP only for non-PROD environments
  const isProd = dbTarget?.env_label === "PROD";

  // Modal states
  const [expdpOpen, setExpdpOpen] = useState(false);
  const [impdpOpen, setImpdpOpen] = useState(false);
  const [expdpLogOpen, setExpdpLogOpen] = useState(false);
  const [impdpLogOpen, setImpdpLogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Oracle Data Pump"
        description="High-speed server-side Oracle utility for transferring and backing up data and metadata between databases. Supports both export (EXPDP) and import (IMPDP) operations with dynamic parameter configuration."
        icon={Database}
      />

      {/* Environment badge */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
          isProd
            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
            : "border-violet-400/30 bg-violet-400/10 text-violet-300"
        }`}>
          <Shield className="h-3.5 w-3.5" />
          {isProd ? "Production — EXPDP Only" : `${dbTarget?.env_label || "Non-PROD"} — EXPDP + IMPDP Available`}
        </div>
        <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground">
          <Server className="inline h-3 w-3 mr-1" />
          {selectedDb} · {dbTarget?.os}
        </div>
      </div>

      {/* Active jobs banner */}
      <ActiveJobsBanner />

      {/* ── EXPDP Section ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-amber-400/15" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400/70">
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            Export (EXPDP)
          </div>
          <div className="h-px flex-1 bg-amber-400/15" />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <ActionCard
            section="expdp"
            subtitle="Action"
            title="Take Export Backup"
            description="Configure and trigger an Oracle EXPDP export. Dynamically builds the expdp command with your selected parameters and executes it on the database server via n8n SSH automation. Supports schema filtering, compression, parallelism, and automatic dump transfer."
            features={[
              { icon: Zap, label: "Dynamic command builder" },
              { icon: Server, label: "SSH remote execution" },
              { icon: FileOutput, label: "Dump file transfer" },
              { icon: BookOpen, label: "Template save & load" }
            ]}
            actions={[
              {
                id: "btn-launch-expdp",
                label: "Take Export Backup",
                icon: ArrowUpFromLine,
                onClick: () => setExpdpOpen(true),
                primary: true
              }
            ]}
          />

          <ActionCard
            section="expdp"
            subtitle="Report"
            title="Check Latest Export Log"
            description="Retrieve and display the latest EXPDP log file directly from the Oracle server. n8n reads the log via SSH and streams the full content back to the application for review. Useful for verifying export completeness and diagnosing issues."
            features={[
              { icon: Clock, label: "Latest log only" },
              { icon: Database, label: "Full log display" },
              { icon: FileOutput, label: "Download log file" },
              { icon: Zap, label: "SSH log retrieval" }
            ]}
            actions={[
              {
                id: "btn-check-expdp-log",
                label: "View Export Log",
                icon: BookOpen,
                onClick: () => setExpdpLogOpen(true),
                primary: true
              }
            ]}
          />
        </div>
      </div>

      {/* ── IMPDP Section (non-PROD only) ── */}
      {!isProd && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-violet-400/15" />
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-400/70">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Import (IMPDP)
            </div>
            <div className="h-px flex-1 bg-violet-400/15" />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <ActionCard
              section="impdp"
              subtitle="Action"
              title="Take Import"
              description="Launch a guided 2-step import wizard. Step 1 auto-fetches the latest dump file from the server for confirmation. Step 2 configures all IMPDP parameters including remap schema, tablespace, content type, and optional pre-import user drop. Supports templates for repeated imports."
              features={[
                { icon: FileInput, label: "Auto-fetch latest dump" },
                { icon: Zap, label: "2-step wizard" },
                { icon: Shield, label: "Drop user option" },
                { icon: BookOpen, label: "Template save & load" }
              ]}
              actions={[
                {
                  id: "btn-launch-impdp",
                  label: "Take Import",
                  icon: ArrowDownToLine,
                  onClick: () => setImpdpOpen(true),
                  primary: true
                }
              ]}
            />

            <ActionCard
              section="impdp"
              subtitle="Report"
              title="Check Latest Import Log"
              description="Retrieve and display the latest IMPDP log file from the Oracle server. n8n reads the log via SSH and streams it back for review. Helps diagnose import errors, object conflicts, and schema remapping results."
              features={[
                { icon: Clock, label: "Latest log only" },
                { icon: Database, label: "Full log display" },
                { icon: FileInput, label: "Download log file" },
                { icon: Zap, label: "SSH log retrieval" }
              ]}
              actions={[
                {
                  id: "btn-check-impdp-log",
                  label: "View Import Log",
                  icon: BookOpen,
                  onClick: () => setImpdpLogOpen(true),
                  primary: true
                }
              ]}
            />
          </div>
        </div>
      )}

      {/* Modals */}
      <ExpdpModal open={expdpOpen} onOpenChange={setExpdpOpen} />
      <ImpdpModal open={impdpOpen} onOpenChange={setImpdpOpen} />
      <LogViewerModal
        open={expdpLogOpen}
        onOpenChange={setExpdpLogOpen}
        action="expdp_check_log"
        title="EXPDP Log Viewer"
        description="Latest Oracle Data Pump export log from the database server"
      />
      <LogViewerModal
        open={impdpLogOpen}
        onOpenChange={setImpdpLogOpen}
        action="impdp_check_log"
        title="IMPDP Log Viewer"
        description="Latest Oracle Data Pump import log from the database server"
      />
    </div>
  );
}
