"use client";

import { useState } from "react";
import {
  ArchiveRestore,
  Clock,
  Database,
  HardDrive,
  Play,
  Search,
  Server,
  Shield,
  Zap
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { RmanBackupModal } from "@/components/rman/rman-backup-modal";
import { RmanStatusModal } from "@/components/rman/rman-status-modal";
import { RmanJobsTracker } from "@/components/rman/rman-jobs-tracker";

export function RmanDashboard() {
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="RMAN Backup Dashboard"
        description="Execute on-demand RMAN backups with dynamic script generation, and query backup history with flexible date-range filtering."
        icon={ArchiveRestore}
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Take RMAN Backup ─────────────────────────────────────── */}
        <div className="group relative overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-amber-600/10 p-6 transition-all duration-300 hover:border-amber-400/40 hover:shadow-xl hover:shadow-amber-500/10">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-amber-500/8 blur-3xl transition-all duration-500 group-hover:bg-amber-500/12" />
          <div className="pointer-events-none absolute -bottom-6 -left-6 h-32 w-32 rounded-full bg-orange-500/5 blur-2xl" />

          <div className="relative space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="shrink-0 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3.5 shadow-lg shadow-amber-500/10 transition-all duration-300 group-hover:border-amber-400/50 group-hover:bg-amber-400/15">
                <HardDrive className="h-6 w-6 text-amber-300" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-400/60">
                  Action
                </p>
                <h2 className="mt-0.5 text-xl font-bold text-amber-100 tracking-tight">
                  Take RMAN Backup
                </h2>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm leading-6 text-muted-foreground">
              Trigger an on-demand RMAN backup. The n8n workflow dynamically builds
              and executes the RMAN script on your Oracle server via SSH — including
              maintenance commands, compression, channel parallelism, and controlfile backup.
            </p>

            {/* Feature pills */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Zap,     label: "Dynamic script generation" },
                { icon: Server,  label: "SSH remote execution" },
                { icon: Shield,  label: "Maintenance pre-steps" },
                { icon: Database,label: "Controlfile backup" }
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-lg border border-amber-400/10 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200/70"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-amber-400/50" />
                  {label}
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              id="btn-launch-rman-backup"
              onClick={() => setBackupModalOpen(true)}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-200 shadow-inner shadow-amber-500/5 transition-all duration-200 hover:border-amber-400/55 hover:bg-amber-400/20 hover:text-amber-100 hover:shadow-amber-500/15 active:scale-[0.98]"
            >
              <Play className="h-4 w-4" />
              Launch Backup
            </button>
          </div>
        </div>

        {/* ── RMAN Backup Status ────────────────────────────────────── */}
        <div className="group relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-cyan-600/10 p-6 transition-all duration-300 hover:border-cyan-400/40 hover:shadow-xl hover:shadow-cyan-500/10">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-cyan-500/8 blur-3xl transition-all duration-500 group-hover:bg-cyan-500/12" />
          <div className="pointer-events-none absolute -bottom-6 -left-6 h-32 w-32 rounded-full bg-blue-500/5 blur-2xl" />

          <div className="relative space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="shrink-0 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3.5 shadow-lg shadow-cyan-500/10 transition-all duration-300 group-hover:border-cyan-400/50 group-hover:bg-cyan-400/15">
                <Search className="h-6 w-6 text-cyan-300" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-cyan-400/60">
                  Report
                </p>
                <h2 className="mt-0.5 text-xl font-bold text-cyan-100 tracking-tight">
                  RMAN Backup Status
                </h2>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm leading-6 text-muted-foreground">
              Query{" "}
              <code className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-xs font-mono text-cyan-300">
                V$RMAN_BACKUP_JOB_DETAILS
              </code>{" "}
              for a specified date range. Returns all backup jobs with type, status,
              start/end time, elapsed duration, compression ratio, and output size.
            </p>

            {/* Feature pills */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Clock,        label: "Date-range filtering" },
                { icon: Database,     label: "V$RMAN_BACKUP_JOB_DETAILS" },
                { icon: ArchiveRestore, label: "All backup types" },
                { icon: Zap,          label: "Compression ratio report" }
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-400/5 px-2.5 py-1.5 text-xs text-cyan-200/70"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-400/50" />
                  {label}
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              id="btn-check-rman-status"
              onClick={() => setStatusModalOpen(true)}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-200 shadow-inner shadow-cyan-500/5 transition-all duration-200 hover:border-cyan-400/55 hover:bg-cyan-400/20 hover:text-cyan-100 hover:shadow-cyan-500/15 active:scale-[0.98]"
            >
              <Search className="h-4 w-4" />
              Check Backup Status
            </button>
          </div>
        </div>
      </div>

      {/* Background jobs tracker */}
      <RmanJobsTracker />

      {/* Modals */}
      <RmanBackupModal open={backupModalOpen} onOpenChange={setBackupModalOpen} />
      <RmanStatusModal open={statusModalOpen} onOpenChange={setStatusModalOpen} />
    </div>
  );
}
