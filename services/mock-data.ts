import type {
  AlertLogRow,
  ApprovalStep,
  BackupRow,
  DbaAction,
  DbaFinding,
  DbaRecommendation,
  DbaResponse,
  FilesystemUsageRow,
  InvalidObjectRow,
  SessionRow,
  SqlMetricRow,
  TablespaceRow
} from "@/types/dba";

const now = Date.now();

export const mockTablespaces: TablespaceRow[] = [
  { name: "SYSTEM", used_gb: 42, free_gb: 8, pct_used: 84, status: "warning" },
  { name: "SYSAUX", used_gb: 31, free_gb: 19, pct_used: 62, status: "healthy" },
  { name: "USERS", used_gb: 91, free_gb: 7, pct_used: 93, status: "critical" },
  { name: "UNDO_TBS1", used_gb: 18, free_gb: 26, pct_used: 41, status: "healthy" },
  { name: "TEMP", used_gb: 64, free_gb: 36, pct_used: 64, status: "healthy" }
];

const mockTablespacesByDb: Record<string, TablespaceRow[]> = {
  ORCL: mockTablespaces,
  TEST: [
    { name: "SYSTEM", used_gb: 12, free_gb: 38, pct_used: 24, status: "healthy" },
    { name: "SYSAUX", used_gb: 8, free_gb: 42, pct_used: 16, status: "healthy" },
    { name: "USERS", used_gb: 21, free_gb: 79, pct_used: 21, status: "healthy" },
    { name: "TEMP", used_gb: 5, free_gb: 95, pct_used: 5, status: "healthy" }
  ],
  papps: [
    { name: "SYSTEM", used_gb: 28, free_gb: 22, pct_used: 56, status: "healthy" },
    { name: "SYSAUX", used_gb: 19, free_gb: 31, pct_used: 38, status: "healthy" },
    { name: "PAPPS_DATA", used_gb: 74, free_gb: 6, pct_used: 93, status: "critical" },
    { name: "PAPPS_IDX", used_gb: 45, free_gb: 15, pct_used: 75, status: "warning" },
    { name: "UNDO_TBS1", used_gb: 11, free_gb: 39, pct_used: 22, status: "healthy" },
    { name: "TEMP", used_gb: 33, free_gb: 67, pct_used: 33, status: "healthy" }
  ]
};

export function getMockTablespacesForDb(db?: string): TablespaceRow[] {
  if (!db) return mockTablespaces;
  return mockTablespacesByDb[db] ?? mockTablespaces;
}

const mockFilesystemsByDb: Record<string, FilesystemUsageRow[]> = {
  ORCL: [
    { name: "C:", drive: "C:", type: "drive", size_gb: 250, used_gb: 181, free_gb: 69, pct_used: 72.4, pct_free: 27.6, status: "healthy" },
    { name: "D:", drive: "D:", type: "drive", size_gb: 500, used_gb: 462, free_gb: 38, pct_used: 92.4, pct_free: 7.6, status: "critical" },
    { name: "E:", drive: "E:", type: "drive", size_gb: 1024, used_gb: 676, free_gb: 348, pct_used: 66, pct_free: 34, status: "healthy" }
  ],
  TEST: [
    { name: "/", mount_point: "/", filesystem: "/dev/sda2", type: "filesystem", size_gb: 80, used_gb: 46, free_gb: 34, pct_used: 57.5, pct_free: 42.5, status: "healthy" },
    { name: "/u01", mount_point: "/u01", filesystem: "/dev/mapper/vg00-u01", type: "filesystem", size_gb: 300, used_gb: 251, free_gb: 49, pct_used: 83.7, pct_free: 16.3, status: "warning" },
    { name: "/backup", mount_point: "/backup", filesystem: "/dev/mapper/vg00-backup", type: "filesystem", size_gb: 800, used_gb: 734, free_gb: 66, pct_used: 91.8, pct_free: 8.2, status: "critical" }
  ],
  papps: [
    { name: "/", mount_point: "/", filesystem: "/dev/sda2", type: "filesystem", size_gb: 100, used_gb: 48, free_gb: 52, pct_used: 48, pct_free: 52, status: "healthy" },
    { name: "/u02", mount_point: "/u02", filesystem: "/dev/mapper/app-u02", type: "filesystem", size_gb: 600, used_gb: 412, free_gb: 188, pct_used: 68.7, pct_free: 31.3, status: "healthy" },
    { name: "/arch", mount_point: "/arch", filesystem: "/dev/mapper/app-arch", type: "filesystem", size_gb: 500, used_gb: 456, free_gb: 44, pct_used: 91.2, pct_free: 8.8, status: "critical" }
  ]
};

export function getMockFilesystemUsageForDb(db?: string): FilesystemUsageRow[] {
  if (!db) return mockFilesystemsByDb.ORCL;
  return mockFilesystemsByDb[db] ?? mockFilesystemsByDb.ORCL;
}

export const mockSessions: SessionRow[] = [
  { sid: 104, serial: 9152, username: "APPS", machine: "payroll-node-02", program: "JDBC Thin Client", status: "ACTIVE", wait_event: "db file sequential read", seconds_in_wait: 36, sql_id: "9x3t1m8ap6k2v" },
  { sid: 122, serial: 1190, username: "REPORTING", machine: "bi-worker-01", program: "Tableau", status: "ACTIVE", wait_event: "enq: TX - row lock contention", seconds_in_wait: 712, sql_id: "4a7md0hhv81kp" },
  { sid: 208, serial: 7403, username: "SYS", machine: "prod-db-01", program: "oracle@prod", status: "INACTIVE", wait_event: "SQL*Net message from client", seconds_in_wait: 4, sql_id: "0m9vzq1sd7pgm" },
  { sid: 311, serial: 6321, username: "ETL", machine: "etl-batch-07", program: "sqlldr", status: "ACTIVE", wait_event: "direct path write temp", seconds_in_wait: 92, sql_id: "br58qsqfgr2uu" }
];

