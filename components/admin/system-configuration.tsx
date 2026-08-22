"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  Check,
  Clock,
  Database,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Trash2
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_SECURITY_POSTURE_POLICY, type SecurityPosturePolicyConfig } from "@/lib/security-posture-policy";
import { formatDateTime, formatNumber } from "@/lib/utils";
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
  { label: "3 Years", days: 1095, years: 3 },
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

  const policyDays = Math.round((policy.outdatedAfterMinutes / (24 * 60)) * 10) / 10;
  const initialPolicyDays = Math.round((initialPolicy.outdatedAfterMinutes / (24 * 60)) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-gradient-to-r from-card via-card/90 to-muted/30 p-6 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <SlidersHorizontal className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">System Configuration</h1>
              <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                APP_ADMIN ONLY
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage system-wide parameters, diagnostics defaults, Audit Log retention, Performance trends, and Security Posture policies.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadConfig}
          disabled={loading || savingPerf || savingPolicy || savingAuditPolicy || purgingAudit}
          className="gap-2 text-xs border-border/80 hover:bg-muted/80"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Reload Settings
        </Button>
      </div>

      {/* Tabs Layout */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-3 bg-muted/70 p-1">
          <TabsTrigger value="audit-retention" className="flex items-center gap-2 text-xs font-medium">
            <Shield className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Audit Retention
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2 text-xs font-medium">
            <Activity className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
            Performance &amp; n8n
          </TabsTrigger>
          <TabsTrigger value="security-posture" className="flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            Security Posture
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Audit Log Retention Policy */}
        <TabsContent value="audit-retention" className="space-y-6">
          <Card className="border-border/80 shadow-sm bg-card">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                      <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      Audit Log Retention Policy
                    </CardTitle>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Active: {initialAuditPolicy.retentionDays} Days ({Math.round((initialAuditPolicy.retentionDays / 365) * 10) / 10} Yr{initialAuditPolicy.retentionDays >= 730 ? "s" : ""})
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[11px] font-medium ${
                        initialAuditPolicy.autoPurgeEnabled
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-border/60 bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {initialAuditPolicy.autoPurgeEnabled ? "Auto-Purge Active" : "Auto-Purge Disabled"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    Configure retention lifespan for operational audit logs in <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">APP_AUDIT_LOGS</code> (1 Year to 7 Years), schedule automated background cleanup, and enforce data governance backed by <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">APP_SYSTEM_CONFIG</code>.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-8">
              {/* Parameter 1: Retention Lifespan in Days & Years */}
              <div className="space-y-3.5 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                      <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      1. Retention Lifespan (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">AUDIT_LOG_RETENTION_DAYS</code>)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Lifespan from 1 Year (365 Days) to 7 Years (2555 Days). Audit logs older than this threshold are marked as expired and purged by scheduled maintenance or manual cleanup.
                    </p>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs font-medium">
                    {auditPolicy.retentionDays} Days ({Math.round((auditPolicy.retentionDays / 365) * 10) / 10} Years)
                  </Badge>
                </div>

                {/* Quick Presets */}
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Presets (1 to 7 Years)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_AUDIT_RETENTION_DAYS.map((p) => (
                      <Button
                        key={p.days}
                        type="button"
                        variant={auditPolicy.retentionDays === p.days ? "default" : "outline"}
                        size="sm"
                        onClick={() => setAuditPolicy((prev) => ({ ...prev, retentionDays: p.days }))}
                        className="text-xs transition-all"
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Custom Inputs: In Years and In Days */}
                <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
                  <div className="grid gap-1.5">
                    <Label htmlFor="audit-retention-years-input" className="text-xs font-medium text-foreground">
                      Set in Years (1 – 7 Years):
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
                        className="font-mono text-sm bg-background"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground font-mono">
                        Years (1–7)
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="audit-retention-days-input" className="text-xs font-medium text-foreground">
                      Exact Value in Days (365 – 2555 Days):
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
                        className="font-mono text-sm bg-background"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground font-mono">
                        Days
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Parameter 2: Auto-Purge Toggle */}
              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                      <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      2. Automated Daily Background Cleanup (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">AUDIT_LOG_AUTO_PURGE_ENABLED</code>)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      When enabled, the server background scheduler automatically deletes expired audit log records daily at 02:30 AM.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={auditPolicy.autoPurgeEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAuditPolicy((prev) => ({ ...prev, autoPurgeEnabled: true }))}
                      className={`text-xs gap-1.5 ${auditPolicy.autoPurgeEnabled ? "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white" : ""}`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Enabled
                    </Button>
                    <Button
                      type="button"
                      variant={!auditPolicy.autoPurgeEnabled ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setAuditPolicy((prev) => ({ ...prev, autoPurgeEnabled: false }))}
                      className="text-xs"
                    >
                      Disabled
                    </Button>
                  </div>
                </div>
              </div>

              {/* Live Oracle DB Storage & Log Volume Metrics */}
              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <Database className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                    Oracle Database Storage Metrics (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">APP_AUDIT_LOGS</code>)
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={loadConfig}
                    disabled={loading}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                  >
                    <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                    Refresh Metrics
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
                  <div className="rounded-lg border border-border/70 bg-background p-3 shadow-xs">
                    <div className="text-[11px] font-medium text-muted-foreground">Total Audit Records</div>
                    <div className="mt-1 text-lg font-bold text-foreground font-mono">
                      {auditStats ? formatNumber(auditStats.totalLogs) : "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Rows in APP_AUDIT_LOGS</div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background p-3 shadow-xs">
                    <div className="text-[11px] font-medium text-muted-foreground">Oldest Recorded Log</div>
                    <div className="mt-1 text-xs font-semibold text-foreground truncate" title={auditStats?.oldestLogTimestamp ? formatDateTime(auditStats.oldestLogTimestamp) : "None"}>
                      {auditStats?.oldestLogTimestamp ? formatDateTime(auditStats.oldestLogTimestamp) : "No records"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Earliest active entry</div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background p-3 shadow-xs">
                    <div className="text-[11px] font-medium text-muted-foreground">Expired Records</div>
                    <div className={`mt-1 text-lg font-bold font-mono ${auditStats && auditStats.expiredLogsCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {auditStats ? formatNumber(auditStats.expiredLogsCount) : "0"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">&gt; {auditPolicy.retentionDays} days threshold</div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background p-3 shadow-xs">
                    <div className="text-[11px] font-medium text-muted-foreground">Last Purge Execution</div>
                    <div className="mt-1 text-xs font-semibold text-foreground truncate" title={auditStats?.lastPurgeAt ? `${formatDateTime(auditStats.lastPurgeAt)} (${auditStats.lastPurgedCount} removed)` : "Never executed"}>
                      {auditStats?.lastPurgeAt ? formatDateTime(auditStats.lastPurgeAt) : "Never"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {auditStats?.lastPurgedCount ? `${auditStats.lastPurgedCount} records removed` : "No purge history"}
                    </div>
                  </div>
                </div>

                {/* Manual Purge Action Button */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
                  <div className="text-xs text-muted-foreground">
                    {auditStats && auditStats.expiredLogsCount > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400 font-medium">
                        {auditStats.expiredLogsCount} record{auditStats.expiredLogsCount === 1 ? "" : "s"} older than {auditPolicy.retentionDays} days are eligible for immediate purge.
                      </span>
                    ) : (
                      <span>All audit records are within the active retention window.</span>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePurgeExpiredAuditLogs}
                    disabled={purgingAudit || loading || (auditStats?.expiredLogsCount === 0 && !isAuditDirty)}
                    className="gap-2 text-xs border-rose-500/30 text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300"
                  >
                    {purgingAudit ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Purging Expired Logs...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3.5 w-3.5" />
                        Purge Expired Logs Now
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Informational Integration Box */}
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                  <Info className="h-4 w-4" />
                  Audit Log Governance &amp; Compliance Details:
                </div>
                <ul className="mt-2.5 grid gap-1.5 pl-6 text-muted-foreground list-disc">
                  <li>
                    <strong>Storage:</strong> Policy parameters are stored in Oracle table <code className="rounded bg-emerald-500/10 dark:bg-emerald-950/60 px-1 py-0.5 font-mono text-emerald-800 dark:text-emerald-200 border border-emerald-500/20">APP_SYSTEM_CONFIG</code> under key <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">AUDIT_LOG_RETENTION_DAYS</code>.
                  </li>
                  <li>
                    <strong>Audit Page Visibility:</strong> The active retention period ({auditPolicy.retentionDays} Days) is dynamically displayed in the <strong>Audit Logs</strong> page header for full compliance visibility.
                  </li>
                  <li>
                    <strong>Purge Audit Trail:</strong> Every manual and automated purge execution records an immutable audit entry with actor, row count, and timestamp in <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">APP_AUDIT_LOGS</code>.
                  </li>
                </ul>
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between border-t border-border/70 bg-muted/30 dark:bg-muted/20 px-6 py-3.5">
              <div className="text-xs text-muted-foreground">
                {isAuditDirty ? (
                  <span className="font-medium text-amber-700 dark:text-amber-300">Unsaved changes pending in Audit Retention Policy</span>
                ) : (
                  <span>Audit retention policy is up to date in APP_SYSTEM_CONFIG</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAuditPolicy({ ...initialAuditPolicy })}
                  disabled={!isAuditDirty || savingAuditPolicy}
                  className="text-xs"
                >
                  Reset
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveAuditRetentionPolicy}
                  disabled={savingAuditPolicy || !isAuditDirty}
                  className="gap-2 text-xs bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white"
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

        {/* Tab 2: Performance & n8n Diagnostics */}
        <TabsContent value="performance" className="space-y-6">
          <Card className="border-border/80 shadow-sm bg-card">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                      <Activity className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                      RUN ALL Historical Trend Window
                    </CardTitle>
                    <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-xs font-medium text-cyan-700 dark:text-cyan-300">
                      Active: {initialDays} Day{initialDays === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    Configure the timeframe window of Historical Performance &amp; Capacity Trends data sent to n8n when executing the <strong>RUN ALL</strong> (<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">check_performance</code>) action.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Presets */}
              <div className="space-y-2.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Quick Presets
                </Label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_PERF_DAYS.map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant={trendDays === d ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTrendDays(d)}
                      className="text-xs transition-all"
                    >
                      {d} {d === 1 ? "Day (24h)" : `Days (${d * 24}h)`}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Custom Input */}
              <div className="grid max-w-sm gap-2">
                <Label htmlFor="trend-days-input" className="text-xs font-medium text-foreground">
                  Custom Number of Days (1 – 90):
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
                    className="font-mono text-sm bg-background"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground font-mono">
                    = {trendDays * 24} Hours
                  </span>
                </div>
              </div>

              {/* Payload Preview info */}
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 dark:bg-cyan-950/20 p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold text-cyan-700 dark:text-cyan-300">
                  <Info className="h-4 w-4" />
                  Payload Sent to n8n Webhook:
                </div>
                <ul className="mt-2.5 grid gap-1.5 pl-6 text-muted-foreground list-disc">
                  <li>
                    <strong>Trend Key:</strong> <code className="rounded bg-cyan-500/10 dark:bg-cyan-950/60 px-1 py-0.5 font-mono text-cyan-800 dark:text-cyan-200 border border-cyan-500/20">last_days_performance_trends</code> (aggregating the last {trendDays} day{trendDays === 1 ? "" : "s"})
                  </li>
                  <li>
                    <strong>Performance Metrics:</strong> Avg Response Time, Avg Active Sessions (1h), Peak Active Sessions (1h), Max Tablespace Util (single maximum), CPU Util %, OS Memory Util %, FRA Util %
                  </li>
                  <li>
                    <strong>Inventory Metadata:</strong> DB Version, Operating System, Database Type
                  </li>
                </ul>
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between border-t border-border/70 bg-muted/30 dark:bg-muted/20 px-6 py-3.5">
              <div className="text-xs text-muted-foreground">
                {isPerfDirty ? (
                  <span className="font-medium text-amber-700 dark:text-amber-300">Unsaved changes: {trendDays} days selected</span>
                ) : (
                  <span>Configuration is up to date</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTrendDays(initialDays)}
                  disabled={!isPerfDirty || savingPerf}
                  className="text-xs"
                >
                  Reset
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleSavePerformanceConfig}
                  disabled={savingPerf || !isPerfDirty || trendDays < 1 || trendDays > 90}
                  className="gap-2 text-xs bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white"
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

        {/* Tab 3: Security Posture Policy Configuration */}
        <TabsContent value="security-posture" className="space-y-6">
          <Card className="border-border/80 shadow-sm bg-card">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                      <ShieldAlert className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      Security Posture Nessus Scan Report Policy
                    </CardTitle>
                    <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-xs font-medium text-violet-700 dark:text-violet-300">
                      Active Expiry: {initialPolicyDays} Days
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    Configure document obsolescence thresholds, automated n8n overdue webhook alerts, and scheduler check frequencies backed by <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">APP_SYSTEM_CONFIG</code>.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-8">
              {/* Parameter 1: Outdated After Threshold */}
              <div className="space-y-3.5 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                      <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      1. Report Outdated Threshold (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">SECURITY_POSTURE_OUTDATED_AFTER_MINUTES</code>)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Age at which an active Nessus PDF report is marked as overdue. Triggers the amber badge in database inventory selection and initiates overdue n8n alerts.
                    </p>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs font-medium">
                    {policy.outdatedAfterMinutes} min ({policyDays} days)
                  </Badge>
                </div>

                {/* Quick Presets */}
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Presets
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_OUTDATED_DAYS.map((p) => (
                      <Button
                        key={p.minutes}
                        type="button"
                        variant={policy.outdatedAfterMinutes === p.minutes ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPolicy((prev) => ({ ...prev, outdatedAfterMinutes: p.minutes }))}
                        className="text-xs transition-all"
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Custom Inputs */}
                <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
                  <div className="grid gap-1.5">
                    <Label htmlFor="posture-days-input" className="text-xs font-medium text-foreground">
                      Set in Days:
                    </Label>
                    <div className="flex items-center gap-2">
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
                        className="font-mono text-sm bg-background"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground font-mono">
                        Days
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="posture-minutes-input" className="text-xs font-medium text-foreground">
                      Exact Value in Minutes:
                    </Label>
                    <div className="flex items-center gap-2">
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
                        className="font-mono text-sm bg-background"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground font-mono">
                        Minutes
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Webhook Parameters: Max Sends & Interval */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Parameter 2: Overdue Webhook Max Sends */}
                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                        <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        2. Overdue Webhook Max Sends
                      </Label>
                      <Badge variant="outline" className="font-mono text-xs border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        {policy.outdatedWebhookMaxSends} sends
                      </Badge>
                    </div>
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground font-mono">SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS</code>
                    <p className="text-xs text-muted-foreground">
                      Maximum number of successful overdue-report webhook reminders sent for each document before pausing.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Presets
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_MAX_SENDS.map((count) => (
                        <Button
                          key={count}
                          type="button"
                          variant={policy.outdatedWebhookMaxSends === count ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPolicy((prev) => ({ ...prev, outdatedWebhookMaxSends: count }))}
                          className="h-7 px-2.5 text-xs"
                        >
                          {count}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid max-w-xs gap-1.5">
                    <Label htmlFor="max-sends-input" className="text-xs font-medium text-foreground">
                      Custom Send Limit (1 – 100):
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
                      className="font-mono text-sm bg-background"
                    />
                  </div>
                </div>

                {/* Parameter 3: Overdue Webhook Interval Hours */}
                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                        <Timer className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                        3. Overdue Webhook Interval
                      </Label>
                      <Badge variant="outline" className="font-mono text-xs border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                        {policy.outdatedWebhookIntervalHours}h delay
                      </Badge>
                    </div>
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground font-mono">SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS</code>
                    <p className="text-xs text-muted-foreground">
                      Cooldown delay between consecutive successful overdue webhook notifications for the same report.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Presets
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_WEBHOOK_INTERVAL_HOURS.map((p) => (
                        <Button
                          key={p.hours}
                          type="button"
                          variant={policy.outdatedWebhookIntervalHours === p.hours ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPolicy((prev) => ({ ...prev, outdatedWebhookIntervalHours: p.hours }))}
                          className="h-7 px-2.5 text-xs"
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid max-w-xs gap-1.5">
                    <Label htmlFor="webhook-hours-input" className="text-xs font-medium text-foreground">
                      Custom Interval (Hours):
                    </Label>
                    <div className="flex items-center gap-2">
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
                        className="font-mono text-sm bg-background"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground font-mono">
                        Hours
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Parameter 4: Scheduler Check Interval */}
              <div className="space-y-3.5 rounded-lg border border-border/70 bg-muted/20 dark:bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                      <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      4. Background Scheduler Scanner Frequency (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES</code>)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      How frequently the background cron task scans Oracle DB for overdue reports due to send another n8n notification.
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    Every {policy.outdatedWebhookCheckIntervalMinutes} min ({Math.round((policy.outdatedWebhookCheckIntervalMinutes / 60) * 10) / 10}h)
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Presets
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_CHECK_INTERVAL_MINUTES.map((p) => (
                      <Button
                        key={p.minutes}
                        type="button"
                        variant={policy.outdatedWebhookCheckIntervalMinutes === p.minutes ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPolicy((prev) => ({ ...prev, outdatedWebhookCheckIntervalMinutes: p.minutes }))}
                        className="text-xs transition-all"
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid max-w-sm gap-1.5">
                  <Label htmlFor="scanner-freq-input" className="text-xs font-medium text-foreground">
                    Custom Frequency in Minutes (1 – 1440):
                  </Label>
                  <div className="flex items-center gap-2">
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
                      className="font-mono text-sm bg-background"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground font-mono">
                      = {Math.round((policy.outdatedWebhookCheckIntervalMinutes / 60) * 10) / 10} Hours
                    </span>
                  </div>
                </div>
              </div>

              {/* Informational Box */}
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 dark:bg-violet-950/20 p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold text-violet-700 dark:text-violet-300">
                  <Info className="h-4 w-4" />
                  Database &amp; Workflow Integration Details:
                </div>
                <ul className="mt-2.5 grid gap-1.5 pl-6 text-muted-foreground list-disc">
                  <li>
                    <strong>Storage:</strong> Stored permanently in Oracle table <code className="rounded bg-violet-500/10 dark:bg-violet-950/60 px-1 py-0.5 font-mono text-violet-800 dark:text-violet-200 border border-violet-500/20">APP_SYSTEM_CONFIG</code> with full change tracking and audit timestamps.
                  </li>
                  <li>
                    <strong>Database Inventory Outdated Flag:</strong> Databases with an active Nessus PDF older than <strong>{policy.outdatedAfterMinutes} minutes ({policyDays} days)</strong> are automatically marked with <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">security_posture_outdated = true</code>.
                  </li>
                  <li>
                    <strong>n8n Alert Dispatch:</strong> Sends up to <strong>{policy.outdatedWebhookMaxSends} alerts</strong> with a <strong>{policy.outdatedWebhookIntervalHours}-hour cooldown</strong> between sends to <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">SECURITY_POSTURE_N8N_WEBHOOK_URL</code>.
                  </li>
                </ul>
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between border-t border-border/70 bg-muted/30 dark:bg-muted/20 px-6 py-3.5">
              <div className="text-xs text-muted-foreground">
                {isPolicyDirty ? (
                  <span className="font-medium text-amber-700 dark:text-amber-300">Unsaved changes pending in Security Posture Policy</span>
                ) : (
                  <span>Configuration is up to date in APP_SYSTEM_CONFIG</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPolicy({ ...initialPolicy })}
                  disabled={!isPolicyDirty || savingPolicy}
                  className="text-xs"
                >
                  Reset
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveSecurityPolicy}
                  disabled={savingPolicy || !isPolicyDirty}
                  className="gap-2 text-xs bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500 text-white"
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
    </div>
  );
}
