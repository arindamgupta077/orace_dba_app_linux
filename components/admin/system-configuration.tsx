"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Trash2,
  Workflow
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_SECURITY_POSTURE_POLICY, type SecurityPosturePolicyConfig } from "@/lib/security-posture-policy";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import {
  fetchAuditRetentionPolicy,
  fetchPerformanceConfig,
  fetchSecurityPosturePolicy,
  purgeExpiredAuditLogs,
  updateAuditRetentionPolicy,
  updatePerformanceConfig,
  updateSecurityPosturePolicy
} from "@/services/api";
import type { AuditLogRetentionPolicyConfig, AuditLogStats } from "@/types/dba";

const VALID_TABS = ["audit-retention", "performance", "security-posture"] as const;
type TabType = (typeof VALID_TABS)[number];
const TAB_STORAGE_KEY = "oracle_dba_system_config_tab";

const PRESET_PERF_DAYS = [1, 2, 3, 5, 7, 14, 30];

const PRESET_OUTDATED_DAYS = [
  { label: "7 Days", days: 7, minutes: 7 * 24 * 60 },
  { label: "14 Days", days: 14, minutes: 14 * 24 * 60 },
  { label: "21 Days", days: 21, minutes: 21 * 24 * 60 },
  { label: "30 Days (Default)", days: 30, minutes: 30 * 24 * 60 },
  { label: "45 Days", days: 45, minutes: 45 * 24 * 60 },
  { label: "60 Days", days: 60, minutes: 60 * 24 * 60 },
  { label: "90 Days", days: 90, minutes: 90 * 24 * 60 }
];

const PRESET_MAX_SENDS = [1, 3, 5, 7, 10, 14, 21];

const PRESET_WEBHOOK_INTERVAL_HOURS = [
  { label: "6 Hours", hours: 6 },
  { label: "12 Hours", hours: 12 },
  { label: "24 Hours (Daily)", hours: 24 },
  { label: "48 Hours (2 Days)", hours: 48 },
  { label: "72 Hours (3 Days)", hours: 72 },
  { label: "168 Hours (Weekly)", hours: 168 }
];

const PRESET_CHECK_INTERVAL_MINUTES = [
  { label: "15 Min", minutes: 15 },
  { label: "30 Min", minutes: 30 },
  { label: "1 Hour", minutes: 60 },
  { label: "2 Hours", minutes: 120 },
  { label: "4 Hours (Default)", minutes: 240 },
  { label: "6 Hours", minutes: 360 },
  { label: "12 Hours", minutes: 720 },
  { label: "24 Hours", minutes: 1440 }
];

const PRESET_AUDIT_RETENTION_DAYS = [
  { label: "1 Year", days: 365, years: 1 },
  { label: "2 Years", days: 730, years: 2 },
  { label: "3 Years (Default)", days: 1095, years: 3 },
  { label: "4 Years", days: 1460, years: 4 },
  { label: "5 Years", days: 1825, years: 5 },
  { label: "6 Years", days: 2190, years: 6 },
  { label: "7 Years (Max)", days: 2555, years: 7 }
];