export const mockSql: SqlMetricRow[] = [
  {
    sql_id: "4a7md0hhv81kp",
    module: "Payroll close",
    executions: 19,
    elapsed_ms: 912300,
    cpu_ms: 488100,
    buffer_gets: 9234102,
    sql_text: "select employee_id, sum(amount) from payroll_txn where period_id = :b1 group by employee_id"
  },
  {
    sql_id: "9x3t1m8ap6k2v",
    module: "Order API",
    executions: 1288,
    elapsed_ms: 332900,
    cpu_ms: 302000,
    buffer_gets: 4388122,
    sql_text: "select order_id, status from order_headers where customer_id = :b1 and status <> :b2"
  },
  {
    sql_id: "br58qsqfgr2uu",
    module: "ETL load",
    executions: 7,
    elapsed_ms: 724200,
    cpu_ms: 211700,
    buffer_gets: 11923000,
    sql_text: "merge into fact_sales f using stage_sales s on (f.txn_id = s.txn_id) when matched then update set f.amount = s.amount"
  }
];

export const mockBackups: BackupRow[] = [
  { id: "BKP-20260517-01", type: "LEVEL 0", started_at: new Date(now - 1000 * 60 * 60 * 6).toISOString(), duration_min: 84, status: "SUCCESS", compression_ratio: 3.2, size_gb: 482 },
  { id: "BKP-20260516-01", type: "ARCHIVELOG", started_at: new Date(now - 1000 * 60 * 60 * 27).toISOString(), duration_min: 18, status: "SUCCESS", compression_ratio: 2.1, size_gb: 94 },
  { id: "BKP-20260515-01", type: "LEVEL 1", started_at: new Date(now - 1000 * 60 * 60 * 51).toISOString(), duration_min: 46, status: "FAILED", compression_ratio: 0, size_gb: 0 }
];

export const mockAlerts: AlertLogRow[] = [
  { timestamp: new Date(now - 1000 * 60 * 5).toISOString(), severity: "WARNING", message: "ORA-1652: unable to extend temp segment by 128 in tablespace TEMP" },
  { timestamp: new Date(now - 1000 * 60 * 27).toISOString(), severity: "ERROR", message: "Checkpoint not complete, consider increasing redo log size" },
  { timestamp: new Date(now - 1000 * 60 * 54).toISOString(), severity: "INFO", message: "Thread 1 advanced to log sequence 89231" },
  { timestamp: new Date(now - 1000 * 60 * 118).toISOString(), severity: "CRITICAL", message: "Archive log pressure detected on TEST during validation workload" }
];

export const mockInvalidObjects: InvalidObjectRow[] = [
  { owner: "APPS", object_name: "PKG_BILLING_CLOSE", object_type: "PACKAGE BODY", status: "INVALID", last_ddl_time: new Date(now - 1000 * 60 * 1440).toISOString() },
  { owner: "REPORTING", object_name: "VW_MONTHLY_MARGIN", object_type: "VIEW", status: "INVALID", last_ddl_time: new Date(now - 1000 * 60 * 4300).toISOString() },
  { owner: "ETL", object_name: "TRG_STAGE_AUDIT", object_type: "TRIGGER", status: "INVALID", last_ddl_time: new Date(now - 1000 * 60 * 2290).toISOString() }
];

const mockTopSql = [
  {
    sql_id: "4a7md0hhv81kp",
    module: "Payroll close",
    executions: 19,
    elapsed_time: 912.3,
    elapsed_sec: 912.3,
    elapsed_ms: 912300,
    cpu_sec: 488.1,
    cpu_ms: 488100,
    buffer_gets: 9234102,
    disk_reads: 18322,
    sql_text: "select employee_id, sum(amount) from payroll_txn where period_id = :b1 group by employee_id"
  },
  {
    sql_id: "9x3t1m8ap6k2v",
    module: "Order API",
    executions: 1288,
    elapsed_time: 332.9,
    elapsed_sec: 332.9,
    elapsed_ms: 332900,
    cpu_sec: 302,
    cpu_ms: 302000,
    buffer_gets: 4388122,
    disk_reads: 6441,
    sql_text: "select order_id, status from order_headers where customer_id = :b1 and status <> :b2"
  },
  {
    sql_id: "br58qsqfgr2uu",
    module: "ETL load",
    executions: 7,
    elapsed_time: 724.2,
    elapsed_sec: 724.2,
    elapsed_ms: 724200,
    cpu_sec: 211.7,
    cpu_ms: 211700,
    buffer_gets: 11923000,
    disk_reads: 28773,
    sql_text: "merge into fact_sales f using stage_sales s on (f.txn_id = s.txn_id) when matched then update set f.amount = s.amount"
  }
];

const mockCpuUsage = [
  {
    num_cpus: 8,
    current_total_cpu_util: 64.82,
    user_cpu_util: 48.31,
    system_cpu_util: 16.51
  }
];

const mockWaitEvents = [
  { event: "db file sequential read", wait_class: "User I/O", total_waits: 1832291, time_waited_sec: 88211.43, avg_wait_cs: 4.81 },
  { event: "enq: TX - row lock contention", wait_class: "Application", total_waits: 4821, time_waited_sec: 14892.2, avg_wait_cs: 309.0 },
  { event: "direct path write temp", wait_class: "User I/O", total_waits: 66214, time_waited_sec: 9312.86, avg_wait_cs: 14.06 }
];

