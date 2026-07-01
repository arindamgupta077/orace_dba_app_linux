"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Code2,
  HardDrive,
  Layers,
  Play
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/visual/status-badge";
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
  backup_tag: ""
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
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 transition-colors hover:bg-background/50"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-amber-500"
      />
      <div>
        <span className="text-sm font-medium">{label}</span>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Main modal                                                            */
/* ------------------------------------------------------------------ */

export function RmanBackupModal({ open, onOpenChange }: RmanBackupModalProps) {
  const selectedDb = useAppStore((s) => s.selectedDb);
  const databases = useAppStore((s) => s.databases);
  const user = useAppStore((s) => s.user);

  const [params, setParams] = useState<RmanBackupParams>(DEFAULT_PARAMS);
  const [tab, setTab] = useState<"form" | "json">("form");
  const [rawJson, setRawJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const dbTarget = useMemo(() => databases.find((db) => db.name === selectedDb), [databases, selectedDb]);

  const fullPayload = useMemo(
    () => ({
      action: "take_rman_backup",
      db: selectedDb,
      params,
      requested_by: user?.username?.toUpperCase() || "ARINDAM",
      user_id: user?.userId ?? 1,
      environment: dbTarget?.env_label ?? "PROD",
      os: dbTarget?.os ?? "Linux",
      db_type: dbTarget?.db_type ?? "Standalone"
    }),
    [params, selectedDb, user, dbTarget]
  );

  /* Sync rawJson when form changes */
  useEffect(() => {
    if (tab === "json") {
      setRawJson(JSON.stringify(fullPayload, null, 2));
    }
  }, [fullPayload, tab]);

  /* Reset on open */
  useEffect(() => {
    if (open) {
      setParams(DEFAULT_PARAMS);
      setTab("form");
      setJsonError(null);
    }
  }, [open]);

  const handleTabChange = (value: string) => {
    const next = value as "form" | "json";
    setTab(next);
    if (next === "json") {
      setRawJson(JSON.stringify(fullPayload, null, 2));
      setJsonError(null);
    }
  };

  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(rawJson) as typeof fullPayload;
      if (parsed.params && typeof parsed.params === "object") {
        setParams({
          backup_type: String(parsed.params.backup_type ?? DEFAULT_PARAMS.backup_type),
          include_archivelog: Boolean(parsed.params.include_archivelog ?? DEFAULT_PARAMS.include_archivelog),
          compressed: Boolean(parsed.params.compressed ?? DEFAULT_PARAMS.compressed),
          channel_count: Number(parsed.params.channel_count ?? DEFAULT_PARAMS.channel_count),
          Backup_for_standby: Boolean(parsed.params.Backup_for_standby ?? DEFAULT_PARAMS.Backup_for_standby),
          backup_tag: String(parsed.params.backup_tag ?? "")
        });
      }
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON — please fix syntax errors before switching tabs.");
    }
  };

  const setParam = <K extends keyof RmanBackupParams>(key: K, value: RmanBackupParams[K]) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  /* ── Submit: fire in background and close immediately ── */
  const handleSubmit = () => {
    let finalParams: Record<string, unknown> = params as Record<string, unknown>;

    if (tab === "json") {
      try {
        const parsed = JSON.parse(rawJson) as typeof fullPayload;
        if (parsed.params && typeof parsed.params === "object") {
          finalParams = parsed.params as Record<string, unknown>;
        }
      } catch {
        setJsonError("Invalid JSON — cannot submit.");
        return;
      }
    }

    startRmanBackgroundJob(selectedDb, finalParams);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2">
              <HardDrive className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <DialogTitle className="text-lg">Take RMAN Backup</DialogTitle>
              <DialogDescription>
                Configure and launch an on-demand RMAN backup. The job runs in the background — you can navigate freely or close the app.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Background-mode info banner */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium">Runs in the background</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              After clicking <strong>Execute Backup</strong> the modal closes immediately. The backup continues on the Oracle server via n8n even if you navigate away.
              Track progress and results in the <strong>Background Backup Jobs</strong> panel on this page or via the notification bell.
            </p>
          </div>
        </div>

        {/* Configuration */}
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="form" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Form Editor
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                Raw JSON
              </TabsTrigger>
            </TabsList>

            {/* ── Form tab ── */}
            <TabsContent value="form" className="mt-4">
              <div className="grid gap-5 md:grid-cols-2">
                {/* Left: Param fields */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Backup Parameters
                  </p>

                  <div className="space-y-1.5">
                    <Label htmlFor="rman-backup-type">Backup Type</Label>
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
                    <Label htmlFor="rman-channels">RMAN Channels (Parallelism)</Label>
                    <Input
                      id="rman-channels"
                      type="number"
                      min={1}
                      max={16}
                      value={params.channel_count}
                      onChange={(e) => setParam("channel_count", Math.max(1, Number(e.target.value)))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="rman-tag">Backup Tag (optional)</Label>
                    <Input
                      id="rman-tag"
                      type="text"
                      placeholder="ON_DEMAND_FULL"
                      value={params.backup_tag}
                      onChange={(e) => setParam("backup_tag", e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <CheckRow
                      id="rman-include-archivelog"
                      label="Include Archivelog"
                      help="Backs up and deletes archived logs after database backup"
                      checked={params.include_archivelog}
                      onChange={(v) => setParam("include_archivelog", v)}
                    />
                    <CheckRow
                      id="rman-compressed"
                      label="Use Compression"
                      help="Creates compressed backupsets (BASIC algorithm)"
                      checked={params.compressed}
                      onChange={(v) => setParam("compressed", v)}
                    />
                    <CheckRow
                      id="rman-standby"
                      label="Backup for Standby"
                      help="Takes CURRENT CONTROLFILE FOR STANDBY instead of standard controlfile"
                      checked={params.Backup_for_standby}
                      onChange={(v) => setParam("Backup_for_standby", v)}
                    />
                  </div>
                </div>

                {/* Right: JSON Preview */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Live JSON Preview
                    </p>
                    <StatusBadge status="info">→ n8n Webhook</StatusBadge>
                  </div>
                  <pre className="keep-dark max-h-72 overflow-auto rounded-xl border border-border/60 bg-black/50 p-4 text-[11px] leading-5 text-cyan-100 font-mono">
                    {JSON.stringify(fullPayload, null, 2)}
                  </pre>
                  <p className="text-[11px] text-muted-foreground">
                    This exact payload is sent to the n8n webhook. Switch to{" "}
                    <strong>Raw JSON</strong> tab to edit it directly.
                  </p>
                </div>
              </div>

              {/* Maintenance info banner */}
              <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                <p className="text-xs font-semibold text-amber-300">
                  🔧 Pre-backup maintenance commands always included by n8n:
                </p>
                <p className="mt-1 text-xs text-muted-foreground font-mono leading-5">
                  CROSSCHECK BACKUP → DELETE NOPROMPT OBSOLETE → DELETE NOPROMPT EXPIRED BACKUP<br />
                  → CROSSCHECK ARCHIVELOG ALL → DELETE NOPROMPT ARCHIVELOG ALL COMPLETED BEFORE &apos;SYSDATE-10&apos;
                </p>
              </div>
            </TabsContent>

            {/* ── Raw JSON tab ── */}
            <TabsContent value="json" className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Edit Payload JSON Directly
                </p>
                <button
                  type="button"
                  onClick={applyRawJson}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  ↩ Apply to Form
                </button>
              </div>
              <textarea
                id="rman-raw-json"
                value={rawJson}
                onChange={(e) => {
                  setRawJson(e.target.value);
                  setJsonError(null);
                }}
                spellCheck={false}
                className={cn(
                  "keep-dark h-80 w-full resize-none rounded-xl border bg-black/50 p-4 font-mono text-[11px] leading-5 text-cyan-100 outline-none transition-colors focus:ring-1",
                  jsonError
                    ? "border-red-400/40 focus:ring-red-400/30"
                    : "border-border/60 focus:ring-cyan-400/30"
                )}
              />
              {jsonError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {jsonError}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                You can freely edit this JSON. All fields including top-level keys (db, environment, etc.) are sent as-is to the n8n webhook.
              </p>
            </TabsContent>
          </Tabs>
        </div>

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            id="btn-execute-rman-backup"
            onClick={handleSubmit}
            disabled={tab === "json" && !!jsonError}
            className="min-w-44 gap-2 bg-amber-500/80 text-white hover:bg-amber-500"
          >
            <Play className="h-4 w-4" />
            Execute Backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
