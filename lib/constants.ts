export const APP_NAME = "Oracle DBA AI Control Center";

export const APP_LOCALE = "en-IN";
export const APP_TIMEZONE = "Asia/Kolkata"; // IST (UTC+5:30)

export const REQUESTED_BY_DEFAULT = "arindam";

export const STATUS_COLOR: Record<string, string> = {
  healthy: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  warning: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  critical: "text-red-300 border-red-400/30 bg-red-500/10",
  info: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
  unknown: "text-slate-300 border-slate-400/25 bg-slate-400/10",
  success: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  error: "text-red-300 border-red-400/30 bg-red-500/10",
  pending_approval: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
  approved: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  rejected: "text-red-300 border-red-400/30 bg-red-500/10",
  completed: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  failed: "text-red-300 border-red-400/30 bg-red-500/10",
  acknowledged: "text-slate-300 border-slate-400/25 bg-slate-400/10",
  open: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
  resolved: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10"
};