const mockSessionLongops = [
  {
    sid: 311,
    "serial#": 6321,
    username: "ETL",
    sql_id: "br58qsqfgr2uu",
    operation: "Table Scan FACT_SALES",
    pct_done: 73.5,
    elapsed_min: 38.4,
    eta_min: 13.8
  },
  {
    sid: 419,
    "serial#": 7782,
    username: "APPS",
    sql_id: "8x4md2rqpz19k",
    operation: "Index Rebuild",
    pct_done: 42.1,
    elapsed_min: 21.2,
    eta_min: 29.1
  }
];

const mockSessionList = [
  {
    sid: 104,
    serial: 9152,
    "serial#": 9152,
    username: "APPS",
    osuser: "svc_order",
    machine: "order-api-01",
    program: "JDBC Thin Client",
    status: "ACTIVE" as const,
    sql_id: "9x3t1m8ap6k2v",
    event: "db file sequential read",
    wait_event: "db file sequential read",
    state: "WAITING",
    seconds_in_wait: 36,
    last_call_et: 92
  },
  {
    sid: 122,
    serial: 1190,
    "serial#": 1190,
    username: "REPORTING",
    osuser: "bi_user",
    machine: "bi-worker-01",
    program: "Tableau",
    status: "ACTIVE" as const,
    sql_id: "4a7md0hhv81kp",
    event: "enq: TX - row lock contention",
    wait_event: "enq: TX - row lock contention",
    state: "WAITING",
    seconds_in_wait: 712,
    last_call_et: 1612
  }
];

const mockBlockingSessions = [
  {
    waiter_sid: 104,
    waiter_serial: 9152,
    waiter_user: "APPS",
    waiter_sql_id: "9x3t1m8ap6k2v",
    blocker_sid: 122,
    blocker_serial: 1190,
    blocker_user: "REPORTING",
    blocker_sql_id: "4a7md0hhv81kp",
    waiting_min: 11.9,
    event: "enq: TX - row lock contention"
  }
];

const mockLongQueries = [
  {
    sid: 122,
    "serial#": 1190,
    username: "REPORTING",
    machine: "bi-worker-01",
    running_seconds: 1612,
    sql_id: "4a7md0hhv81kp",
    sql_text: "select employee_id, sum(amount) from payroll_txn where period_id = :b1 group by employee_id"
  },
  {
    sid: 311,
    "serial#": 6321,
    username: "ETL",
    machine: "etl-batch-07",
    running_seconds: 842,
    sql_id: "br58qsqfgr2uu",
    sql_text: "merge into fact_sales f using stage_sales s on (f.txn_id = s.txn_id) when matched then update set f.amount = s.amount"
  }
];

const mockSchemas = ["APPS", "ETL", "REPORTING", "HR", "SALES"];

function tableOutput(title: string, rows: Array<Record<string, unknown>>) {
  return [title, JSON.stringify(rows, null, 2)].join("\n");
}

function rowCountLabel(count: number) {
  return `${count} row${count === 1 ? "" : "s"}`;
}

const findings: DbaFinding[] = [
  {
    title: "USERS tablespace above critical threshold",
    detail: "USERS is at 93% utilization and has only 7 GB free.",
    severity: "critical",
    metric: "pct_used",
    value: 93
  },
  {
    title: "Row lock contention detected",
    detail: "Session 122 has waited more than 11 minutes on TX row lock contention.",
    severity: "warning",
    object_name: "PAYROLL_TXN"
  }
];

const recommendations: DbaRecommendation[] = [
  {
    title: "Extend USERS by 20 GB",
    detail: "Growth trend indicates less than 18 hours before allocation failures at current ingest rate.",
    severity: "critical",
    action: "datafile_extend"
  },
  {
    title: "Review payroll close SQL plan",
    detail: "High buffer gets and row lock waits suggest missing selective access path or batch concurrency conflict.",
    severity: "warning",
    action: "top_sql"
  }
];

export function createApproval(action: DbaAction) {
  const steps: ApprovalStep[] = [
    { label: "Request submitted", status: "done", timestamp: new Date().toISOString() },
    { label: "Slack approval", status: "current" },
    { label: "n8n execution", status: "pending" },
    { label: "Audit log", status: "pending" }
  ];

  return {
    channel: "#oracle-dba-approvals",
    approver: "Lead DBA",
    status: "waiting" as const,
    steps,
    action
  };
}