export function SystemConfiguration() {
  // Active Tab state with persistence
  const [activeTab, setActiveTab] = useState<string>("audit-retention");

  // Performance trend configuration state
  const [trendDays, setTrendDays] = useState<number>(3);
  const [initialDays, setInitialDays] = useState<number>(3);
  const [savingPerf, setSavingPerf] = useState(false);

  // Security Posture policy configuration state
  const [policy, setPolicy] = useState<SecurityPosturePolicyConfig>({ ...DEFAULT_SECURITY_POSTURE_POLICY });
  const [initialPolicy, setInitialPolicy] = useState<SecurityPosturePolicyConfig>({ ...DEFAULT_SECURITY_POSTURE_POLICY });
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Audit Log Retention policy configuration state (1 Year to 7 Years, Default 3 Years)
  const [auditPolicy, setAuditPolicy] = useState<AuditLogRetentionPolicyConfig>({
    retentionDays: 1095,
    autoPurgeEnabled: true,
    lastPurgeAt: null,
    lastPurgedCount: 0
  });
  const [initialAuditPolicy, setInitialAuditPolicy] = useState<AuditLogRetentionPolicyConfig>({
    retentionDays: 1095,
    autoPurgeEnabled: true,
    lastPurgeAt: null,
    lastPurgedCount: 0
  });
  const [auditStats, setAuditStats] = useState<AuditLogStats | null>(null);
  const [savingAuditPolicy, setSavingAuditPolicy] = useState(false);
  const [purgingAudit, setPurgingAudit] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);

  const [loading, setLoading] = useState(true);

  // Initialize and persist tab selection
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace(/^#/, "");
      if (VALID_TABS.includes(hash as TabType)) {
        setActiveTab(hash);
        return;
      }
      try {
        const saved = localStorage.getItem(TAB_STORAGE_KEY);
        if (saved && VALID_TABS.includes(saved as TabType)) {
          setActiveTab(saved);
        }
      } catch {
        // Silently ignore localStorage access errors
      }
    }
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(TAB_STORAGE_KEY, value);
      } catch {
        // Silently ignore localStorage write errors
      }
      if (window.history?.replaceState) {
        window.history.replaceState(null, "", `#${value}`);
      }
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const [perfRes, secRes, auditRes] = await Promise.all([
        fetchPerformanceConfig().catch((err) => {
          console.warn("Failed to load performance config:", err);
          return { trendDays: 3 };
        }),
        fetchSecurityPosturePolicy().catch((err) => {
          console.warn("Failed to load security posture policy:", err);
          return { policy: DEFAULT_SECURITY_POSTURE_POLICY };
        }),
        fetchAuditRetentionPolicy().catch((err) => {
          console.warn("Failed to load audit retention policy:", err);
          return {
            policy: { retentionDays: 1095, autoPurgeEnabled: true, lastPurgeAt: null, lastPurgedCount: 0 },
            stats: {
              totalLogs: 0,
              retentionDays: 1095,
              autoPurgeEnabled: true,
              oldestLogTimestamp: null,
              newestLogTimestamp: null,
              expiredLogsCount: 0,
              lastPurgeAt: null,
              lastPurgedCount: 0
            }
          };
        })
      ]);

      if (perfRes?.trendDays && Number.isFinite(perfRes.trendDays)) {
        setTrendDays(perfRes.trendDays);
        setInitialDays(perfRes.trendDays);
      }

      if (secRes?.policy) {
        setPolicy(secRes.policy);
        setInitialPolicy(secRes.policy);
      }

      if (auditRes?.policy) {
        setAuditPolicy(auditRes.policy);
        setInitialAuditPolicy(auditRes.policy);
      }
      if (auditRes?.stats) {
        setAuditStats(auditRes.stats);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load system configuration.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleSavePerformanceConfig = async () => {
    if (!Number.isFinite(trendDays) || trendDays < 1 || trendDays > 90) {
      toast.error("Please enter a valid number of days between 1 and 90.");
      return;
    }

    setSavingPerf(true);
    try {
      const res = await updatePerformanceConfig(trendDays);
      if (res?.ok) {
        setTrendDays(res.trendDays);
        setInitialDays(res.trendDays);
        toast.success(`RUN ALL trend data window saved (${res.trendDays} days).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save performance configuration.");
    } finally {
      setSavingPerf(false);
    }
  };

  const handleSaveSecurityPolicy = async () => {
    if (!Number.isFinite(policy.outdatedAfterMinutes) || policy.outdatedAfterMinutes < 1 || policy.outdatedAfterMinutes > 525600) {
      toast.error("Outdated threshold must be between 1 and 525,600 minutes (up to 365 days).");
      return;
    }
    if (!Number.isFinite(policy.outdatedWebhookMaxSends) || policy.outdatedWebhookMaxSends < 1 || policy.outdatedWebhookMaxSends > 100) {
      toast.error("Overdue webhook max sends must be between 1 and 100.");
      return;
    }
    if (!Number.isFinite(policy.outdatedWebhookIntervalHours) || policy.outdatedWebhookIntervalHours < 1 || policy.outdatedWebhookIntervalHours > 720) {
      toast.error("Overdue webhook interval must be between 1 and 720 hours.");
      return;
    }
    if (!Number.isFinite(policy.outdatedWebhookCheckIntervalMinutes) || policy.outdatedWebhookCheckIntervalMinutes < 1 || policy.outdatedWebhookCheckIntervalMinutes > 1440) {
      toast.error("Scheduler check interval must be between 1 and 1440 minutes.");
      return;
    }

    setSavingPolicy(true);
    try {
      const res = await updateSecurityPosturePolicy(policy);
      if (res?.ok && res.policy) {
        setPolicy(res.policy);
        setInitialPolicy(res.policy);
        toast.success("Security Posture policy parameters saved to APP_SYSTEM_CONFIG.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save security posture policy.");
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveAuditRetentionPolicy = async () => {
    if (!Number.isFinite(auditPolicy.retentionDays) || auditPolicy.retentionDays < 365 || auditPolicy.retentionDays > 2555) {
      toast.error("Retention period must be between 1 Year (365 Days) and 7 Years (2555 Days).");
      return;
    }

    setSavingAuditPolicy(true);
    try {
      const res = await updateAuditRetentionPolicy(auditPolicy);
      if (res?.ok && res.policy) {
        setAuditPolicy(res.policy);
        setInitialAuditPolicy(res.policy);
        if (res.stats) setAuditStats(res.stats);
        toast.success(`Audit log retention policy saved (${res.policy.retentionDays} days) to APP_SYSTEM_CONFIG.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save audit log retention policy.");
    } finally {
      setSavingAuditPolicy(false);
    }
  };

  const handlePurgeExpiredAuditLogs = async () => {
    setPurgingAudit(true);
    try {
      const res = await purgeExpiredAuditLogs(auditPolicy.retentionDays);
      if (res?.ok) {
        toast.success(res.message || `Purged ${res.deletedCount} expired audit logs.`);
        if (res.stats) setAuditStats(res.stats);
        setAuditPolicy((prev) => ({
          ...prev,
          lastPurgeAt: res.lastPurgeAt,
          lastPurgedCount: res.deletedCount
        }));
        setInitialAuditPolicy((prev) => ({
          ...prev,
          lastPurgeAt: res.lastPurgeAt,
          lastPurgedCount: res.deletedCount
        }));
        setPurgeDialogOpen(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to purge expired audit logs.");
    } finally {
      setPurgingAudit(false);
    }
  };

  const isPerfDirty = trendDays !== initialDays;
  const isPolicyDirty =
    policy.outdatedAfterMinutes !== initialPolicy.outdatedAfterMinutes ||
    policy.outdatedWebhookMaxSends !== initialPolicy.outdatedWebhookMaxSends ||
    policy.outdatedWebhookIntervalHours !== initialPolicy.outdatedWebhookIntervalHours ||
    policy.outdatedWebhookCheckIntervalMinutes !== initialPolicy.outdatedWebhookCheckIntervalMinutes;

  const isAuditDirty =
    auditPolicy.retentionDays !== initialAuditPolicy.retentionDays ||
    auditPolicy.autoPurgeEnabled !== initialAuditPolicy.autoPurgeEnabled;

  const hasAnyDirty = isPerfDirty || isPolicyDirty || isAuditDirty;

  const policyDays = Math.round((policy.outdatedAfterMinutes / (24 * 60)) * 10) / 10;
  const initialPolicyDays = Math.round((initialPolicy.outdatedAfterMinutes / (24 * 60)) * 10) / 10;

  // Calculate cutoff date for audit retention
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - auditPolicy.retentionDays);
  const cutoffFormatted = cutoffDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  // Scanner frequency calculated executions per day
  const scansPerDay = Math.round((1440 / Math.max(1, policy.outdatedWebhookCheckIntervalMinutes)) * 10) / 10;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Executive Header Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/95 to-secondary/30 p-6 shadow-md">
          {/* Subtle Ambient Glow */}
          <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/20 via-cyan-500/10 to-transparent text-cyan-600 dark:text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
                <SlidersHorizontal className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  System Configuration
                </h1>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Fine-tune enterprise governance parameters, automated cleanup schedulers, diagnostic telemetry payloads, and security posture thresholds.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {hasAnyDirty && (
                <Badge variant="outline" className="animate-pulse border-amber-500/40 bg-amber-500/10 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                  Unsaved Changes
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={loadConfig}
                disabled={loading || savingPerf || savingPolicy || savingAuditPolicy || purgingAudit}
                className="gap-2 text-xs font-medium border-border/80 hover:bg-muted/80 shadow-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-cyan-500" : ""}`} />
                Reload Settings
              </Button>
            </div>
          </div>
        </div>

        {/* Clean Single Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/70 pb-3">
            <TabsList className="grid w-full max-w-2xl grid-cols-3 bg-muted/60 p-1.5 rounded-xl border border-border/70 shadow-xs">
              <TabsTrigger
                value="audit-retention"
                className="relative flex items-center justify-center gap-2 py-2 text-xs font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>Audit Retention</span>
                {isAuditDirty && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background animate-pulse" title="Unsaved changes" />
                )}
              </TabsTrigger>

              <TabsTrigger
                value="performance"
                className="relative flex items-center justify-center gap-2 py-2 text-xs font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                <Activity className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                <span>Performance &amp; n8n</span>
                {isPerfDirty && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background animate-pulse" title="Unsaved changes" />
                )}
              </TabsTrigger>

              <TabsTrigger
                value="security-posture"
                className="relative flex items-center justify-center gap-2 py-2 text-xs font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                <ShieldCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span>Security Posture</span>
                {isPolicyDirty && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background animate-pulse" title="Unsaved changes" />
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ========================================================================= */}
          {/* TAB 1: AUDIT LOG RETENTION POLICY (EMERALD THEME) */}
          {/* ========================================================================= */}
          <TabsContent value="audit-retention" className="space-y-6 focus-visible:outline-none">
            <Card className="overflow-hidden border-border/80 bg-card/90 shadow-md backdrop-blur-xs">
              <CardHeader className="border-b border-border/60 bg-gradient-to-r from-emerald-500/5 via-transparent to-transparent pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <CardTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          <Shield className="h-4 w-4" />
                        </div>
                        Audit Log Retention &amp; Lifecycle Governance
                      </CardTitle>
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 font-mono text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        Active: {initialAuditPolicy.retentionDays} Days ({Math.round((initialAuditPolicy.retentionDays / 365) * 10) / 10} Yr{initialAuditPolicy.retentionDays >= 730 ? "s" : ""})
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-medium",
                          initialAuditPolicy.autoPurgeEnabled
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-border/60 bg-muted/60 text-muted-foreground"
                        )}
                      >
                        {initialAuditPolicy.autoPurgeEnabled ? "Auto-Purge Enabled" : "Auto-Purge Disabled"}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs text-muted-foreground">
                      Configure retention lifespans for operational audit records in <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">APP_AUDIT_LOGS</code> (1 to 7 Years), schedule automated daily server purges, and track live database volume.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-7 pt-6">
                {/* Parameter 1: Retention Lifespan Selector */}
                <div className="space-y-4 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          1. Retention Lifespan
                        </Label>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          AUDIT_LOG_RETENTION_DAYS
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Audit records older than this threshold are marked as expired and pruned by scheduled maintenance or manual execution.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-xs font-bold bg-background border border-border/80 px-2.5 py-1">
                        {auditPolicy.retentionDays} Days ≈ {Math.round((auditPolicy.retentionDays / 365) * 10) / 10} Years
                      </Badge>
                    </div>
                  </div>

                  {/* Quick Preset Pills */}
                  <div className="space-y-2 pt-1">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick Lifespan Presets (1 to 7 Years)
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_AUDIT_RETENTION_DAYS.map((p) => {
                        const isSelected = auditPolicy.retentionDays === p.days;
                        return (
                          <Button
                            key={p.days}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            size="sm"
                            onClick={() => setAuditPolicy((prev) => ({ ...prev, retentionDays: p.days }))}
                            className={cn(
                              "text-xs transition-all h-8",
                              isSelected
                                ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.25)] font-semibold"
                                : "hover:border-emerald-500/40 hover:bg-emerald-500/5"
                            )}
                          >
                            {isSelected && <Check className="mr-1.5 h-3.5 w-3.5" />}
                            {p.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Dual Synchronized Inputs: Years & Days */}
                  <div className="grid gap-4 sm:grid-cols-2 max-w-xl pt-2">
                    <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/80 p-3 shadow-xs">
                      <Label htmlFor="audit-retention-years-input" className="text-xs font-semibold text-foreground">
                        Set in Years (1 to 7 Years):
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="audit-retention-years-input"
                          type="number"
                          min={1}
                          max={7}
                          value={Math.round(auditPolicy.retentionDays / 365)}
                          onChange={(e) => {
                            const yrs = parseInt(e.target.value, 10);
                            if (Number.isFinite(yrs) && yrs >= 1 && yrs <= 7) {
                              setAuditPolicy((prev) => ({ ...prev, retentionDays: yrs * 365 }));
                            }
                          }}
                          className="font-mono text-sm bg-background font-semibold"
                        />
                        <span className="shrink-0 text-xs font-mono text-muted-foreground">
                          Years (1–7)
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/80 p-3 shadow-xs">
                      <Label htmlFor="audit-retention-days-input" className="text-xs font-semibold text-foreground">
                        Exact Value in Days (365 to 2555):
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="audit-retention-days-input"
                          type="number"
                          min={365}
                          max={2555}
                          value={auditPolicy.retentionDays}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (Number.isFinite(val) && val > 0) {
                              setAuditPolicy((prev) => ({ ...prev, retentionDays: val }));
                            }
                          }}
                          className="font-mono text-sm bg-background font-semibold"
                        />
                        <span className="shrink-0 text-xs font-mono text-muted-foreground">
                          Days
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Calculated Cutoff Banner */}
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                    <Calendar className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <strong>Active Purge Cutoff:</strong> Records logged prior to <strong>{cutoffFormatted}</strong> ({auditPolicy.retentionDays} days ago) are classified as expired.
                    </div>
                  </div>
                </div>

                {/* Parameter 2: Automated Background Daily Purge Card */}
                <div className="space-y-3.5 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          2. Automated Daily Background Cleanup
                        </Label>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          AUDIT_LOG_AUTO_PURGE_ENABLED
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        When enabled, the server background scheduler automatically purges expired records daily at <strong>02:30 AM Server Time</strong>.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/80 p-1">
                      <Button
                        type="button"
                        variant={auditPolicy.autoPurgeEnabled ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setAuditPolicy((prev) => ({ ...prev, autoPurgeEnabled: true }))}
                        className={cn(
                          "text-xs gap-1.5 h-8",
                          auditPolicy.autoPurgeEnabled
                            ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 font-semibold"
                            : "text-muted-foreground"
                        )}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Enabled
                      </Button>
                      <Button
                        type="button"
                        variant={!auditPolicy.autoPurgeEnabled ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setAuditPolicy((prev) => ({ ...prev, autoPurgeEnabled: false }))}
                        className={cn(
                          "text-xs h-8",
                          !auditPolicy.autoPurgeEnabled ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"
                        )}
                      >
                        Disabled
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Live Database Volume Metrics & Manual Purge */}
                <div className="space-y-4 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                      <h3 className="text-sm font-bold text-foreground">
                        Oracle Database Storage &amp; Volume Metrics
                      </h3>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        APP_AUDIT_LOGS
                      </code>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={loadConfig}
                      disabled={loading}
                      className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                    >
                      <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                      Refresh Metrics
                    </Button>
                  </div>

                  {/* 4 Metric Cards */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-border/70 bg-background/90 p-3.5 shadow-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Total Audit Records
                      </div>
                      <div className="mt-1 text-xl font-bold font-mono text-foreground">
                        {loading ? <Skeleton className="h-7 w-20" /> : auditStats ? formatNumber(auditStats.totalLogs) : "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Rows in APP_AUDIT_LOGS</div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-background/90 p-3.5 shadow-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Oldest Recorded Entry
                      </div>
                      <div className="mt-1 text-xs font-semibold text-foreground truncate" title={auditStats?.oldestLogTimestamp ? formatDateTime(auditStats.oldestLogTimestamp) : "None"}>
                        {loading ? <Skeleton className="h-7 w-28" /> : auditStats?.oldestLogTimestamp ? formatDateTime(auditStats.oldestLogTimestamp) : "No records"}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Earliest active timestamp</div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-background/90 p-3.5 shadow-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Expired Records
                      </div>
                      <div className={cn(
                        "mt-1 text-xl font-bold font-mono",
                        auditStats && auditStats.expiredLogsCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                      )}>
                        {loading ? <Skeleton className="h-7 w-16" /> : auditStats ? formatNumber(auditStats.expiredLogsCount) : "0"}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">&gt; {auditPolicy.retentionDays} days lifespan</div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-background/90 p-3.5 shadow-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Last Purge Execution
                      </div>
                      <div className="mt-1 text-xs font-semibold text-foreground truncate" title={auditStats?.lastPurgeAt ? `${formatDateTime(auditStats.lastPurgeAt)} (${auditStats.lastPurgedCount} removed)` : "Never executed"}>
                        {loading ? <Skeleton className="h-7 w-28" /> : auditStats?.lastPurgeAt ? formatDateTime(auditStats.lastPurgeAt) : "Never"}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {auditStats?.lastPurgedCount ? `${formatNumber(auditStats.lastPurgedCount)} records removed` : "No purge history"}
                      </div>
                    </div>
                  </div>

                  {/* Manual Purge Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
                    <div className="text-xs text-muted-foreground">
                      {auditStats && auditStats.expiredLogsCount > 0 ? (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {formatNumber(auditStats.expiredLogsCount)} record{auditStats.expiredLogsCount === 1 ? "" : "s"} older than {auditPolicy.retentionDays} days are eligible for immediate purge.
                        </span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          All audit records are within the active {auditPolicy.retentionDays}-day retention lifespan.
                        </span>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPurgeDialogOpen(true)}
                      disabled={purgingAudit || loading || (auditStats?.expiredLogsCount === 0 && !isAuditDirty)}
                      className="gap-2 text-xs border-rose-500/30 text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 font-semibold shadow-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Purge Expired Logs Now
                    </Button>
                  </div>
                </div>

                {/* Compliance & Technical Architecture Blueprint */}
                <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-5 text-xs shadow-xs">
                  <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-sm">
                    <Info className="h-4 w-4" />
                    Data Governance, Audit Trail &amp; Oracle Storage Architecture:
                  </div>
                  <div className="mt-3 grid gap-2.5 text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <div>
                        <strong>Permanent Storage:</strong> Configuration parameters are persisted in Oracle table <code className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono font-bold text-emerald-900 dark:text-emerald-200 border border-emerald-500/30">APP_SYSTEM_CONFIG</code> under key <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">AUDIT_LOG_RETENTION_DAYS</code>.
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <div>
                        <strong>Dynamic Audit Page Header:</strong> The active retention period ({auditPolicy.retentionDays} Days) is dynamically reflected in the <strong>Audit Logs</strong> subpage header for complete regulatory compliance visibility.
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <div>
                        <strong>Immutable Purge Audit Trail:</strong> Every manual and background purge execution writes an audit event with user identity, affected rows, and timestamp into <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">APP_AUDIT_LOGS</code>.
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>

              {/* Action Footer */}
              <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/40 px-6 py-4">
                <div className="text-xs text-muted-foreground">
                  {isAuditDirty ? (
                    <span className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Unsaved changes pending in Audit Retention Policy
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      Retention policy is synchronized with APP_SYSTEM_CONFIG
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuditPolicy({ ...initialAuditPolicy })}
                    disabled={!isAuditDirty || savingAuditPolicy}
                    className="text-xs font-medium"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveAuditRetentionPolicy}
                    disabled={savingAuditPolicy || !isAuditDirty}
                    className="gap-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white shadow-sm"
                  >
                    {savingAuditPolicy ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Saving Policy...
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        Save Retention Policy
                      </>
                    )}
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* TAB 2: PERFORMANCE & n8n DIAGNOSTICS (CYAN THEME) */}
          {/* ========================================================================= */}
          <TabsContent value="performance" className="space-y-6 focus-visible:outline-none">
            <Card className="overflow-hidden border-border/80 bg-card/90 shadow-md backdrop-blur-xs">
              <CardHeader className="border-b border-border/60 bg-gradient-to-r from-cyan-500/5 via-transparent to-transparent pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <CardTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                          <Activity className="h-4 w-4" />
                        </div>
                        RUN ALL Performance Telemetry Window &amp; n8n Integration
                      </CardTitle>
                      <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 font-mono text-xs font-medium text-cyan-700 dark:text-cyan-300">
                        Active Window: {initialDays} Day{initialDays === 1 ? "" : "s"} ({initialDays * 24} Hours)
                      </Badge>
                    </div>
                    <CardDescription className="text-xs text-muted-foreground">
                      Configure the lookback timeframe window of historical Oracle AWR performance metrics and capacity utilization dispatched to n8n during the <strong>RUN ALL</strong> (<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">check_performance</code>) workflow.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-7 pt-6">
                {/* Trend Window Parameter Section */}
                <div className="space-y-4 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                          Lookback Window Duration
                        </Label>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          PERF_RUN_ALL_TREND_DAYS
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Number of historical days aggregated and formatted in the telemetry payload for AI analysis and diagnostic reports.
                      </p>
                    </div>

                    <Badge variant="secondary" className="font-mono text-xs font-bold bg-background border border-border/80 px-2.5 py-1">
                      {trendDays} Days = {trendDays * 24} Hours
                    </Badge>
                  </div>

                  {/* Quick Preset Pills */}
                  <div className="space-y-2 pt-1">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick Timeframe Presets
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_PERF_DAYS.map((d) => {
                        const isSelected = trendDays === d;
                        return (
                          <Button
                            key={d}
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            size="sm"
                            onClick={() => setTrendDays(d)}
                            className={cn(
                              "text-xs transition-all h-8",
                              isSelected
                                ? "bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.25)] font-semibold"
                                : "hover:border-cyan-500/40 hover:bg-cyan-500/5"
                            )}
                          >
                            {isSelected && <Check className="mr-1.5 h-3.5 w-3.5" />}
                            {d} {d === 1 ? "Day (24h)" : `Days (${d * 24}h)`}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom Days Input */}
                  <div className="max-w-md space-y-1.5 rounded-lg border border-border/60 bg-background/80 p-3 shadow-xs">
                    <Label htmlFor="trend-days-input" className="text-xs font-semibold text-foreground">
                      Custom Number of Days (1 to 90 Days):
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="trend-days-input"
                        type="number"
                        min={1}
                        max={90}
                        value={trendDays}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (Number.isFinite(val)) setTrendDays(val);
                          else if (e.target.value === "") setTrendDays(1);
                        }}
                        className="font-mono text-sm bg-background font-semibold"
                      />
                      <span className="shrink-0 text-xs font-mono text-muted-foreground">
                        = {trendDays * 24} Hours Historical Window
                      </span>
                    </div>
                  </div>
                </div>

                {/* Pipeline Flow Architecture */}
                <div className="space-y-3 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                    <h3 className="text-sm font-bold text-foreground">
                      Telemetry Pipeline &amp; Workflow Execution Flow
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4 pt-2">
                    <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[10px]">1</div>
                        Action Trigger
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        DBA clicks <strong>RUN ALL</strong> on Performance Tuning page.
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[10px]">2</div>
                        Config Lookup
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Reads <code className="font-mono text-[10px]">PERF_RUN_ALL_TREND_DAYS</code> ({trendDays}d).
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[10px]">3</div>
                        AWR Aggregation
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Gathers CPU, Memory, Sessions &amp; Storage metrics for {trendDays} days.
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-[10px]">4</div>
                        n8n Webhook
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Dispatches formatted JSON payload to n8n analyzer.
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>

              {/* Action Footer */}
              <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/40 px-6 py-4">
                <div className="text-xs text-muted-foreground">
                  {isPerfDirty ? (
                    <span className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Unsaved changes: {trendDays} days ({trendDays * 24} hours) selected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-cyan-500" />
                      Configuration is synchronized with APP_SYSTEM_CONFIG
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setTrendDays(initialDays)}
                    disabled={!isPerfDirty || savingPerf}
                    className="text-xs font-medium"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSavePerformanceConfig}
                    disabled={savingPerf || !isPerfDirty || trendDays < 1 || trendDays > 90}
                    className="gap-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white shadow-sm"
                  >
                    {savingPerf ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        Save Configuration
                      </>
                    )}
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* TAB 3: SECURITY POSTURE POLICY (VIOLET THEME) */}
          {/* ========================================================================= */}
          <TabsContent value="security-posture" className="space-y-6 focus-visible:outline-none">
            <Card className="overflow-hidden border-border/80 bg-card/90 shadow-md backdrop-blur-xs">
              <CardHeader className="border-b border-border/60 bg-gradient-to-r from-violet-500/5 via-transparent to-transparent pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <CardTitle className="flex items-center gap-2.5 text-lg font-bold text-foreground">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                          <ShieldAlert className="h-4 w-4" />
                        </div>
                        Security Posture Nessus Scan Report Policy
                      </CardTitle>
                      <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 font-mono text-xs font-medium text-violet-700 dark:text-violet-300">
                        Active Expiry: {initialPolicyDays} Days
                      </Badge>
                      <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 font-mono text-xs font-medium text-violet-700 dark:text-violet-300">
                        Max {initialPolicy.outdatedWebhookMaxSends} Sends / {initialPolicy.outdatedWebhookIntervalHours}h Interval
                      </Badge>
                    </div>
                    <CardDescription className="text-xs text-muted-foreground">
                      Configure document obsolescence thresholds, automated n8n overdue webhook alerts, and scheduler check frequencies backed by <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">APP_SYSTEM_CONFIG</code>.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-7 pt-6">
                {/* 2x2 Parameter Grid */}
                <div className="grid gap-5 md:grid-cols-2">
                  {/* Parameter 1: Report Outdated Threshold */}
                  <div className="space-y-3.5 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          1. Report Outdated Threshold
                        </Label>
                        <Badge variant="secondary" className="font-mono text-xs font-bold bg-background border border-border/80">
                          {policyDays} Days ({policy.outdatedAfterMinutes} min)
                        </Badge>
                      </div>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        SECURITY_POSTURE_OUTDATED_AFTER_MINUTES
                      </code>
                      <p className="text-xs text-muted-foreground">
                        Age at which a Nessus PDF scan report is marked as overdue and triggers notifications.
                      </p>
                    </div>

                    {/* Presets */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Presets
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_OUTDATED_DAYS.map((p) => {
                          const isSelected = policy.outdatedAfterMinutes === p.minutes;
                          return (
                            <Button
                              key={p.minutes}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => setPolicy((prev) => ({ ...prev, outdatedAfterMinutes: p.minutes }))}
                              className={cn(
                                "h-7 px-2.5 text-xs transition-all",
                                isSelected
                                  ? "bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500 font-semibold shadow-[0_0_8px_rgba(139,92,246,0.25)]"
                                  : "hover:border-violet-500/40 hover:bg-violet-500/5"
                              )}
                            >
                              {p.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Dual Inputs */}
                    <div className="grid gap-2.5 sm:grid-cols-2 pt-1">
                      <div className="space-y-1 rounded-lg border border-border/60 bg-background/80 p-2.5">
                        <Label htmlFor="posture-days-input" className="text-xs font-semibold text-foreground">
                          Set in Days:
                        </Label>
                        <Input
                          id="posture-days-input"
                          type="number"
                          min={1}
                          max={365}
                          value={Math.round(policy.outdatedAfterMinutes / (24 * 60))}
                          onChange={(e) => {
                            const days = parseInt(e.target.value, 10);
                            if (Number.isFinite(days) && days > 0) {
                              setPolicy((prev) => ({ ...prev, outdatedAfterMinutes: days * 24 * 60 }));
                            }
                          }}
                          className="font-mono text-sm bg-background font-semibold h-8"
                        />
                      </div>

                      <div className="space-y-1 rounded-lg border border-border/60 bg-background/80 p-2.5">
                        <Label htmlFor="posture-minutes-input" className="text-xs font-semibold text-foreground">
                          Exact Minutes:
                        </Label>
                        <Input
                          id="posture-minutes-input"
                          type="number"
                          min={1}
                          max={525600}
                          value={policy.outdatedAfterMinutes}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (Number.isFinite(val) && val > 0) {
                              setPolicy((prev) => ({ ...prev, outdatedAfterMinutes: val }));
                            }
                          }}
                          className="font-mono text-sm bg-background font-semibold h-8"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Parameter 2: Overdue Webhook Max Sends */}
                  <div className="space-y-3.5 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          2. Overdue Webhook Max Sends
                        </Label>
                        <Badge variant="secondary" className="font-mono text-xs font-bold bg-background border border-border/80">
                          {policy.outdatedWebhookMaxSends} sends limit
                        </Badge>
                      </div>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS
                      </code>
                      <p className="text-xs text-muted-foreground">
                        Maximum consecutive overdue reminders dispatched per report before pausing.
                      </p>
                    </div>

                    {/* Presets */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Presets
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_MAX_SENDS.map((count) => {
                          const isSelected = policy.outdatedWebhookMaxSends === count;
                          return (
                            <Button
                              key={count}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => setPolicy((prev) => ({ ...prev, outdatedWebhookMaxSends: count }))}
                              className={cn(
                                "h-7 px-3 text-xs transition-all",
                                isSelected
                                  ? "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 font-semibold shadow-[0_0_8px_rgba(217,119,6,0.25)]"
                                  : "hover:border-amber-500/40 hover:bg-amber-500/5"
                              )}
                            >
                              {count}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Custom Input */}
                    <div className="max-w-xs space-y-1 rounded-lg border border-border/60 bg-background/80 p-2.5">
                      <Label htmlFor="max-sends-input" className="text-xs font-semibold text-foreground">
                        Custom Send Limit (1 to 100):
                      </Label>
                      <Input
                        id="max-sends-input"
                        type="number"
                        min={1}
                        max={100}
                        value={policy.outdatedWebhookMaxSends}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (Number.isFinite(val) && val > 0) {
                            setPolicy((prev) => ({ ...prev, outdatedWebhookMaxSends: val }));
                          }
                        }}
                        className="font-mono text-sm bg-background font-semibold h-8"
                      />
                    </div>
                  </div>

                  {/* Parameter 3: Overdue Webhook Interval Hours */}
                  <div className="space-y-3.5 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <Timer className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                          3. Overdue Webhook Interval
                        </Label>
                        <Badge variant="secondary" className="font-mono text-xs font-bold bg-background border border-border/80">
                          Every {policy.outdatedWebhookIntervalHours} Hours
                        </Badge>
                      </div>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS
                      </code>
                      <p className="text-xs text-muted-foreground">
                        Cooldown delay between consecutive notifications for the same overdue document.
                      </p>
                    </div>

                    {/* Presets */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Presets
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_WEBHOOK_INTERVAL_HOURS.map((p) => {
                          const isSelected = policy.outdatedWebhookIntervalHours === p.hours;
                          return (
                            <Button
                              key={p.hours}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => setPolicy((prev) => ({ ...prev, outdatedWebhookIntervalHours: p.hours }))}
                              className={cn(
                                "h-7 px-2.5 text-xs transition-all",
                                isSelected
                                  ? "bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 font-semibold shadow-[0_0_8px_rgba(6,182,212,0.25)]"
                                  : "hover:border-cyan-500/40 hover:bg-cyan-500/5"
                              )}
                            >
                              {p.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Custom Input */}
                    <div className="max-w-xs space-y-1 rounded-lg border border-border/60 bg-background/80 p-2.5">
                      <Label htmlFor="webhook-hours-input" className="text-xs font-semibold text-foreground">
                        Custom Cooldown (Hours, 1 to 720):
                      </Label>
                      <Input
                        id="webhook-hours-input"
                        type="number"
                        min={1}
                        max={720}
                        value={policy.outdatedWebhookIntervalHours}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (Number.isFinite(val) && val > 0) {
                            setPolicy((prev) => ({ ...prev, outdatedWebhookIntervalHours: val }));
                          }
                        }}
                        className="font-mono text-sm bg-background font-semibold h-8"
                      />
                    </div>
                  </div>

                  {/* Parameter 4: Background Scanner Frequency */}
                  <div className="space-y-3.5 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          4. Background Scanner Frequency
                        </Label>
                        <Badge variant="secondary" className="font-mono text-xs font-bold bg-background border border-border/80">
                          Every {policy.outdatedWebhookCheckIntervalMinutes} min ({scansPerDay} scans/day)
                        </Badge>
                      </div>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES
                      </code>
                      <p className="text-xs text-muted-foreground">
                        Frequency of the background cron scheduler scanning for overdue reports due for alerts.
                      </p>
                    </div>

                    {/* Presets */}
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Presets
                      </Label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_CHECK_INTERVAL_MINUTES.map((p) => {
                          const isSelected = policy.outdatedWebhookCheckIntervalMinutes === p.minutes;
                          return (
                            <Button
                              key={p.minutes}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => setPolicy((prev) => ({ ...prev, outdatedWebhookCheckIntervalMinutes: p.minutes }))}
                              className={cn(
                                "h-7 px-2.5 text-xs transition-all",
                                isSelected
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 font-semibold shadow-[0_0_8px_rgba(16,185,129,0.25)]"
                                  : "hover:border-emerald-500/40 hover:bg-emerald-500/5"
                              )}
                            >
                              {p.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Custom Input */}
                    <div className="max-w-xs space-y-1 rounded-lg border border-border/60 bg-background/80 p-2.5">
                      <Label htmlFor="scanner-freq-input" className="text-xs font-semibold text-foreground">
                        Custom Scan Frequency (Minutes, 1 to 1440):
                      </Label>
                      <Input
                        id="scanner-freq-input"
                        type="number"
                        min={1}
                        max={1440}
                        value={policy.outdatedWebhookCheckIntervalMinutes}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (Number.isFinite(val) && val > 0) {
                            setPolicy((prev) => ({ ...prev, outdatedWebhookCheckIntervalMinutes: val }));
                          }
                        }}
                        className="font-mono text-sm bg-background font-semibold h-8"
                      />
                    </div>
                  </div>
                </div>

                {/* Lifecycle & Alert Simulation Flow Diagram */}
                <div className="space-y-3 rounded-xl border border-border/80 bg-muted/15 p-5 dark:bg-card/40 shadow-xs">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    <h3 className="text-sm font-bold text-foreground">
                      Document Obsolescence &amp; Webhook Lifecycle Flow
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 pt-2">
                    <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs">
                      <div className="text-xs font-bold text-foreground">1. Upload Report</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        DBA uploads Nessus PDF report to Database Inventory.
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs">
                      <div className="text-xs font-bold text-foreground">2. Active &amp; Valid</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Status is valid until age reaches <strong>{policyDays} Days</strong>.
                      </div>
                    </div>

                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 shadow-xs">
                      <div className="text-xs font-bold text-amber-800 dark:text-amber-300">3. Outdated Flagged</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Triggers amber <span className="inline-flex items-center rounded-md border px-1 py-0 text-[9px] font-medium border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">Outdated</span> badge.
                      </div>
                    </div>

                    <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-3 shadow-xs">
                      <div className="text-xs font-bold text-cyan-800 dark:text-cyan-300">4. n8n Alert Dispatched</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Webhook sent. Cooldown of <strong>{policy.outdatedWebhookIntervalHours}h</strong> begins.
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-3 shadow-xs">
                      <div className="text-xs font-bold text-violet-800 dark:text-violet-300">5. Alert Cap Reached</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Pauses after <strong>{policy.outdatedWebhookMaxSends} alerts</strong> until new PDF is uploaded.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Storage & Architecture Card */}
                <div className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-5 text-xs shadow-xs">
                  <div className="flex items-center gap-2 font-bold text-violet-800 dark:text-violet-300 text-sm">
                    <Info className="h-4 w-4" />
                    Security Posture Policy Schema &amp; Storage Details:
                  </div>
                  <div className="mt-3 grid gap-2.5 text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                      <div>
                        <strong>Database Persistence:</strong> All 4 policy parameters are stored directly in Oracle table <code className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono font-bold text-violet-900 dark:text-violet-200 border border-violet-500/30">APP_SYSTEM_CONFIG</code> with updated user and timestamp tracking.
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                      <div>
                        <strong>Database Inventory Integration:</strong> Databases whose active security report is older than <strong>{policy.outdatedAfterMinutes} minutes ({policyDays} days)</strong> automatically evaluate <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">security_posture_outdated = true</code>.
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>

              {/* Action Footer */}
              <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/40 px-6 py-4">
                <div className="text-xs text-muted-foreground">
                  {isPolicyDirty ? (
                    <span className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Unsaved changes pending in Security Posture Policy
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-500" />
                      Security posture policy is synchronized with APP_SYSTEM_CONFIG
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPolicy({ ...initialPolicy })}
                    disabled={!isPolicyDirty || savingPolicy}
                    className="text-xs font-medium"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveSecurityPolicy}
                    disabled={savingPolicy || !isPolicyDirty}
                    className="gap-2 text-xs font-semibold bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500 text-white shadow-sm"
                  >
                    {savingPolicy ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Saving Policy...
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        Save Security Policy
                      </>
                    )}
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Safety Confirmation Dialog for Purging Expired Audit Logs */}
        <Dialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground">
                    Purge Expired Audit Logs
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                    Permanent deletion of historical audit entries from Oracle database.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs text-foreground">
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-800 dark:text-rose-200">
                <p className="font-semibold">Warning: This action is irreversible.</p>
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
                  All records in <code className="font-mono font-bold">APP_AUDIT_LOGS</code> older than <strong>{auditPolicy.retentionDays} Days</strong> (created before {cutoffFormatted}) will be permanently deleted.
                </p>
              </div>

              <div className="rounded-lg border border-border/80 bg-muted/40 p-3 space-y-1 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Eligible Expired Records:</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    {auditStats ? formatNumber(auditStats.expiredLogsCount) : 0} rows
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Retention Lifespan:</span>
                  <span className="font-bold">{auditPolicy.retentionDays} Days</span>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPurgeDialogOpen(false)}
                disabled={purgingAudit}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handlePurgeExpiredAuditLogs}
                disabled={purgingAudit}
                className="gap-1.5 text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                {purgingAudit ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Purging Records...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    Confirm &amp; Purge Now
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
