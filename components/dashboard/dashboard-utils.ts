import type { DashboardMetrics } from "@/types/dba";

// ─── Number & formatting helpers ────────────────────────────────────────────

export function fmtUptime(hours: number): string {
  if (!hours) return "—";
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  const m = Math.round((hours % 1) * 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 && d === 0) parts.push(`${m}m`);
  return parts.join(" ") || "< 1m";
}

export function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function fmtMb(mb: unknown): string {
  const n = safeNum(mb);
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  return `${Math.round(n)} MB`;
}

export function pctColor(pct: unknown): string {
  const n = safeNum(pct);
  if (n >= 90) return "text-red-400";
  if (n >= 75) return "text-amber-400";
  return "text-emerald-400";
}

export function pctBarColor(pct: unknown): string {
  const n = safeNum(pct);
  if (n >= 90) return "bg-red-500";
  if (n >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

export function pctStroke(pct: unknown): string {
  const n = safeNum(pct);
  if (n >= 90) return "#ef4444";
  if (n >= 75) return "#f59e0b";
  return "#10b981";
}

// ─── Record helpers (Oracle UPPERCASE vs lowercase JSON keys) ────────────────

// Reads a field from a record trying lowercase then UPPERCASE.
// Oracle DB node returns all column names in uppercase by default.
export function field<T = unknown>(row: Record<string, unknown>, key: string): T {
  return (row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]) as T;
}

export function safeStr(v: unknown, fallback = ""): string {
  return v != null ? String(v) : fallback;
}

export function rawArray(row: Record<string, unknown>, key: string): unknown[] {
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  return Array.isArray(value) ? value : [];
}

export function fmtDateOnly(value: unknown): string {
  const raw = safeStr(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Badge color helpers ─────────────────────────────────────────────────────

export function getEnvBadgeColor(env?: string): string {
  switch (env?.toUpperCase()) {
    case "PROD":
      return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300";
    case "UAT":
      return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "DEV":
      return "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "DR":
      return "border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300";
    default:
      return "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300";
  }
}

export function getOsBadgeColor(os?: string): string {
  switch (os?.toLowerCase()) {
    case "windows":
      return "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "linux":
      return "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300";
    default:
      return "border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
  }
}

export function getDbTypeBadgeColor(dbType?: string): string {
  switch (dbType) {
    case "RAC & Datagaurd":
    case "RAC & Dataguard":
      return "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300";
    case "RAC":
      return "border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
    case "Dataguard":
      return "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300";
    case "Active Dataguard":
      return "border-pink-500/40 bg-pink-500/15 text-pink-700 dark:text-pink-300";
    case "Standalone":
    default:
      return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
  }
}

export function getDbVersionBadgeColor(): string {
  return "border-purple-500/40 bg-purple-500/15 text-purple-800 dark:text-purple-300";
}

export function getDivisionBadgeColor(division?: string): string {
  switch (division?.toUpperCase()) {
    case "PCPB":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "ITD":
      return "border-cyan-500/40 bg-cyan-500/15 text-cyan-800 dark:text-cyan-300";
    case "FBD":
      return "border-violet-500/40 bg-violet-500/15 text-violet-800 dark:text-violet-300";
    case "HOTEL":
      return "border-pink-500/40 bg-pink-500/15 text-pink-800 dark:text-pink-300";
    case "ILTD":
      return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "CORP":
      return "border-blue-500/40 bg-blue-500/15 text-blue-800 dark:text-blue-300";
    case "ITSS":
      return "border-rose-500/40 bg-rose-500/15 text-rose-800 dark:text-rose-300";
    default:
      return "border-teal-500/40 bg-teal-500/15 text-teal-800 dark:text-teal-300";
  }
}

// ─── Snapshot normalization ──────────────────────────────────────────────────

// Normalise a raw metrics object from any source (n8n response or Oracle CLOB).
// Handles both lowercase keys (app convention) and UPPERCASE keys (Oracle default).
export function normalizeMetrics(raw: unknown): DashboardMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // db_health is the required sentinel — if it's missing this isn't a dashboard snapshot
  const dbh = (r.db_health ?? r.DB_HEALTH) as Record<string, unknown> | undefined;
  if (!dbh) return null;

  const osRes = (r.os_resources ?? r.OS_RESOURCES ?? {}) as Record<string, unknown>;
  const sgaPga = (r.sga_pga ?? r.SGA_PGA ?? {}) as Record<string, unknown>;

  // Tablespaces — Oracle returns UPPERCASE column names
  const tablespaces = (Array.isArray(r.tablespaces) ? r.tablespaces : []).map((t: unknown) => {
    const row = (t ?? {}) as Record<string, unknown>;
    return {
      tablespace_name: safeStr(field(row, "tablespace_name")),
      total_mb:        safeNum(field(row, "total_mb")),
      used_mb:         safeNum(field(row, "used_mb")),
      free_mb:         safeNum(field(row, "free_mb")),
      pct_used:        safeNum(field(row, "pct_used")),
    };
  });

  // RMAN backups — Oracle returns UPPERCASE column names
  const rmanBackups = (Array.isArray(r.rman_backups) ? r.rman_backups : []).map((b: unknown) => {
    const row = (b ?? {}) as Record<string, unknown>;
    return {
      start_time:   safeStr(field(row, "start_time")),
      end_time:     safeStr(field(row, "end_time")),
      input_type:   safeStr(field(row, "input_type")),
      status:       safeStr(field(row, "status")),
      duration_min: safeNum(field(row, "duration_min")),
    };
  });

  // Blocking sessions
  const blockingSessions = (Array.isArray(r.blocking_sessions) ? r.blocking_sessions : []).map(
    (b: unknown) => {
      const row = (b ?? {}) as Record<string, unknown>;
      return {
        waiter_sid:     safeNum(field(row, "waiter_sid")),
        waiter_serial:  safeNum(field(row, "waiter_serial")),
        waiter_user:    safeStr(field(row, "waiter_user")),
        waiter_sql_id:  safeStr(field(row, "waiter_sql_id")),
        blocker_sid:    safeNum(field(row, "blocker_sid")),
        blocker_serial: safeNum(field(row, "blocker_serial")),
        blocker_user:   safeStr(field(row, "blocker_user")),
        blocker_sql_id: safeStr(field(row, "blocker_sql_id")),
        waiting_min:    safeNum(field(row, "waiting_min")),
        event:          safeStr(field(row, "event")),
      };
    }
  );

  // ORA errors — Oracle returns UPPERCASE column names
  const oraErrors = (Array.isArray(r.ora_errors) ? r.ora_errors : []).map((e: unknown) => {
    const row = (e ?? {}) as Record<string, unknown>;
    return {
      originating_timestamp: safeStr(field(row, "originating_timestamp")),
      message_text:          safeStr(field(row, "message_text")),
    };
  });

  const archiveLogGeneration = rawArray(r, "archive_log_generation").map((a: unknown) => {
    const row = (a ?? {}) as Record<string, unknown>;
    return {
      month:             safeStr(field(row, "month")),
      archive_log_count: safeNum(field(row, "archive_log_count")),
      archive_gb:        safeNum(field(row, "archive_gb")),
    };
  });

  const datapumpExports = rawArray(r, "datapump_exports").map((d: unknown) => {
    const row = (d ?? {}) as Record<string, unknown>;
    return {
      owner_name: safeStr(field(row, "owner_name")),
      job_name:   safeStr(field(row, "job_name")),
      operation:  safeStr(field(row, "operation")),
      job_mode:   safeStr(field(row, "job_mode")),
      state:      safeStr(field(row, "state")),
    };
  });

  const passwordExpiringUsers = rawArray(r, "password_expiring_users").map((u: unknown) => {
    const row = (u ?? {}) as Record<string, unknown>;
    return {
      username:       safeStr(field(row, "username")),
      account_status: safeStr(field(row, "account_status")),
      expiry_date:    safeStr(field(row, "expiry_date")),
    };
  });

  // FRA — may come back as an empty object {} if the query returned no rows
  const fraRaw = (r.fra ?? r.FRA ?? {}) as Record<string, unknown>;
  const fraSize = safeNum(field(fraRaw, "fra_size_gb"));
  const fra = fraSize > 0
    ? {
        name:            safeStr(field(fraRaw, "name")),
        fra_size_gb:     fraSize,
        used_gb:         safeNum(field(fraRaw, "used_gb")),
        reclaimable_gb:  safeNum(field(fraRaw, "reclaimable_gb")),
        pct_used:        safeNum(field(fraRaw, "pct_used")),
      }
    : null;

  return {
    db_health: {
      db_name:          safeStr(field(dbh, "db_name")),
      open_mode:        safeStr(field(dbh, "open_mode")),
      listener_status:  safeStr(field(dbh, "listener_status"), "UNKNOWN"),
      connection_test:  (safeStr(field(dbh, "connection_test"), "UNKNOWN")) as "SUCCESS" | "FAILED" | "UNKNOWN",
      instance_name:    safeStr(field(dbh, "instance_name")),
      host_name:        safeStr(field(dbh, "host_name")),
      startup_time:     field(dbh, "startup_time") != null ? safeStr(field(dbh, "startup_time")) : null,
      uptime_hours:     safeNum(field(dbh, "uptime_hours")),
      db_version:       field(dbh, "db_version") != null ? safeStr(field(dbh, "db_version")) : field(dbh, "version") != null ? safeStr(field(dbh, "version")) : undefined,
    },
    os_resources: (() => {
      const rawTotal = safeNum(field(osRes, "total_memory_gb"));
      const rawFree  = safeNum(field(osRes, "free_memory_gb"));

      // Guard: if total_memory_gb is in the 1–100 range AND free_memory_gb is 0,
      // the n8n code node mistakenly placed the raw stdout percentage in that field
      // instead of an actual GB measurement. Reclaim it as memory_used_pct.
      const totalIsPct = rawTotal > 0 && rawTotal <= 100 && rawFree === 0;
      const totalGb = totalIsPct ? 0 : rawTotal;

      // Resolve memory_used_pct in priority order:
      //   1. explicit memory_used_pct field
      //   2. total_memory_gb when it was detected as a percentage (above)
      //   3. stdout / output inside os_resources (n8n passes b3.stdout through)
      //   4. stdout / output at the top-level raw object (older snapshots)
      let memPct: number | undefined;
      const directPct = safeNum(field(osRes, "memory_used_pct"));
      if (directPct > 0) {
        memPct = directPct;
      } else if (totalIsPct) {
        memPct = rawTotal;
      } else if (totalGb === 0) {
        const fromOs  = safeNum(field(osRes, "stdout") ?? field(osRes, "output"));
        const fromTop = safeNum((r.stdout as unknown) ?? (r.output as unknown) ?? (r.os_resources_stdout as unknown));
        const v = fromOs > 0 ? fromOs : fromTop > 0 ? fromTop : 0;
        if (v > 0) memPct = v;
      }

      return {
        cpu_usage_pct:   safeNum(field(osRes, "cpu_usage_pct")),
        total_memory_gb: totalGb,
        free_memory_gb:  rawFree,
        memory_used_pct: memPct,
      };
    })(),
    sga_pga: {
      sga_target:           safeStr(field(sgaPga, "sga_target"),           "N/A"),
      sga_max_size:         safeStr(field(sgaPga, "sga_max_size"),         "N/A"),
      pga_aggregate_target: safeStr(field(sgaPga, "pga_aggregate_target"), "N/A"),
      pga_aggregate_limit:  safeStr(field(sgaPga, "pga_aggregate_limit")),
    },
    tablespaces,
    rman_backups: rmanBackups,
    active_sessions:   safeNum(r.active_sessions   ?? r.ACTIVE_SESSIONS),
    inactive_sessions: safeNum(r.inactive_sessions ?? r.INACTIVE_SESSIONS),
    blocking_sessions: blockingSessions,
    failed_jobs:       safeNum(r.failed_jobs   ?? r.FAILED_JOBS),
    invalid_objects:   safeNum(r.invalid_objects ?? r.INVALID_OBJECTS),
    users_expiring_in_15_days: safeNum(r.users_expiring_in_15_days ?? r.USERS_EXPIRING_IN_15_DAYS ?? passwordExpiringUsers.length),
    archive_log_generation:    archiveLogGeneration,
    tablespaces_over_90:       safeNum(r.tablespaces_over_90 ?? r.TABLESPACES_OVER_90),
    datapump_exports:          datapumpExports,
    password_expiring_users:   passwordExpiringUsers,
    failed_login_count:        safeNum(r.failed_login_count ?? r.FAILED_LOGIN_COUNT),
    db_response_time_ms:       field(r, "db_response_time_ms") != null ? safeNum(field(r, "db_response_time_ms")) : undefined,
    total_db_size_gb:          field(r, "total_db_size_gb") != null ? safeNum(field(r, "total_db_size_gb")) : undefined,
    avg_active_sessions_1hr:   field(r, "avg_active_sessions_1hr") != null ? safeNum(field(r, "avg_active_sessions_1hr")) : undefined,
    peak_active_sessions_1hr:  field(r, "peak_active_sessions_1hr") != null ? safeNum(field(r, "peak_active_sessions_1hr")) : undefined,
    fra:               fra ?? { name: "", fra_size_gb: 0, used_gb: 0, reclaimable_gb: 0, pct_used: 0 },
    ora_errors:        oraErrors,
    captured_at:       r.captured_at ? safeStr(r.captured_at) : undefined,
  };
}