const MOCK_DASHBOARD_METRICS = {
  db_health: {
    db_name: "ORCL",
    open_mode: "READ WRITE",
    listener_status: "READY",
    connection_test: "SUCCESS",
    instance_name: "orcl",
    host_name: "DBSERVER01",
    startup_time: new Date(now - 1000 * 60 * 60 * 120).toISOString(),
    uptime_hours: 120.5
  },
  os_resources: { cpu_usage_pct: 45.2, total_memory_gb: 64, free_memory_gb: 22.3 },
  sga_pga: { sga_target: "8G", sga_max_size: "10G", pga_aggregate_target: "4G", pga_aggregate_limit: "8G" },
  tablespaces: [
    { tablespace_name: "USERS",    total_mb: 92160,  used_mb: 87040,  free_mb: 5120,  pct_used: 94.4 },
    { tablespace_name: "SYSTEM",   total_mb: 10240,  used_mb: 8602,   free_mb: 1638,  pct_used: 84.0 },
    { tablespace_name: "SYSAUX",   total_mb: 8192,   used_mb: 5734,   free_mb: 2458,  pct_used: 69.9 },
    { tablespace_name: "TEMP",     total_mb: 65536,  used_mb: 42598,  free_mb: 22938, pct_used: 65.0 },
    { tablespace_name: "UNDO_TBS", total_mb: 40960,  used_mb: 18432,  free_mb: 22528, pct_used: 45.0 }
  ],
  rman_backups: [
    { start_time: "06-JUN-2026 02:00:01", end_time: "06-JUN-2026 04:24:33", input_type: "DB FULL",      status: "COMPLETED", duration_min: 144.5 },
    { start_time: "05-JUN-2026 22:00:00", end_time: "05-JUN-2026 22:18:12", input_type: "ARCHIVELOG",   status: "COMPLETED", duration_min: 18.2  },
    { start_time: "05-JUN-2026 02:00:00", end_time: "05-JUN-2026 02:52:11", input_type: "DB INCR LVL1", status: "COMPLETED", duration_min: 52.2  },
    { start_time: "04-JUN-2026 02:00:00", end_time: "04-JUN-2026 02:44:19", input_type: "DB INCR LVL1", status: "FAILED",    duration_min: 44.3  },
    { start_time: "03-JUN-2026 02:00:00", end_time: "03-JUN-2026 02:41:55", input_type: "DB INCR LVL1", status: "COMPLETED", duration_min: 41.9  }
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
    { username: "REPORTING", account_status: "OPEN", expiry_date: new Date(now + 1000 * 60 * 60 * 24 * 6).toISOString() },
    { username: "APPS_READ", account_status: "OPEN", expiry_date: new Date(now + 1000 * 60 * 60 * 24 * 13).toISOString() }
  ],
  failed_login_count: 4,
  fra: { name: "+FRA", fra_size_gb: 500, used_gb: 231.4, reclaimable_gb: 48.2, pct_used: 46.3 },
  ora_errors: [
    { originating_timestamp: new Date(now - 1000 * 60 * 8).toISOString(),   message_text: "ORA-01652: unable to extend temp segment by 128 in tablespace TEMP" },
    { originating_timestamp: new Date(now - 1000 * 60 * 34).toISOString(),  message_text: "ORA-04031: unable to allocate 65560 bytes of shared memory (\"shared pool\",\"unknown object\",\"sga heap(1,0)\",\"KGLS heap\")" },
    { originating_timestamp: new Date(now - 1000 * 60 * 112).toISOString(), message_text: "ORA-00054: resource busy and acquire with NOWAIT specified or timeout expired" }
  ],
  captured_at: new Date(now - 1000 * 60 * 3).toISOString()
};

