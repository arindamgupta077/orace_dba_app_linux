// n8n Code node: build dashboard_history.metrics_payload after all refresh_dashboard branches are merged.
const items = $input.all().map((i) => i.json);

const read = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toInt = (value, fallback = 0) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanText = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value);
};

let startJson = {};
try {
  startJson = $("Start").first().json || {};
} catch (error) {
  startJson = {};
}

const startDbName = cleanText(read(startJson, "db", "db_name", "database", "database_name"), "UNKNOWN");
const startEnvironment = cleanText(read(startJson, "environment", "env", "env_label"), "PROD");
const startOs = cleanText(read(startJson, "os", "operating_system"), "Windows");
const startRequestedBy = cleanText(read(startJson, "requested_by", "username", "user"), "UNKNOWN");

let payload = {
  db_health: {
    db_name: startDbName,
    open_mode: "UNKNOWN",
    listener_status: "UNKNOWN",
    connection_test: "UNKNOWN",
    instance_name: "UNKNOWN",
    host_name: "UNKNOWN",
    startup_time: null,
    uptime_hours: 0
  },
  os_resources: {
    cpu_usage_pct: 0,
    total_memory_gb: 0,
    free_memory_gb: 0
  },
  sga_pga: {
    sga_target: "N/A",
    sga_max_size: "N/A",
    pga_aggregate_target: "N/A",
    pga_aggregate_limit: "N/A"
  },
  tablespaces: [],
  rman_backups: [],
  active_sessions: 0,
  inactive_sessions: 0,
  blocking_sessions: [],
  failed_jobs: 0,
  invalid_objects: 0,
  users_expiring_in_15_days: 0,
  archive_log_generation: [],
  tablespaces_over_90: 0,
  datapump_exports: [],
  password_expiring_users: [],
  failed_login_count: 0,
  fra: {},
  ora_errors: [],
  captured_at: new Date().toISOString()
};

