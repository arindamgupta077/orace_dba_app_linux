import { type NextRequest, NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { getLatestDashboardHistory } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DashboardMetrics } from "@/types/dba";

const MOCK_METRICS: DashboardMetrics = {
  db_health: {
    db_name: "ORCL",
    open_mode: "READ WRITE",
    listener_status: "READY",
    connection_test: "SUCCESS",
    instance_name: "orcl",
    host_name: "DBSERVER01",
    startup_time: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(),
    uptime_hours: 120.5
  },
  os_resources: {
    cpu_usage_pct: 45.2,
    total_memory_gb: 64,
    free_memory_gb: 22.3
  },
  sga_pga: {
    sga_target: "8G",
    sga_max_size: "10G",
    pga_aggregate_target: "4G",
    pga_aggregate_limit: "8G"
  },
  tablespaces: [
    { tablespace_name: "USERS",    total_mb: 92160,  used_mb: 87040,  free_mb: 5120,  pct_used: 94.4 },
    { tablespace_name: "SYSTEM",   total_mb: 10240,  used_mb: 8602,   free_mb: 1638,  pct_used: 84.0 },
    { tablespace_name: "SYSAUX",   total_mb: 8192,   used_mb: 5734,   free_mb: 2458,  pct_used: 69.9 },
    { tablespace_name: "TEMP",     total_mb: 65536,  used_mb: 42598,  free_mb: 22938, pct_used: 65.0 },
    { tablespace_name: "UNDO_TBS", total_mb: 40960,  used_mb: 18432,  free_mb: 22528, pct_used: 45.0 }
  ],
  rman_backups: [
    { start_time: "06-JUN-2026 02:00:01", end_time: "06-JUN-2026 04:24:33", input_type: "DB FULL",     status: "COMPLETED",        duration_min: 144.5 },
    { start_time: "05-JUN-2026 22:00:00", end_time: "05-JUN-2026 22:18:12", input_type: "ARCHIVELOG",  status: "COMPLETED",        duration_min: 18.2  },
    { start_time: "05-JUN-2026 02:00:00", end_time: "05-JUN-2026 02:52:11", input_type: "DB INCR LVL1",status: "COMPLETED",        duration_min: 52.2  },
    { start_time: "04-JUN-2026 02:00:00", end_time: "04-JUN-2026 02:44:19", input_type: "DB INCR LVL1",status: "FAILED",           duration_min: 44.3  },
    { start_time: "03-JUN-2026 02:00:00", end_time: "03-JUN-2026 02:41:55", input_type: "DB INCR LVL1",status: "COMPLETED",        duration_min: 41.9  }
  ],
  active_sessions: 29,
  inactive_sessions: 47,
  blocking_sessions: [
    {
      waiter_sid: 122, waiter_serial: 1190, waiter_user: "REPORTING", waiter_sql_id: "4a7md0hhv81kp",
      blocker_sid: 104, blocker_serial: 9152, blocker_user: "APPS", blocker_sql_id: "9x3t1m8ap6k2v",
      waiting_min: 11.9, event: "enq: TX - row lock contention"
    }
  ],
  failed_jobs: 3,
  invalid_objects: 12,
  users_expiring_in_15_days: 2,
  archive_log_generation: [
    { month: "2026-01", archive_log_count: 812, archive_gb: 248.6 },
    { month: "2026-02", archive_log_count: 774, archive_gb: 231.9 },
    { month: "2026-03", archive_log_count: 869, archive_gb: 263.4 },
    { month: "2026-04", archive_log_count: 904, archive_gb: 279.1 },
    { month: "2026-05", archive_log_count: 945, archive_gb: 301.7 },
    { month: "2026-06", archive_log_count: 921, archive_gb: 292.5 }
  ],
  tablespaces_over_90: 1,
  datapump_exports: [
    { owner_name: "SYSTEM", job_name: "SYS_EXPORT_SCHEMA_05", operation: "EXPORT", job_mode: "SCHEMA", state: "COMPLETED" },
    { owner_name: "SYSTEM", job_name: "SYS_EXPORT_FULL_04", operation: "EXPORT", job_mode: "FULL", state: "COMPLETED" },
    { owner_name: "HR", job_name: "SYS_EXPORT_SCHEMA_03", operation: "EXPORT", job_mode: "SCHEMA", state: "NOT RUNNING" }
  ],
  password_expiring_users: [
    { username: "REPORTING", account_status: "OPEN", expiry_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 6).toISOString() },
    { username: "APPS_READ", account_status: "OPEN", expiry_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 13).toISOString() }
  ],
  failed_login_count: 4,
  fra: { name: "+FRA", fra_size_gb: 500, used_gb: 231.4, reclaimable_gb: 48.2, pct_used: 46.3 },
  ora_errors: [
    { originating_timestamp: new Date(Date.now() - 1000 * 60 * 8).toISOString(),   message_text: "ORA-01652: unable to extend temp segment by 128 in tablespace TEMP" },
    { originating_timestamp: new Date(Date.now() - 1000 * 60 * 34).toISOString(),  message_text: "ORA-04031: unable to allocate 65560 bytes of shared memory" },
    { originating_timestamp: new Date(Date.now() - 1000 * 60 * 112).toISOString(), message_text: "ORA-00054: resource busy and acquire with NOWAIT specified" }
  ],
  captured_at: new Date(Date.now() - 1000 * 60 * 3).toISOString()
};

export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const env = getServerEnv();
    const db = request.nextUrl.searchParams.get("db") || "ORCL";

    if (env.mockMode) {
      return NextResponse.json({
        db_name: db,
        refreshed_by: "ARINDAM",
        refresh_timestamp: MOCK_METRICS.captured_at ?? new Date().toISOString(),
        metrics: MOCK_METRICS,
        has_data: true
      });
    }

    const row = await getLatestDashboardHistory(db);
    if (!row) {
      return NextResponse.json({ db_name: db, refreshed_by: null, refresh_timestamp: null, metrics: null, has_data: false });
    }

    return NextResponse.json({
      db_name: row.db_name,
      refreshed_by: row.refreshed_by,
      refresh_timestamp: row.refresh_timestamp,
      metrics: row.metrics,
      has_data: row.metrics !== null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch dashboard history.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