export function createMockResponse(action: DbaAction, db: string, pendingApproval = false, params: Record<string, unknown> = {}): DbaResponse {
  const requestId = `DBA-${Math.floor(100000 + Math.random() * 899999)}`;
  const backupType = String(params.backup_type || "FULL");
  const backupTag = String(params.backup_tag || `ON_DEMAND_${backupType.replace(/\s+/g, "_")}`);
  const channelCount = Number(params.channel_count || 2);

  const base: DbaResponse = {
    status: pendingApproval ? "pending_approval" : "success",
    request_id: requestId,
    action,
    db_status: action === "health_report" || action === "tablespace_check" ? "warning" : "healthy",
    ai_summary:
      pendingApproval
        ? `${action} has been routed for approval before execution on ${db}.`
        : `${db} is operational with targeted warnings around storage growth, lock pressure, and backup recency.`,
    findings,
    recommendations,
    raw_data: {
      metrics: {
        active_sessions: 29,
        blocking_sessions: 2,
        failed_jobs: 1,
        invalid_objects: mockInvalidObjects.length,
        sga_used_pct: 72,
        pga_used_pct: 61,
        backup_success_pct: 94
      },
      trend: [
        { label: "00:00", cpu: 44, waits: 19, sessions: 22 },
        { label: "04:00", cpu: 51, waits: 24, sessions: 26 },
        { label: "08:00", cpu: 67, waits: 38, sessions: 39 },
        { label: "12:00", cpu: 62, waits: 42, sessions: 34 },
        { label: "16:00", cpu: 58, waits: 29, sessions: 31 },
        { label: "20:00", cpu: 49, waits: 21, sessions: 25 }
      ],
      tablespaces: mockTablespaces,
      sessions: mockSessions,
      sql: mockSql,
      backups: mockBackups,
      alerts: mockAlerts,
      invalid_objects: mockInvalidObjects,
      locks: [
        { blocker_sid: 122, waiter_sid: 104, object: "PAYROLL_TXN", wait_min: 12, mode: "TX-6" },
        { blocker_sid: 122, waiter_sid: 311, object: "PAYROLL_TXN", wait_min: 8, mode: "TX-6" }
      ],
      privileges: [
        { grantee: "REPORTING_DBA", privilege: "SELECT ANY DICTIONARY", risk: "warning" },
        { grantee: "LEGACY_SUPPORT", privilege: "DBA", risk: "critical" },
        { grantee: "ETL_ADMIN", privilege: "CREATE ANY TABLE", risk: "warning" }
      ]
    },
    raw_output: [
      "\u001b[32mConnected to Oracle Database 19c Enterprise Edition\u001b[0m",
      `Executing ${action} on ${db}`,
      "SQL> select status from v$instance;",
      "STATUS",
      "------------",
      "OPEN",
      `Request ${requestId} completed`
    ].join("\n")
  };

  if (pendingApproval) {
    base.approval = createApproval(action);
  }

  if (action === "take_rman_backup") {
    const backupId = `BKP-${new Date(now).toISOString().slice(0, 10).replace(/-/g, "")}-ONDEMAND`;
    const backupTarget =
      backupType === "ARCHIVELOG"
        ? "archivelog all"
        : backupType === "LEVEL 0"
          ? "incremental level 0 database"
          : backupType === "LEVEL 1"
            ? "incremental level 1 database"
            : "database";
    base.db_status = "healthy";
    base.ai_summary = `On-demand ${backupType} RMAN backup has been submitted for ${db} with tag ${backupTag}.`;
    base.findings = [
      {
        title: "RMAN backup submitted",
        detail: `${backupType} backup request is using ${channelCount} RMAN channel${channelCount === 1 ? "" : "s"}.`,
        severity: "healthy",
        object_name: db
      }
    ];
    base.recommendations = [
      {
        title: "Monitor backup completion",
        detail: "Review RMAN Backup Status after completion to confirm elapsed time, output size, and archive log coverage.",
        severity: "warning",
        action: "backup_status"
      }
    ];
    base.raw_data.backups = [
      {
        id: backupId,
        type: backupType,
        started_at: new Date().toISOString(),
        duration_min: 0,
        status: "RUNNING",
        compression_ratio: params.compressed === false ? 1 : 3,
        size_gb: 0
      },
      ...mockBackups
    ];
    base.raw_output = [
      "\u001b[32mRecovery Manager: Release 19.0.0.0.0 - Production\u001b[0m",
      `connected to target database: ${db}`,
      `allocated channel count: ${channelCount}`,
      `RMAN> backup ${params.compressed === false ? "" : "as compressed backupset "}${backupTarget} tag '${backupTag}';`,
      params.include_archivelog === false || backupType === "ARCHIVELOG" ? "" : "RMAN> backup archivelog all not backed up 1 times;",
      `Request ${requestId} accepted by n8n workflow`
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (action === "disk_utilization") {
    const rows = getMockFilesystemUsageForDb(db);
    const threshold = Number(params.threshold_pct || 90);
    const criticalRows = rows.filter((row) => row.pct_used >= threshold);
    const isWindows = rows.some((row) => row.type === "drive" || row.drive);
    const label = isWindows ? "drive" : "filesystem";

    base.db_status = criticalRows.length ? "critical" : "healthy";
    base.ai_summary = criticalRows.length
      ? `${criticalRows.length} ${label}${criticalRows.length === 1 ? "" : "s"} crossed ${threshold}% utilization on ${db}.`
      : `All ${label}s are below ${threshold}% utilization on ${db}.`;
    base.findings = criticalRows.map((row) => ({
      title: `${row.name} crossed utilization threshold`,
      detail: `${row.name} is ${row.pct_used.toFixed(1)}% used with ${row.free_gb.toFixed(1)} GB free.`,
      severity: "critical",
      object_name: row.name,
      metric: "pct_used",
      value: row.pct_used
    }));
    base.recommendations = criticalRows.map((row) => ({
      title: `Free space on ${row.name}`,
      detail: `Review growth, purge stale files, or extend capacity for ${row.name}.`,
      severity: "critical"
    }));
    base.raw_data.disk_utilization = rows;
    if (isWindows) {
      base.raw_data.drives = rows;
    } else {
      base.raw_data.filesystems = rows;
    }
    base.raw_output = [
      isWindows ? "Drive      SizeGB   UsedGB   FreeGB   Used%" : "Filesystem              SizeGB   UsedGB   FreeGB   Used%  Mounted on",
      ...rows.map((row) => {
        if (isWindows) {
          return `${row.name.padEnd(10)}${String(row.size_gb ?? "").padStart(7)}${row.used_gb.toFixed(1).padStart(9)}${row.free_gb.toFixed(1).padStart(9)}${row.pct_used.toFixed(1).padStart(8)}%`;
        }
        return `${(row.filesystem || row.name).padEnd(24)}${String(row.size_gb ?? "").padStart(7)}${row.used_gb.toFixed(1).padStart(9)}${row.free_gb.toFixed(1).padStart(9)}${row.pct_used.toFixed(1).padStart(8)}%  ${row.mount_point || row.name}`;
      }),
      `Threshold: ${threshold}%`
    ].join("\n");
  }

  if (action === "top_sql") {
    const orderBy = String(params.order_by || "elapsed_time");
    const rows = [...mockTopSql].sort((a, b) => Number(b[orderBy as keyof typeof b] || 0) - Number(a[orderBy as keyof typeof a] || 0));
    base.ai_summary = `Top SQL ranked by ${orderBy} for ${db}.`;
    base.raw_data.top_sql = rows;
    base.raw_data.sql = rows;
    base.raw_output = tableOutput("Top SQL", rows);
  }

  if (action === "check_performance") {
    base.db_status = "warning";
    base.ai_summary = [
      "## Executive Summary",
      `The ${db} database is showing **row lock contention**, heavy logical reads, and sustained user CPU pressure.`,
      "",
      "### Root Cause Analysis",
      "* **Application waits:** TX row lock contention is visible in wait events and blocker output.",
      "* **Top SQL pressure:** Payroll close and ETL SQL statements have the highest buffer gets.",
      "* **CPU usage:** User CPU is elevated but not the only bottleneck.",
      "",
      "| Metric | Value | Signal |",
      "| --- | ---: | --- |",
      "| Top SQL rows | 3 | Review SQL plans |",
      "| Wait events | 3 | Check contention |",
      "| Blocking sessions | 1 | Review transaction scope |",
      "",
      "### Actionable Remediation",
      "1. Review blocker SQL and application transaction scope.",
      "2. Tune SQL with the highest logical reads.",
      "3. Validate whether maintenance jobs overlap with business workload."
    ].join("\\n");
    base.findings = [
      {
        title: "Application waits dominate elapsed time",
        detail: "TX row lock contention is present in wait events and blocking-session output.",
        severity: "warning",
        metric: "wait_class",
        value: "Application"
      },
      {
        title: "Top SQL has high buffer gets",
        detail: "The payroll close and ETL SQL statements account for the highest logical read pressure.",
        severity: "warning",
        metric: "buffer_gets",
        value: 11923000
      }
    ];
    base.recommendations = [
      {
        title: "Review blocking transaction path",
        detail: "Start with blocker SQL and application transaction scope before tuning individual SQL plans.",
        severity: "warning",
        action: "lock_check"
      },
      {
        title: "Tune highest logical-read SQL",
        detail: "Check execution plans, join cardinality, bind selectivity, and supporting indexes for the top SQL rows.",
        severity: "warning",
        action: "top_sql"
      }
    ];
    base.raw_data.top_sql = mockTopSql;
    base.raw_data.sql = mockTopSql;
    base.raw_data.cpu_usage = mockCpuUsage;
    base.raw_data.wait_events = mockWaitEvents;
    base.raw_data.session_longops = mockSessionLongops;
    base.raw_data.SESSION_LONGOPS = mockSessionLongops;
    base.raw_data.invalid_obejcts = mockInvalidObjects;
    base.raw_data.invalid_objects = mockInvalidObjects;
    base.raw_data.session_list = mockSessionList;
    base.raw_data.sessions = mockSessionList;
    base.raw_data.lock_check = mockBlockingSessions;
    base.raw_data.locks = mockBlockingSessions;
    base.raw_data.long_queries = mockLongQueries;
    base.raw_data.performance_results = [
      { action: "top_sql", result: rowCountLabel(mockTopSql.length) },
      { action: "cpu_usage", result: rowCountLabel(mockCpuUsage.length) },
      { action: "wait_events", result: rowCountLabel(mockWaitEvents.length) },
      { action: "SESSION_LONGOPS", result: rowCountLabel(mockSessionLongops.length) },
      { action: "invalid_obejcts", result: rowCountLabel(mockInvalidObjects.length) },
      { action: "session_list", result: rowCountLabel(mockSessionList.length) },
      { action: "lock_check", result: rowCountLabel(mockBlockingSessions.length) },
      { action: "long_queries", result: rowCountLabel(mockLongQueries.length) }
    ];
    base.raw_output = [
      "Performance bottleneck analysis",
      "",
      base.ai_summary,
      "",
      "Checks completed: top_sql, cpu_usage, wait_events, SESSION_LONGOPS, invalid_obejcts, session_list, lock_check, long_queries"
    ].join("\n");
  }

  if (action === "cpu_usage") {
    base.ai_summary = `CPU utilization snapshot returned for ${db}.`;
    base.raw_data.cpu_usage = mockCpuUsage;
    base.raw_output = tableOutput("CPU Usage", mockCpuUsage);
  }

  if (action === "wait_events") {
    base.ai_summary = `Non-idle wait events returned for ${db}.`;
    base.raw_data.wait_events = mockWaitEvents;
    base.raw_output = tableOutput("Wait Events", mockWaitEvents);
  }

  if (action === "SESSION_LONGOPS") {
    base.ai_summary = `Active long operations returned for ${db}.`;
    base.raw_data.session_longops = mockSessionLongops;
    base.raw_output = tableOutput("Session Long Operations", mockSessionLongops);
  }

  if (action === "session_list") {
    base.ai_summary = `Session list returned for ${db}.`;
    base.raw_data.session_list = mockSessionList;
    base.raw_data.sessions = mockSessionList;
    base.raw_output = tableOutput("Session List", mockSessionList);
  }

  if (action === "lock_check") {
    base.ai_summary = `Blocking session check returned for ${db}.`;
    base.raw_data.lock_check = mockBlockingSessions;
    base.raw_data.locks = mockBlockingSessions;
    base.raw_output = tableOutput("Blocking Sessions", mockBlockingSessions);
  }

  if (action === "invalid_obejcts" || action === "invalid_objects") {
    const rows = mockInvalidObjects.map((row) => ({
      owner: row.owner,
      object_type: row.object_type,
      object_name: row.object_name,
      status: row.status,
      last_modified: row.last_ddl_time
    }));
    base.ai_summary = `${rows.length} invalid objects returned for ${db}.`;
    base.raw_data.invalid_obejcts = rows;
    base.raw_data.invalid_objects = rows;
    base.raw_output = tableOutput("Invalid Objects", rows);
  }

  if (action === "long_queries") {
    const threshold = Number(params.last_call_et || 60);
    const rows = mockLongQueries.filter((row) => row.running_seconds > threshold);
    base.ai_summary = `${rows.length} queries have been running longer than ${threshold} seconds on ${db}.`;
    base.raw_data.long_queries = rows;
    base.raw_output = tableOutput("Long Running Queries", rows);
  }

  if (action === "schema_list") {
    const rows = mockSchemas.map((username) => ({ username }));
    base.ai_summary = `Loaded ${rows.length} schemas from ${db}.`;
    base.raw_data.schemas = mockSchemas;
    base.raw_data.rows = rows;
    base.raw_output = tableOutput("Schemas", rows);
  }

  if (action === "recompile_invalid") {
    const schemaName = String(params.schema_name || "UNKNOWN");
    base.ai_summary = `Invalid objects recompile submitted for schema ${schemaName}.`;
    base.raw_data.rows = [{ schema_name: schemaName, status: "SUCCESS", message: "DBMS_UTILITY.COMPILE_SCHEMA completed in mock mode." }];
    base.raw_output = `EXEC DBMS_UTILITY.COMPILE_SCHEMA(schema => '${schemaName}', compile_all => FALSE);\nCompilation completed.`;
  }

  if (action === "kill_session" && Object.keys(params).length === 0) {
    base.ai_summary = `Inactive session cleanup submitted for ${db}.`;
    base.raw_data.rows = [
      { sid: 208, serial: 7403, status: "KILLED" },
      { sid: 432, serial: 5299, status: "KILLED" }
    ];
    base.raw_output = "Killed Session SID=208 SERIAL#=7403\nKilled Session SID=432 SERIAL#=5299\nTotal killed: 2";
  }

  if (action === "refresh_dashboard") {
    const m = { ...MOCK_DASHBOARD_METRICS, db_health: { ...MOCK_DASHBOARD_METRICS.db_health, db_name: db }, captured_at: new Date().toISOString() };
    const blocking = m.blocking_sessions?.length ?? 0;
    const fraUsed  = m.fra?.pct_used ?? 0;
    const tsMax    = Math.max(0, ...(m.tablespaces ?? []).map((t) => t.pct_used ?? 0));
    const dbStatus: DbaResponse["db_status"] = blocking > 0 || fraUsed > 85 || tsMax > 90 ? "critical" : (fraUsed > 70 || tsMax > 80 ? "warning" : "healthy");
    base.db_status = dbStatus;
    base.ai_summary = `Dashboard refreshed for ${db}: ${m.active_sessions} active sessions, ${blocking} blocker${blocking !== 1 ? "s" : ""}, FRA ${fraUsed}% used, largest tablespace ${tsMax}% full.`;
    Object.assign(base.raw_data, m);
    base.raw_output = `Dashboard snapshot captured at ${m.captured_at}`;
  }

  if (action === "analyze_alert_log") {
    base.db_status = "warning";
    base.ai_summary = [
      "## 🧠 AI Root Cause Analysis — Oracle Alert Log",
      "",
      "> **Database:** `" + db + "` &nbsp;|&nbsp; **Analysis Date:** " + new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
      "",
      "---",
      "",
      "## 📋 Executive Summary",
      "",
      "Analysis of the `" + db + "` alert log identified **2 critical issues** and **1 warning** requiring immediate attention. The primary driver is **shared pool memory exhaustion** (ORA-04031), which likely triggered the subsequent internal kernel error (ORA-00600). Redo log sizing is a secondary concern.",
      "",
      "| # | Issue | Severity | Impact |",
      "| --- | --- | --- | --- |",
      "| 1 | ORA-04031 — Shared Pool Exhaustion | 🔴 **Critical** | Parse failures, new connections rejected |",
      "| 2 | ORA-00600 — Internal Kernel Error | 🔴 **Critical** | Potential process crash / data risk |",
      "| 3 | Checkpoint Not Complete | 🟠 **Warning** | Increased DML latency, log switch storms |",
      "",
      "---",
      "",
      "## 🔴 Issue 1 — ORA-04031: Shared Pool Memory Exhaustion",
      "",
      "**Root Cause**",
      "The shared pool ran out of contiguous free memory. This is most commonly caused by:",
      "- Non-shared SQL statements (application using string literals instead of bind variables)",
      "- Very large PL/SQL packages or cursors that cannot be aged out",
      "- Undersized `SHARED_POOL_SIZE` relative to current workload",
      "",
      "**Impact**",
      "New SQL parse operations and connection requests will fail with ORA-04031 until free memory is reclaimed. In severe cases, the database may hang waiting for shared pool latches.",
      "",
      "**Recommended Actions**",
      "1. Immediate relief — flush the shared pool: `ALTER SYSTEM FLUSH SHARED_POOL;`",
      "2. Increase pool size: `ALTER SYSTEM SET SHARED_POOL_SIZE = 2G SCOPE=BOTH;`",
      "3. Audit top memory consumers: `SELECT * FROM V$SGASTAT WHERE pool = 'shared pool' ORDER BY bytes DESC FETCH FIRST 20 ROWS ONLY;`",
      "4. Enforce bind variables in the application — check `V$SQL` for `FORCE_MATCHING_SIGNATURE` clusters",
      "5. Consider enabling `CURSOR_SHARING = FORCE` as a short-term mitigation",
      "",
      "---",
      "",
      "## 🔴 Issue 2 — ORA-00600: Internal Kernel Error",
      "",
      "**Root Cause**",
      "An unexpected condition was hit inside Oracle kernel code. The error arguments (shown in the trace file) identify the specific code path and are required to find the relevant patch on My Oracle Support.",
      "",
      "**Impact**",
      "Depending on the error arguments, this can cause a foreground process abort, background process crash (e.g. PMON/SMON), or in rare cases data block corruption.",
      "",
      "**Recommended Actions**",
      "1. Locate the trace file: `SELECT value FROM V$DIAG_INFO WHERE name = 'Default Trace File';`",
      "2. Note the ORA-00600 argument vector (e.g. `[kghfrempty:ds]`, `[4194]`)",
      "3. Search My Oracle Support using the exact argument string",
      "4. Apply the recommended one-off patch or PSU if available",
      "5. Open an SR with Oracle Support if no known patch exists — attach the trace file",
      "",
      "---",
      "",
      "## 🟠 Issue 3 — Checkpoint Not Complete",
      "",
      "**Root Cause**",
      "The database had to wait before reusing a redo log group because DBWR had not yet flushed all dirty buffers associated with that group. This means redo log files are cycling faster than the checkpoint can keep up — typically caused by too few or too small redo log groups.",
      "",
      "**Current Redo Log Status (estimated)**",
      "",
      "| Group | Size | Status | Action |",
      "| --- | --- | --- | --- |",
      "| GROUP 1 | 200 MB | CURRENT | — |",
      "| GROUP 2 | 200 MB | INACTIVE | Too small |",
      "| GROUP 3 | 200 MB | INACTIVE | Too small |",
      "",
      "**Recommended Actions**",
      "1. Check current groups: `SELECT group#, status, bytes/1024/1024 mb FROM V$LOG;`",
      "2. Add larger redo log groups: `ALTER DATABASE ADD LOGFILE GROUP 4 ('/path/redo04a.log') SIZE 500M;`",
      "3. After adding new groups, drop the old undersized ones when they reach INACTIVE status",
      "4. Target 3–5 groups of at least 500 MB each for a busy OLTP workload",
      "",
      "---",
      "",
      "## 🔗 Correlation Analysis",
      "",
      "The three issues are likely related in sequence:",
      "",
      "```",
      "Shared pool pressure (ORA-04031)",
      "  → Memory latch contention under load",
      "    → Unexpected kernel condition triggered (ORA-00600)",
      "      → Concurrent high-DML workload cycling redo logs (Checkpoint Not Complete)",
      "```",
      "",
      "> 🔵 **Recommendation:** Resolve **ORA-04031 first** by increasing shared pool and flushing. Monitor for ORA-00600 recurrence after the memory pressure is removed — it may not reappear if it was memory-induced.",
      "",
      "---",
      "",
      "## ✅ Action Plan",
      "",
      "| Priority | Action | Effort | Risk |",
      "| --- | --- | --- | --- |",
      "| 🔴 P1 | `ALTER SYSTEM FLUSH SHARED_POOL` | Low | Low — temporary fix |",
      "| 🔴 P1 | Increase `SHARED_POOL_SIZE` to 2G+ | Low | Low — dynamic parameter |",
      "| 🔴 P1 | Pull ORA-00600 trace + open MOS SR | Medium | None |",
      "| 🟠 P2 | Add 2 × 500 MB redo log groups | Medium | Low — rolling change |",
      "| 🔵 P3 | Review application for literal SQL | High | None — code review |",
      "| 🔵 P3 | Run AWR report for the affected window | Low | None |"
    ].join("\n");
    base.raw_output = base.ai_summary;
    base.findings = [
      {
        title: "🔴 ORA-04031: Shared Pool Memory Exhaustion",
        detail: "Shared pool ran out of contiguous free memory. Caused by non-shared SQL, large packages, or undersized SGA.",
        severity: "critical",
        metric: "shared_pool_free_mb",
        value: "< 50 MB estimated"
      },
      {
        title: "🔴 ORA-00600: Internal Kernel Error",
        detail: "An unexpected internal condition was raised. Trace file investigation and MOS search required.",
        severity: "critical"
      },
      {
        title: "🟠 Checkpoint Not Complete",
        detail: "Redo log groups are too few or too small, causing log switch waits and DML latency.",
        severity: "warning",
        metric: "log_group_count",
        value: "3 groups × 200 MB (estimated)"
      }
    ];
    base.recommendations = [
      {
        title: "Flush shared pool and increase SHARED_POOL_SIZE",
        detail: "Run ALTER SYSTEM FLUSH SHARED_POOL, then increase SHARED_POOL_SIZE to at least 2 GB. Monitor V$SGASTAT after the change.",
        severity: "critical"
      },
      {
        title: "Investigate ORA-00600 trace file on MOS",
        detail: "Pull the ADR trace file, note the argument vector, search My Oracle Support, and open an SR if no patch is found.",
        severity: "critical"
      },
      {
        title: "Add redo log groups to eliminate checkpoint storms",
        detail: "Add at least 2 more redo log groups of 500 MB each. Drop old undersized groups once they reach INACTIVE status.",
        severity: "warning"
      }
    ];
  }

  if (action === "fetch_listener") {
    base.ai_summary = `listener.ora content fetched for ${db}.`;
    base.raw_data.file_name = "listener.ora";
    base.raw_data.file_path = "$ORACLE_HOME/network/admin/listener.ora";
    base.raw_output = [
      "# listener.ora Network Configuration File",
      "# Generated by Oracle configuration tools.",
      "",
      "LISTENER =",
      "  (DESCRIPTION_LIST =",
      "    (DESCRIPTION =",
      "      (ADDRESS = (PROTOCOL = TCP)(HOST = dbserver01.example.com)(PORT = 1521))",
      "    )",
      "  )",
      "",
      "SID_LIST_LISTENER =",
      "  (SID_LIST =",
      "    (SID_DESC =",
      "      (GLOBAL_DBNAME = " + db + ")",
      "      (ORACLE_HOME = /u01/app/oracle/product/19.0.0/dbhome_1)",
      "      (SID_NAME = " + db.toLowerCase() + ")",
      "    )",
      "  )"
    ].join("\n");
  }

  if (action === "fetch_tnsnames") {
    base.ai_summary = `tnsnames.ora content fetched for ${db}.`;
    base.raw_data.file_name = "tnsnames.ora";
    base.raw_data.file_path = "$ORACLE_HOME/network/admin/tnsnames.ora";
    base.raw_output = [
      "# tnsnames.ora Network Configuration File",
      "# Generated by Oracle configuration tools.",
      "",
      db + " =",
      "  (DESCRIPTION =",
      "    (ADDRESS = (PROTOCOL = TCP)(HOST = dbserver01.example.com)(PORT = 1521))",
      "    (CONNECT_DATA =",
      "      (SERVER = DEDICATED)",
      "      (SERVICE_NAME = " + db + ")",
      "    )",
      "  )"
    ].join("\n");
  }

  if (action === "stop_database") {
    const shutdownOption = String(params.shutdown_option || "IMMEDIATE");
    base.db_status = "unknown";
    base.ai_summary = `Database ${db} shutdown command triggered with mode ${shutdownOption}.`;
    base.findings = [
      {
        title: "Database Shutdown Initiated",
        detail: `The database instance shutdown command was executed with the ${shutdownOption} option.`,
        severity: "warning",
        object_name: db
      }
    ];
    base.recommendations = [
      {
        title: "Verify instance status",
        detail: "Run 'Check Status' or check OS processes to confirm that the instance is down.",
        severity: "healthy",
        action: "status_database"
      }
    ];
    base.raw_output = [
      "SQL*Plus: Release 19.0.0.0.0 - Production on Sat Jul 11 12:35:00 2026",
      "Version 19.3.0.0.0",
      "",
      "Copyright (c) 1982, 2019, Oracle.  All rights reserved.",
      "",
      "Connected to:",
      "Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Production",
      "Version 19.3.0.0.0",
      "",
      `SQL> SHUTDOWN ${shutdownOption};`,
      shutdownOption === "ABORT"
        ? "ORACLE instance shut down."
        : [
            "Database closed.",
            "Database dismounted.",
            "ORACLE instance shut down."
          ].join("\n"),
      `Request ${requestId} completed successfully.`
    ].join("\n");
  }

  return base;
}
