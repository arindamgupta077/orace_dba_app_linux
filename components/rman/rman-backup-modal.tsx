"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Code2,
  HardDrive,
  Play,
  Terminal,
  Wrench
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { startRmanBackgroundJob } from "@/services/rman-background";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

/* ------------------------------------------------------------------ */
/* Types                                                                 */
/* ------------------------------------------------------------------ */

interface RmanBackupParams {
  backup_type: string;
  include_archivelog: boolean;
  compressed: boolean;
  channel_count: number;
  Backup_for_standby: boolean;
  backup_tag: string;
  delete_all_input: boolean;
  [key: string]: unknown;
}

interface RmanBackupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_PARAMS: RmanBackupParams = {
  backup_type: "FULL",
  include_archivelog: true,
  compressed: true,
  channel_count: 3,
  Backup_for_standby: false,
  backup_tag: "",
  delete_all_input: false
};

/* ------------------------------------------------------------------ */
/* Checkbox toggle row                                                   */
/* ------------------------------------------------------------------ */

function CheckRow({
  id,
  label,
  help,
  checked,
  onChange
}: {
  id: string;
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all",
        checked
          ? "border-amber-500/40 bg-amber-500/10 text-foreground"
          : "border-border/60 bg-background/40 hover:bg-background/80 text-muted-foreground"
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500 rounded border-border"
      />
      <div className="space-y-0.5 select-none">
        <span className="text-sm font-medium text-foreground block">{label}</span>
        {help && <p className="text-xs text-muted-foreground leading-normal">{help}</p>}
      </div>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                            */
/* ------------------------------------------------------------------ */

export function RmanBackupModal({ open, onOpenChange }: RmanBackupModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const user = useAppStore((s) => s.user);

  const [params, setParams] = useState<RmanBackupParams>(DEFAULT_PARAMS);

  /* Reset on open */
  useEffect(() => {
    if (open) {
      setParams(DEFAULT_PARAMS);
    }
  }, [open]);

  const setParam = <K extends keyof RmanBackupParams>(key: K, value: RmanBackupParams[K]) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  /* ── Submit: fire in background and close immediately ── */
  const handleSubmit = () => {
    const currentUsername = user?.username || "dba";
    const rmanRequestId = `RMAN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    startRmanBackgroundJob(selectedDb, {
      ...params,
      request_id: rmanRequestId,
      requested_by: currentUsername
    });
    onOpenChange(false);
  };

  /* ── Live Generated Syntactically Correct RMAN Script ── */
  const generatedRmanScript = useMemo(() => {
    const channelCount = Math.max(1, Math.min(16, Number(params.channel_count) || 3));
    const compressed = params.compressed ? "AS COMPRESSED BACKUPSET " : "";
    const tag = params.backup_tag?.trim() ? ` TAG '${params.backup_tag.trim()}'` : "";
    const standby = params.Backup_for_standby ? " FOR STANDBY" : "";
    const deleteInput = params.delete_all_input ? " DELETE ALL INPUT" : "";

    let backupCmd = "";
    if (params.backup_type === "ARCHIVELOG") {
      backupCmd = `  BACKUP ${compressed}ARCHIVELOG ALL${deleteInput}${tag};`;
    } else {
      let dbTarget = "DATABASE";
      if (params.backup_type === "LEVEL 0") {
        dbTarget = "INCREMENTAL LEVEL 0 DATABASE";
      } else if (params.backup_type === "LEVEL 1") {
        dbTarget = "INCREMENTAL LEVEL 1 DATABASE";
      }
      const archivelogClause = params.include_archivelog ? ` PLUS ARCHIVELOG${deleteInput}` : "";
      backupCmd = `  BACKUP ${compressed}${dbTarget}${standby}${archivelogClause}${tag};`;
    }

    const channelsAlloc = Array.from(
      { length: channelCount },
      (_, i) => `  ALLOCATE CHANNEL c${i + 1} DEVICE TYPE DISK;`
    ).join("\n");

    const channelsRelease = Array.from(
      { length: channelCount },
      (_, i) => `  RELEASE CHANNEL c${i + 1};`
    ).join("\n");

    const ctrlBackup = params.backup_type !== "ARCHIVELOG" ? "  BACKUP CURRENT CONTROLFILE;\n" : "";

    return `RUN {
${channelsAlloc}
${backupCmd}
${ctrlBackup}${channelsRelease}
}`;
  }, [params]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
              <HardDrive className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">RMAN Backup</DialogTitle>
              <DialogDescription>
                Launch RMAN backups in the background while you navigate freely or close the app.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Configuration Form */}
        <div className="space-y-5 pt-1">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rman-backup-type" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Backup Type
                </Label>
                <Select value={params.backup_type} onValueChange={(v) => setParam("backup_type", v)}>
                  <SelectTrigger id="rman-backup-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["FULL", "LEVEL 0", "LEVEL 1", "ARCHIVELOG"].map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rman-channels" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  RMAN Channels (Parallelism)
                </Label>
                <Input
                  id="rman-channels"
                  type="number"
                  min={1}
                  max={16}
                  value={params.channel_count}
                  onChange={(e) => setParam("channel_count", Math.max(1, Number(e.target.value)))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rman-tag" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Backup Tag (Optional)
              </Label>
              <Input
                id="rman-tag"
                placeholder="e.g. ONDEMAND_PRE_PATCH"
                value={params.backup_tag}
                onChange={(e) => setParam("backup_tag", e.target.value.toUpperCase())}
                className="font-mono text-xs uppercase"
              />
            </div>

            {/* Checkbox Options */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Options</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <CheckRow
                  id="rman-opt-compress"
                  label="Use Compression"
                  help="Applies AS COMPRESSED BACKUPSET to reduce storage."
                  checked={params.compressed}
                  onChange={(v) => setParam("compressed", v)}
                />
                <CheckRow
                  id="rman-opt-archivelog"
                  label="Include Archivelog"
                  help="Backs up archive logs not backed up 1 times."
                  checked={params.include_archivelog}
                  onChange={(v) => setParam("include_archivelog", v)}
                />
                <CheckRow
                  id="rman-opt-standby"
                  label="Backup for Standby"
                  help="Applies FOR STANDBY clause to create standby-compatible backup."
                  checked={params.Backup_for_standby}
                  onChange={(v) => setParam("Backup_for_standby", v)}
                />
                <CheckRow
                  id="rman-opt-delete-input"
                  label="DELETE ALL INPUT"
                  help="Deletes backed-up archive logs from disk after successful backup (DELETE ALL INPUT clause)."
                  checked={Boolean(params.delete_all_input)}
                  onChange={(v) => setParam("delete_all_input", v)}
                />
              </div>
            </div>

            {/* Live RMAN Script Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-amber-500" />
                  Live Generated RMAN Script Preview:
                </Label>
                <span className="text-[10px] font-mono text-muted-foreground">
                  Target: {selectedDb}
                </span>
              </div>
              <div className="relative rounded-xl border border-border/80 bg-zinc-950 p-3.5 font-mono text-xs text-amber-300 shadow-inner">
                <pre className="overflow-x-auto whitespace-pre leading-relaxed">
                  {generatedRmanScript}
                </pre>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Pre-backup maintenance commands included by the agent:
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground font-mono leading-5">
                CROSSCHECK BACKUP → DELETE NOPROMPT OBSOLETE → DELETE NOPROMPT EXPIRED BACKUP<br />
                → CROSSCHECK ARCHIVELOG ALL → DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE &apos;SYSDATE-10&apos;
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            id="btn-execute-rman-backup"
            onClick={handleSubmit}
            className="min-w-44 gap-2 bg-amber-600 text-white hover:bg-amber-700 shadow-sm"
          >
            <Play className="h-4 w-4" />
            Execute Backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