for (const item of items) {
  const name = cleanText(read(item, "NAME", "name"));

  // DB health and listener.
  if (read(item, "OPEN_MODE", "open_mode") !== undefined) {
    payload.db_health.open_mode = cleanText(read(item, "OPEN_MODE", "open_mode"));
  }
  if (name && !["sga_target", "sga_max_size", "pga_aggregate_target", "pga_aggregate_limit"].includes(name)) {
    payload.db_health.db_name = name;
  }
  if (read(item, "listener_status") !== undefined) {
    payload.db_health.listener_status = cleanText(read(item, "listener_status"));
  }
  if (read(item, "remote_connection") !== undefined) {
    payload.db_health.connection_test = cleanText(read(item, "remote_connection"));
  }
  if (read(item, "INSTANCE_NAME", "instance_name") !== undefined) {
    payload.db_health.instance_name = cleanText(read(item, "INSTANCE_NAME", "instance_name"));
  }
  if (read(item, "HOST_NAME", "host_name") !== undefined) {
    payload.db_health.host_name = cleanText(read(item, "HOST_NAME", "host_name"));
  }
  if (read(item, "STARTUP_TIME", "startup_time") !== undefined) {
    payload.db_health.startup_time = cleanText(read(item, "STARTUP_TIME", "startup_time"));
  }
  if (read(item, "UPTIME_HOURS", "uptime_hours") !== undefined) {
    payload.db_health.uptime_hours = toNumber(read(item, "UPTIME_HOURS", "uptime_hours"));
  }

  // Existing single-value metrics.
  if (read(item, "ACTIVE_SESSIONS", "active_sessions") !== undefined) {
    payload.active_sessions = toInt(read(item, "ACTIVE_SESSIONS", "active_sessions"));
  }
  if (read(item, "INACTIVE_SESSIONS", "inactive_sessions") !== undefined) {
    payload.inactive_sessions = toInt(read(item, "INACTIVE_SESSIONS", "inactive_sessions"));
  }
  if (read(item, "FAILED_JOBS_COUNT", "failed_jobs_count") !== undefined) {
    payload.failed_jobs = toInt(read(item, "FAILED_JOBS_COUNT", "failed_jobs_count"));
  }
  if (read(item, "INVALID_OBJECT_COUNT", "invalid_object_count") !== undefined) {
    payload.invalid_objects = toInt(read(item, "INVALID_OBJECT_COUNT", "invalid_object_count"));
  }

  // New single-value metrics.
  if (read(item, "USERS_EXPIRING_IN_15_DAYS", "users_expiring_in_15_days") !== undefined) {
    payload.users_expiring_in_15_days = toInt(read(item, "USERS_EXPIRING_IN_15_DAYS", "users_expiring_in_15_days"));
  }
  if (read(item, "TABLESPACES_OVER_90", "tablespaces_over_90") !== undefined) {
    payload.tablespaces_over_90 = toInt(read(item, "TABLESPACES_OVER_90", "tablespaces_over_90"));
  }
  if (read(item, "FAILED_LOGIN_COUNT", "failed_login_count") !== undefined) {
    payload.failed_login_count = toInt(read(item, "FAILED_LOGIN_COUNT", "failed_login_count"));
  }

  // Existing arrays.
  if (read(item, "TABLESPACE_NAME", "tablespace_name") !== undefined) payload.tablespaces.push(item);
  if (read(item, "INPUT_TYPE", "input_type") !== undefined) payload.rman_backups.push(item);
  if (read(item, "MESSAGE_TEXT", "message_text") !== undefined) payload.ora_errors.push(item);
  if (read(item, "WAITER_SID", "waiter_sid") !== undefined) payload.blocking_sessions.push(item);

  // New arrays.
  if (
    read(item, "MONTH", "month") !== undefined &&
    (read(item, "ARCHIVE_LOG_COUNT", "archive_log_count") !== undefined || read(item, "ARCHIVE_GB", "archive_gb") !== undefined)
  ) {
    payload.archive_log_generation.push({
      month: cleanText(read(item, "MONTH", "month")),
      archive_log_count: toInt(read(item, "ARCHIVE_LOG_COUNT", "archive_log_count")),
      archive_gb: toNumber(read(item, "ARCHIVE_GB", "archive_gb"))
    });
  }

  if (read(item, "OWNER_NAME", "owner_name") !== undefined && read(item, "JOB_NAME", "job_name") !== undefined) {
    payload.datapump_exports.push({
      owner_name: cleanText(read(item, "OWNER_NAME", "owner_name")),
      job_name: cleanText(read(item, "JOB_NAME", "job_name")),
      operation: cleanText(read(item, "OPERATION", "operation")),
      job_mode: cleanText(read(item, "JOB_MODE", "job_mode")),
      state: cleanText(read(item, "STATE", "state"))
    });
  }

  if (read(item, "USERNAME", "username") !== undefined && read(item, "EXPIRY_DATE", "expiry_date") !== undefined) {
    payload.password_expiring_users.push({
      username: cleanText(read(item, "USERNAME", "username")),
      account_status: cleanText(read(item, "ACCOUNT_STATUS", "account_status")),
      expiry_date: cleanText(read(item, "EXPIRY_DATE", "expiry_date"))
    });
  }

  // SGA / PGA.
  if (name === "sga_target") payload.sga_pga.sga_target = cleanText(read(item, "DISPLAY_VALUE", "VALUE", "display_value", "value"), "N/A");
  if (name === "sga_max_size") payload.sga_pga.sga_max_size = cleanText(read(item, "DISPLAY_VALUE", "VALUE", "display_value", "value"), "N/A");
  if (name === "pga_aggregate_target") payload.sga_pga.pga_aggregate_target = cleanText(read(item, "DISPLAY_VALUE", "VALUE", "display_value", "value"), "N/A");
  if (name === "pga_aggregate_limit") payload.sga_pga.pga_aggregate_limit = cleanText(read(item, "DISPLAY_VALUE", "VALUE", "display_value", "value"), "N/A");

  // FRA.
  if (read(item, "FRA_SIZE_GB", "fra_size_gb") !== undefined) {
    payload.fra = item;
  }

  // OS resources from SSH stdout.
  if (item.stdout !== undefined && item.stdout !== "") {
    const outText = String(item.stdout).trim();

    if (outText.includes("CookedValue")) {
      const match = outText.match(/[\d.]+/g);
      if (match && match.length > 0) {
        payload.os_resources.cpu_usage_pct = Number(Number(match[match.length - 1]).toFixed(2));
      }
    } else if (outText.includes("G") || outText.includes("M")) {
      // Keep your existing Linux free -h parsing here if this branch returns GB values.
    } else if (!Number.isNaN(parseFloat(outText))) {
      const parsedNumber = Number(parseFloat(outText).toFixed(2));
      payload.os_resources.memory_used_pct = parsedNumber;
    }
  }
}

if (payload.users_expiring_in_15_days === 0 && payload.password_expiring_users.length > 0) {
  payload.users_expiring_in_15_days = payload.password_expiring_users.length;
}

if (!payload.db_health.db_name || payload.db_health.db_name === "UNKNOWN") {
  payload.db_health.db_name = startDbName;
}

const blocking = payload.blocking_sessions.length;
const fraUsed = toNumber(read(payload.fra, "PCT_USED", "pct_used"));
const tsMax = payload.tablespaces.length > 0
  ? Math.max(...payload.tablespaces.map((t) => toNumber(read(t, "PCT_USED", "pct_used"))))
  : 0;

const dbStatus = (blocking > 0 || fraUsed > 85 || tsMax > 90 || payload.tablespaces_over_90 > 0)
  ? "critical"
  : (fraUsed > 70 || tsMax > 80 || payload.users_expiring_in_15_days > 0 || payload.failed_login_count > 0)
    ? "warning"
    : "healthy";

const metricsJson = JSON.stringify(payload);

return [{
  json: {
    status: "success",
    db_status: dbStatus,
    ai_summary: `Dashboard refreshed: ${payload.db_health.db_name} is ${dbStatus}. ${payload.active_sessions} active sessions, ${blocking} blockers, FRA ${fraUsed}% used, max tablespace ${tsMax}%, ${payload.users_expiring_in_15_days} users expiring, ${payload.failed_login_count} failed logins.`,
    raw_data: payload,
    metrics_payload_json: metricsJson,

    _db_name: payload.db_health.db_name,
    _environment: startEnvironment,
    _os: startOs,
    _refreshed_by: startRequestedBy,
    _metrics_json: metricsJson
  }
}];
