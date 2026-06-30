import type { DbaAction, DbaActionDefinition } from "@/types/dba";

export const DBA_ACTIONS: DbaActionDefinition[] = [
  {
    action: "refresh_dashboard",
    title: "Refresh Dashboard",
    description: "Execute the dashboard monitoring queries in parallel via n8n and save the snapshot to dashboard_history.",
    category: "dashboard",
    icon: "RefreshCw",
    params: []
  },
  {
    action: "tablespace_check",
    title: "Tablespace Check",
    description: "Inspect utilization, growth pressure, and autoextend risk.",
    category: "storage",
    icon: "Database",
    params: [
      { name: "threshold_pct", label: "Warning threshold", type: "number", defaultValue: 80 },
      { name: "critical_pct", label: "Critical threshold", type: "number", defaultValue: 90 }
    ]
  },
  {
    action: "create_tablespace",
    title: "Create Tablespace",
    description: "Create a new permanent tablespace with configurable size, autoextend, and maximum size limits.",
    category: "storage",
    icon: "FolderPlus",
    params: [
      { name: "tablespace_name", label: "Tablespace Name", type: "text", required: true, placeholder: "MY_DATA" },
      { name: "size", label: "Initial Size", type: "text", required: true, placeholder: "500M", defaultValue: "500M" },
      { name: "autoextend", label: "Autoextend", type: "select", options: ["ON", "OFF"], defaultValue: "OFF" },
      { name: "next", label: "Next Extent Size", type: "text", placeholder: "100M" },
      { name: "maxsize", label: "Max Size", type: "text", placeholder: "10G" }
    ]
  },
  {
    action: "session_list",
    title: "Session List",
    description: "List database sessions by status with wait event and SQL context.",
    category: "sessions",
    icon: "Users",
    params: [{ name: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE", "ALL"], defaultValue: "ACTIVE" }]
  },
  {
    action: "kill_session",
    title: "Kill Session",
    description: "Terminate a database session after approval.",
    category: "sessions",
    destructive: true,
    icon: "ShieldAlert",
    params: [
      { name: "sid", label: "SID", type: "number", required: true },
      { name: "serial", label: "Serial#", type: "number", required: true },
      { name: "reason", label: "Reason", type: "textarea", required: true, placeholder: "Blocking payroll close batch" }
    ]
  },
  {
    action: "long_queries",
    title: "Long Queries",
    description: "Find SQL running beyond operational thresholds.",
    category: "performance",
    icon: "Timer",
    params: [{ name: "last_call_et", label: "Running longer than seconds", type: "number", defaultValue: 60 }]
  },
  {
    action: "lock_check",
    title: "Lock Check",
    description: "Map blockers, waiters, lock types, and wait duration.",
    category: "locks",
    icon: "GitBranch",
    params: []
  },
  {
    action: "backup_status",
    title: "RMAN Backup Status",
    description: "Query V$RMAN_BACKUP_JOB_DETAILS for a date range — returns all backup jobs with status, duration, compression ratio and size.",
    category: "backup",
    icon: "ArchiveRestore",
    params: [
      { name: "date_from", label: "Date From (YYYY-MM-DD)", type: "text", required: true, placeholder: "2025-05-01" },
      { name: "date_to",   label: "Date To (YYYY-MM-DD)",   type: "text", required: true, placeholder: "2025-05-31" }
    ]
  },
  {
    action: "take_rman_backup",
    title: "Take RMAN Backup",
    description: "Trigger an on-demand RMAN backup. Dynamically builds and executes the RMAN script via n8n — includes maintenance, compression, parallelism, and controlfile options.",
    category: "backup",
    icon: "HardDrive",
    params: [
      { name: "backup_type",        label: "Backup Type",             type: "select",   options: ["FULL", "LEVEL 0", "LEVEL 1", "ARCHIVELOG"], defaultValue: "FULL" },
      { name: "include_archivelog", label: "Include Archivelog",       type: "checkbox", defaultValue: true },
      { name: "compressed",         label: "Use Compression",          type: "checkbox", defaultValue: true },
      { name: "channel_count",      label: "RMAN Channels",            type: "number",   defaultValue: 3 },
      { name: "Backup_for_standby", label: "Backup for Standby",       type: "checkbox", defaultValue: false },
      { name: "backup_tag",         label: "Backup Tag (optional)",    type: "text",     placeholder: "ON_DEMAND_FULL" }
    ]
  },
  {
    action: "alert_log",
    title: "Alert Log",
    description: "Stream alert log entries with severity and error filters.",
    category: "logs",
    icon: "FileWarning",
    params: [
      { name: "tail_lines", label: "Tail lines", type: "number", defaultValue: 300 },
      { name: "severity", label: "Severity", type: "select", options: ["ALL", "ERROR", "WARNING", "CRITICAL"], defaultValue: "ALL" }
    ]
  },
  {
    action: "check_alert_by_time",
    title: "Check Alert by Time Range",
    description: "Query v$diag_alert_ext for a specific time window via n8n.",
    category: "logs",
    icon: "Clock",
    params: [
      { name: "start_time", label: "Start Time", type: "text", required: true, placeholder: "2026-06-05 10:00:00 +05:30" },
      { name: "end_time",   label: "End Time",   type: "text", required: true, placeholder: "2026-06-05 12:00:00 +05:30" }
    ]
  },
  {
    action: "check_alert_by_lines",
    title: "Check Alert Last N Lines",
    description: "Fetch the last N lines of the Oracle alert log via PowerShell through n8n.",
    category: "logs",
    icon: "Terminal",
    params: [
      { name: "line_count", label: "Line count", type: "number", required: true, defaultValue: 100 }
    ]
  },
  {
    action: "analyze_alert_log",
    title: "Analyze Alert Log with AI",
    description: "Send captured alert log text to n8n for GenAI root cause analysis and get back structured insights.",
    category: "logs",
    icon: "BrainCircuit",
    params: [
      { name: "alert_log_text", label: "Alert Log Text", type: "textarea", required: true }
    ]
  },
  {
    action: "index_analysis",
    title: "Index Analysis",
    description: "Detect unusable, bloated, and missing index opportunities.",
    category: "performance",
    icon: "ScanSearch",
    params: [{ name: "schema", label: "Schema", type: "text", placeholder: "APPS" }]
  },
  {
    action: "stats_refresh",
    title: "Stats Refresh",
    description: "Refresh optimizer stats after approval.",
    category: "performance",
    destructive: true,
    icon: "RefreshCcw",
    params: [
      { name: "schema", label: "Schema", type: "text", required: true, placeholder: "APPS" },
      { name: "estimate_percent", label: "Estimate percent", type: "number", defaultValue: 20 },
      { name: "cascade", label: "Cascade indexes", type: "checkbox", defaultValue: true }
    ]
  },
  {
    action: "datafile_extend",
    title: "Datafile Extend",
    description:
      "AI-assisted datafile extension. Handled by the dedicated 4-step n8n workflow panel — not the generic action modal.",
    category: "storage",
    icon: "HardDriveDownload",
    params: []
  },
  {
    action: "disk_utilization",
    title: "Check Filesystem/Drive utilization status",
    description: "Run an OS-level filesystem or drive utilization check through n8n SSH automation.",
    category: "storage",
    icon: "HardDrive",
    params: [{ name: "threshold_pct", label: "Critical threshold", type: "number", defaultValue: 90 }]
  },
  {
    action: "health_report",
    title: "Health Report",
    description: "Run consolidated storage, session, backup, and performance checks.",
    category: "dashboard",
    icon: "HeartPulse",
    params: [{ name: "include_recommendations", label: "Include recommendations", type: "checkbox", defaultValue: true }]
  },
  {
    action: "check_performance",
    title: "Performance Run All",
    description: "Run all Performance Tuning checks and return AI bottleneck analysis.",
    category: "performance",
    icon: "BrainCircuit",
    params: []
  },
  {
    action: "top_sql",
    title: "Top SQL",
    description: "Rank SQL by elapsed time, CPU, disk reads, executions, or buffer gets.",
    category: "performance",
    icon: "Gauge",
    params: [
      {
        name: "order_by",
        label: "Ranking metric",
        type: "select",
        options: ["elapsed_time", "cpu_sec", "disk_reads", "executions", "buffer_gets"],
        defaultValue: "elapsed_time"
      }
    ]
  },
  {
    action: "invalid_objects",
    title: "Invalid Objects",
    description: "Find invalid PL/SQL, views, triggers, and dependent objects.",
    category: "objects",
    icon: "PackageX",
    params: [{ name: "owner", label: "Owner", type: "text", placeholder: "APPS" }]
  },
  {
    action: "invalid_obejcts",
    title: "Invalid Objects",
    description: "Find invalid database objects and review owner, type, status, and last change time.",
    category: "objects",
    icon: "PackageX",
    params: []
  },
  {
    action: "cpu_usage",
    title: "CPU Usage",
    description: "Show Oracle host CPU utilization from V$OSSTAT.",
    category: "performance",
    icon: "Cpu",
    params: []
  },
  {
    action: "wait_events",
    title: "Wait Events",
    description: "Analyze non-idle system wait events and wait classes.",
    category: "performance",
    icon: "Clock",
    params: []
  },
  {
    action: "SESSION_LONGOPS",
    title: "Session Long Operations",
    description: "Track active long operations with completion percentage and ETA.",
    category: "performance",
    icon: "Zap",
    params: []
  },
  {
    action: "schema_list",
    title: "Schema List",
    description: "Fetch database schemas for invalid object recompilation.",
    category: "objects",
    icon: "ListTree",
    params: []
  },
  {
    action: "recompile_invalid",
    title: "Recompile Invalid Objects",
    description: "Recompile invalid objects for a selected schema.",
    category: "objects",
    icon: "RefreshCcw",
    params: [{ name: "schema_name", label: "Schema name", type: "text", required: true }]
  },
  {
    action: "expdp",
    title: "Data Pump Export",
    description: "Export data using Oracle Data Pump (expdp).",
    category: "backup",
    icon: "DatabaseZap",
    params: []
  },
  {
    action: "impdp",
    title: "Data Pump Import",
    description: "Import data using Oracle Data Pump (impdp).",
    category: "backup",
    icon: "DatabaseZap",
    params: []
  },
  {
    action: "expdp_check_log",
    title: "Check EXPDP Log",
    description: "View the log output of the Data Pump Export job.",
    category: "logs",
    icon: "FileText",
    params: []
  },
  {
    action: "impdp_check_log",
    title: "Check IMPDP Log",
    description: "View the log output of the Data Pump Import job.",
    category: "logs",
    icon: "FileText",
    params: []
  },
  {
    action: "fetch_dump",
    title: "Fetch Dumpfile",
    description: "Fetch the latest Oracle Data Pump export file.",
    category: "backup",
    icon: "DatabaseZap",
    params: []
  },

  // ── User Management — Account ─────────────────────────────
  {
    action: "user_status",
    title: "Check Users Status",
    description: "Query DBA_USERS for account status, expiry date, and assigned profile.",
    category: "user_management",
    icon: "UserCheck",
    params: []
  },
  {
    action: "create_user",
    title: "Create User",
    description: "Create a new Oracle database user with tablespace, profile, and quota settings.",
    category: "user_management",
    icon: "UserPlus",
    params: []
  },
  {
    action: "unlock_user",
    title: "Unlock User",
    description: "Unlock a locked Oracle user account.",
    category: "user_management",
    icon: "LockOpen",
    params: []
  },
  {
    action: "reset_password",
    title: "Reset Password",
    description: "Reset the password for a selected Oracle database user.",
    category: "user_management",
    icon: "KeyRound",
    params: []
  },
  {
    action: "change_default_tbs",
    title: "Change Default Tablespace",
    description: "Reassign a user's default tablespace to a different one.",
    category: "user_management",
    icon: "Database",
    params: []
  },
  {
    action: "change_temp_tbs",
    title: "Change Temporary Tablespace",
    description: "Reassign a user's temporary tablespace.",
    category: "user_management",
    icon: "DatabaseZap",
    params: []
  },
  {
    action: "change_quota",
    title: "Change Quota",
    description: "Alter the storage quota for a user on a specified tablespace.",
    category: "user_management",
    icon: "HardDrive",
    params: []
  },
  {
    action: "assign_profile",
    title: "Assign Profile",
    description: "Assign an existing Oracle profile to a selected user.",
    category: "user_management",
    icon: "Fingerprint",
    params: []
  },
  {
    action: "rename_user",
    title: "Rename User",
    description: "Rename an Oracle database user using ALTER USER … RENAME TO.",
    category: "user_management",
    icon: "UserPen",
    params: []
  },
  {
    action: "drop_user",
    title: "Drop User",
    description: "Permanently drop an Oracle user and all owned objects (CASCADE).",
    category: "user_management",
    destructive: true,
    icon: "UserX",
    params: []
  },

  // ── User Management — Helper / Lookup ────────────────────
  {
    action: "list_tbs",
    title: "List Tablespaces",
    description: "Return all non-temporary tablespaces for dropdown population.",
    category: "user_management",
    icon: "Database",
    params: []
  },
  {
    action: "list_temp_tbs",
    title: "List Temp Tablespaces",
    description: "Return all temporary tablespaces for dropdown population.",
    category: "user_management",
    icon: "Database",
    params: []
  },
  {
    action: "list_profile",
    title: "List Profiles",
    description: "Return all DBA-defined Oracle profiles for dropdown population.",
    category: "user_management",
    icon: "Fingerprint",
    params: []
  },
  {
    action: "fetch_roles",
    title: "Fetch Roles",
    description: "Return all existing Oracle roles for dropdown population.",
    category: "user_management",
    icon: "ShieldCheck",
    params: []
  },
  {
    action: "list_objects",
    title: "List Objects",
    description: "Return all objects owned by a specific schema.",
    category: "user_management",
    icon: "ListTree",
    params: [{ name: "owner", label: "Owner", type: "text", required: true }]
  },

  // ── User Management — Profile ────────────────────────────
  {
    action: "view_profiles",
    title: "View All Profile Parameters",
    description: "Query DBA_PROFILES for all resource and password parameters.",
    category: "user_management",
    icon: "ClipboardList",
    params: []
  },
  {
    action: "create_profile",
    title: "Create Profile",
    description: "Create a new Oracle profile with custom resource and password limits.",
    category: "user_management",
    icon: "FilePlus",
    params: []
  },
  {
    action: "alter_profile",
    title: "Alter Profile",
    description: "Modify a resource or password parameter on an existing Oracle profile.",
    category: "user_management",
    icon: "FileEdit",
    params: []
  },
  {
    action: "drop_profile",
    title: "Drop Profile",
    description: "Permanently remove an Oracle profile from the database.",
    category: "user_management",
    destructive: true,
    icon: "FileX",
    params: []
  },

  // ── User Management — Privileges ────────────────────────
  {
    action: "system_privilege",
    title: "Grant / Revoke System Privilege",
    description: "Grant or revoke one or more Oracle system privileges to/from a user.",
    category: "user_management",
    icon: "ShieldAlert",
    params: []
  },
  {
    action: "object_privilege",
    title: "Grant / Revoke Object Privilege",
    description: "Grant or revoke object-level privileges (SELECT, INSERT, etc.) on a specific object.",
    category: "user_management",
    icon: "Shield",
    params: []
  },
  {
    action: "create_role",
    title: "Create Role",
    description: "Create a new Oracle role for grouping privileges.",
    category: "user_management",
    icon: "BadgePlus",
    params: []
  },
  {
    action: "role_to_user",
    title: "Grant / Revoke Role",
    description: "Grant or revoke an Oracle role to/from a database user.",
    category: "user_management",
    icon: "BadgeCheck",
    params: []
  },

  // ── General Administration — Database Control ─────────────
  {
    action: "status_database",
    title: "Check Database Status",
    description: "Query the database instance status via SSH (sqlplus / as sysdba).",
    category: "general_admin",
    icon: "Activity",
    params: []
  },
  {
    action: "start_database",
    title: "Start Database",
    description: "Start the Oracle database instance via SSH (STARTUP command).",
    category: "general_admin",
    icon: "Play",
    params: []
  },
  {
    action: "stop_database",
    title: "Stop Database",
    description: "Shutdown the Oracle database immediately via SSH (SHUTDOWN IMMEDIATE).",
    category: "general_admin",
    destructive: true,
    icon: "StopCircle",
    params: []
  },
  {
    action: "mount_database",
    title: "Mount Database",
    description: "Mount the Oracle database without opening it via SSH (STARTUP MOUNT).",
    category: "general_admin",
    icon: "HardDrive",
    params: []
  },

  // ── General Administration — Listener Control ─────────────
  {
    action: "check_listener",
    title: "Check Listener Status",
    description: "Check Oracle listener status via SSH (lsnrctl status).",
    category: "general_admin",
    icon: "Radio",
    params: []
  },
  {
    action: "start_listener",
    title: "Start Listener",
    description: "Start the Oracle listener via SSH (lsnrctl start).",
    category: "general_admin",
    icon: "PlayCircle",
    params: []
  },
  {
    action: "stop_listener",
    title: "Stop Listener",
    description: "Stop the Oracle listener via SSH (lsnrctl stop).",
    category: "general_admin",
    destructive: true,
    icon: "StopCircle",
    params: []
  },

  // ── General Administration — Query Panel ──────────────────
  {
    action: "query",
    title: "Execute Query",
    description: "Execute any SQL query via SSH (sqlplus / as sysdba) and return raw console output.",
    category: "general_admin",
    icon: "Terminal",
    params: [
      {
        name: "sql_query",
        label: "SQL Query",
        type: "textarea",
        required: true,
        placeholder: "SELECT SYSDATE FROM DUAL;"
      }
    ]
  }
];

export function getActionDefinition(action: DbaAction) {
  return DBA_ACTIONS.find((item) => item.action === action);
}

export function getActionsByCategory(category: DbaActionDefinition["category"]) {
  return DBA_ACTIONS.filter((item) => item.category === category);
}
