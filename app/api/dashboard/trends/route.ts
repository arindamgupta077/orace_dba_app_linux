import { type NextRequest, NextResponse } from "next/server";

import { getServerEnv } from "@/lib/server/env";
import { getDashboardHistoryTrends } from "@/lib/server/repository";
import { requireAuthenticatedSession } from "@/lib/server/session";
import type { DashboardHistoryRow, DashboardMetrics } from "@/types/dba";

const RANGE_HOURS: Record<string, number | null> = {
  "24h": 24,
  "7d": 168,
  "30d": 720,
  all: null
};

const DEFAULT_RANGE = "7d";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;

// Mock snapshots: one every 6h across ~32 days so every timeframe filter has data.
function generateMockTrendSnapshots(db: string, hours: number | null, limit: number): DashboardHistoryRow[] {
  const now = Date.now();
  const stepMs = 6 * 60 * 60 * 1000;
  const totalSnapshots = 130;
  const users = ["SCHEDULER", "ARINDAM", "DB_ADMIN"];
  const rows: DashboardHistoryRow[] = [];

  for (let age = totalSnapshots - 1; age >= 0; age--) {
    const tsMs = now - age * stepMs;
    if (hours != null && tsMs < now - hours * 60 * 60 * 1000) continue;

    const idx = totalSnapshots - 1 - age; // chronological index 0..N
    const connFailed = age % 27 === 8;
    const tbsPct = 78 + ((idx * 13) % 18);
    const fraPct = 36 + ((idx * 17) % 58);
    const avgSessions = 1.4 + ((idx * 3) % 42) / 10;
    const memPct = 52 + ((idx * 7) % 37);
    const timestamp = new Date(tsMs).toISOString();

    const metrics: DashboardMetrics = {
      db_health: {
        db_name: db,
        open_mode: "READ WRITE",
        listener_status: "READY",
        connection_test: connFailed ? "FAILED" : "SUCCESS",
        instance_name: db.toLowerCase(),
        host_name: "DBSERVER01",
        startup_time: new Date(now - 1000 * 60 * 60 * 240).toISOString(),
        uptime_hours: 240.5
      },
      os_resources: {
        cpu_usage_pct: 30 + ((idx * 11) % 55),
        total_memory_gb: 64,
        free_memory_gb: Number(((64 * (100 - memPct)) / 100).toFixed(1)),
        memory_used_pct: memPct
      },
      sga_pga: {
        sga_target: "8G",
        sga_max_size: "10G",
        pga_aggregate_target: "4G",
        pga_aggregate_limit: "8G"
      },
      tablespaces: [
        {
          tablespace_name: "USERS",
          total_mb: 92160,
          used_mb: Math.round((92160 * tbsPct) / 100),
          free_mb: Math.round((92160 * (100 - tbsPct)) / 100),
          pct_used: tbsPct
        },
        { tablespace_name: "SYSTEM", total_mb: 10240, used_mb: 8602, free_mb: 1638, pct_used: 84.0 },
        { tablespace_name: "SYSAUX", total_mb: 8192, used_mb: 5734, free_mb: 2458, pct_used: 69.9 }
      ],
      rman_backups: [],
      active_sessions: Math.round(avgSessions * 10),
      inactive_sessions: 47,
      blocking_sessions: [],
      failed_jobs: connFailed ? 2 : 0,
      invalid_objects: 12,
      db_response_time_ms: Number((9 + ((idx * 7) % 22)).toFixed(2)),
      total_db_size_gb: Number((208 + idx * 0.11).toFixed(2)),
      avg_active_sessions_1hr: Number(avgSessions.toFixed(2)),
      peak_active_sessions_1hr: Number((avgSessions * 2 + ((idx * 5) % 8)).toFixed(2)),
      fra: {
        name: "+FRA",
        fra_size_gb: 500,
        used_gb: Number((fraPct * 5).toFixed(1)),
        reclaimable_gb: 48.2,
        pct_used: fraPct
      },
      ora_errors: [],
      captured_at: timestamp
    };

    rows.push({
      id: 1000 + idx,
      db_name: db,
      environment: "PROD",
      os: "Linux",
      refreshed_by: users[idx % 3],
      refresh_timestamp: timestamp,
      metrics
    });
  }

  return rows.slice(-limit);
}

export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const env = getServerEnv();
    const db = request.nextUrl.searchParams.get("db") || "ORCL";
    const rangeParam = request.nextUrl.searchParams.get("range") || DEFAULT_RANGE;
    const range = rangeParam in RANGE_HOURS ? rangeParam : DEFAULT_RANGE;
    const hours = RANGE_HOURS[range];
    const limit =
      Math.max(
        1,
        Math.min(
          MAX_LIMIT,
          parseInt(request.nextUrl.searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT
        )
      );

    if (env.mockMode) {
      const snapshots = generateMockTrendSnapshots(db, hours, limit);
      return NextResponse.json({
        db_name: db,
        range,
        hours,
        limit,
        total: snapshots.length,
        snapshots
      });
    }

    const { rows: snapshots, total } = await getDashboardHistoryTrends(db, hours, limit);
    return NextResponse.json({
      db_name: db,
      range,
      hours,
      limit,
      total,
      snapshots
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch dashboard trends.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
