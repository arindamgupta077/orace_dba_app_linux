"use client";

import { Bell, BellRing, Check, ChevronRight, Database, FileClock, FileText, FileWarning, HardDrive, ShieldAlert, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn, formatAppDateTime } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { NotificationItem, NotificationItemType } from "@/types/dba";

function severityDotClass(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return "bg-red-500";
    case "error":
      return "bg-orange-500";
    case "warning":
      return "bg-yellow-500 dark:bg-yellow-400";
    default:
      return "bg-blue-500 dark:bg-blue-400";
  }
}

function severityBorderClass(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return "border-l-red-500";
    case "error":
      return "border-l-orange-500";
    case "warning":
      return "border-l-yellow-500 dark:border-l-yellow-400";
    default:
      return "border-l-blue-500 dark:border-l-blue-400";
  }
}

function severityTextClass(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "error":
      return "text-orange-600 dark:text-orange-400";
    case "warning":
      return "text-yellow-600 dark:text-yellow-400";
    default:
      return "text-blue-600 dark:text-blue-400";
  }
}

function typeLabel(type: NotificationItemType) {
  switch (type) {
    case "tablespace":
      return "Tablespace Capacity";
    case "filesystem_drive":
      return "Filesystem Drive";
    case "alert_log":
      return "Alert Log Warning";
    case "dba_shift":
      return "DBA Shift Event";
    case "approval_workflow":
      return "Approval Workflow";
    case "db_monitoring":
      return "Database Monitoring";
    default:
      return "Database Alert";
  }
}

function NotificationTypeIcon({ type }: { type: NotificationItemType }) {
  switch (type) {
    case "tablespace":
      return <Database className="h-3.5 w-3.5" />;
    case "filesystem_drive":
      return <HardDrive className="h-3.5 w-3.5" />;
    case "alert_log":
      return <FileWarning className="h-3.5 w-3.5" />;
    case "dba_shift":
      return <FileText className="h-3.5 w-3.5" />;
    case "approval_workflow":
      return <FileClock className="h-3.5 w-3.5" />;
    case "db_monitoring":
      return <ShieldAlert className="h-3.5 w-3.5" />;
    default:
      return <Bell className="h-3.5 w-3.5" />;
  }
}

function formatRelativeTime(isoString: string) {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}

export function DatabaseAlertsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "approval_workflow">("all");
  const containerRef = useRef<HTMLDivElement>(null);

  const user = useAppStore((s) => s.user);
  const rawNotifications = useAppStore((s) => s.notifications);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);
  const setSelectedDb = useAppStore((s) => s.setSelectedDb);

  const notifications = rawNotifications
    .filter((n) => {
      if (!n.title && !n.message) return false;
      if (n.type === "dba_shift") return false;
      if (user?.role !== "app_admin") {
        if (n.title === "Approval Required" || (n.type === "approval_workflow" && (n.targetRole === "app_admin" || (!n.title.includes("Approved") && !n.title.includes("Rejected") && !n.title.includes("Complete") && !n.title.includes("Failed"))))) {
          return false;
        }
      }
      if (n.targetRole && user?.role && n.targetRole !== user.role) return false;
      if (n.targetUserId !== undefined && user?.userId !== undefined && n.targetUserId !== user.userId) return false;
      if (n.targetUsername && user?.username && n.targetUsername.toLowerCase() !== user.username.toLowerCase()) return false;
      return true;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 30);

  const approvalWorkflowCount = notifications.filter((n) => n.type === "approval_workflow").length;

  const displayedNotifications =
    user?.role === "app_admin" && filterType === "approval_workflow"
      ? notifications.filter((n) => n.type === "approval_workflow")
      : notifications;

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasCritical = notifications.some((n) => !n.read && (n.severity === "critical" || n.severity === "error"));
  const hasAny = displayedNotifications.length > 0;

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [open]);

  const handleClick = (notification: NotificationItem) => {
    markNotificationRead(notification.id);
    if (notification.db) setSelectedDb(notification.db);
    setOpen(false);

    if (user?.role === "dba_admin" && (notification.type === "approval_workflow" || notification.targetPath?.includes("pending-approvals"))) {
      window.dispatchEvent(new CustomEvent("dba-open-workflow-modal"));
      return;
    }

    router.push(notification.targetPath);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Keyframe styles for gentle bell swing and ambient breathing glow */}
      <style jsx global>{`
        @keyframes bellSwingGraceful {
          0%, 100% { transform: rotate(0deg); }
          12% { transform: rotate(14deg); }
          24% { transform: rotate(-12deg); }
          36% { transform: rotate(8deg); }
          48% { transform: rotate(-5deg); }
          60% { transform: rotate(2deg); }
          72% { transform: rotate(0deg); }
        }
        @keyframes softGlowCyanBreathing {
          0%, 100% { box-shadow: 0 0 4px rgba(6, 182, 212, 0.15), 0 0 1px rgba(6, 182, 212, 0.3); }
          50% { box-shadow: 0 0 14px rgba(6, 182, 212, 0.45), 0 0 4px rgba(6, 182, 212, 0.6); }
        }
        @keyframes softGlowRedBreathing {
          0%, 100% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.25), 0 0 2px rgba(239, 68, 68, 0.4); }
          50% { box-shadow: 0 0 18px rgba(239, 68, 68, 0.6), 0 0 6px rgba(239, 68, 68, 0.8); }
        }
      `}</style>

      <button
        onClick={() => setOpen((prev) => !prev)}
        title={unreadCount > 0 ? `${unreadCount} unread database alert${unreadCount > 1 ? "s" : ""}` : "Database Alerts"}
        aria-label="Database Alerts"
        className={cn(
          "relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-all duration-300",
          open
            ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 ring-2 ring-cyan-500/20"
            : hasCritical
            ? "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400 [animation:softGlowRedBreathing_2.5s_infinite_ease-in-out]"
            : unreadCount > 0
            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 [animation:softGlowCyanBreathing_3s_infinite_ease-in-out]"
            : "border-border/70 bg-background/60 text-muted-foreground hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-400"
        )}
      >
        {/* Soft, calm radar beacon ring */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span
              className={cn("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", hasCritical ? "bg-red-500" : "bg-cyan-400")}
              style={{ animationDuration: "2.5s" }}
            />
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full shadow-sm", hasCritical ? "bg-red-500" : "bg-cyan-500")} />
          </span>
        )}

        <Database className={cn("h-4 w-4 shrink-0 transition-transform duration-200", unreadCount > 0 && "text-cyan-600 dark:text-cyan-400", hasCritical && "text-red-600 dark:text-red-400")} />
        
        {unreadCount > 0 ? (
          <BellRing
            className={cn(
              "h-3.5 w-3.5 shrink-0 [animation:bellSwingGraceful_3s_infinite_ease-in-out]",
              hasCritical ? "text-red-600 dark:text-red-400" : "text-cyan-600 dark:text-cyan-300"
            )}
          />
        ) : (
          <Bell className="h-3.5 w-3.5 shrink-0 opacity-80" />
        )}

        {unreadCount > 0 && (
          <span className={cn("flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none shadow-sm text-white", hasCritical ? "bg-red-600 dark:bg-red-500" : "bg-cyan-600 dark:bg-cyan-500 dark:text-slate-950")}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[480px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-500/30 bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5 animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 bg-cyan-500/10 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className={cn("flex h-6 w-6 items-center justify-center rounded-md border", hasCritical ? "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30" : "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30")}>
                <Database className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="text-sm font-semibold text-foreground">Database Alerts</span>
                <p className="text-[10px] text-muted-foreground">Tablespace, Filesystem & DB Monitoring</p>
              </div>
              {unreadCount > 0 && (
                <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border", hasCritical ? "bg-red-500/20 text-red-600 dark:text-red-300 border-red-500/30" : "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30")}>
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllNotificationsRead("db")}
                  className="flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-700 dark:text-cyan-300 transition-colors hover:bg-cyan-500/20"
                  title="Mark all database alerts as read"
                >
                  <Check className="h-3 w-3" />
                  All read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* APP_ADMIN Filter Bar */}
          {user?.role === "app_admin" && (
            <div className="flex items-center justify-between border-b border-border/60 bg-cyan-500/5 px-4 py-1.5 text-xs">
              <span className="text-[11px] font-medium text-muted-foreground">Filter View:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterType("all")}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors border",
                    filterType === "all"
                      ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-semibold shadow-xs"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  All Alerts ({notifications.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType("approval_workflow")}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors border",
                    filterType === "approval_workflow"
                      ? "border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold shadow-xs"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <FileClock className="h-3 w-3 text-amber-500" />
                  <span>Approval Workflow Only</span>
                  {approvalWorkflowCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                      {approvalWorkflowCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Body */}
          {!hasAny ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                <Database className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {filterType === "approval_workflow" ? "No approval workflow requests" : "No database alerts yet"}
              </p>
              <p className="text-xs text-muted-foreground max-w-[260px]">
                {filterType === "approval_workflow"
                  ? "Pending approval requests submitted by DBA admins will appear here."
                  : "Tablespace capacity, filesystem usage & database monitoring events will surface here."}
              </p>
              <Link
                href={filterType === "approval_workflow" ? "/admin-panel/pending-approvals" : "/notifications?category=db"}
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                <span>{filterType === "approval_workflow" ? "Open Pending Approvals" : "View Notification History"}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto overflow-x-hidden">
              <div className="divide-y divide-border/40">
                {displayedNotifications.slice(0, 30).map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={cn(
                      "group relative flex w-full items-start gap-3 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-cyan-500/10 cursor-pointer",
                      severityBorderClass(notif.severity),
                      !notif.read ? "bg-cyan-500/10" : "bg-transparent"
                    )}
                  >
                    {/* Type icon + severity dot */}
                    <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
                      <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-muted border border-border/50", severityTextClass(notif.severity))}>
                        <NotificationTypeIcon type={notif.type} />
                      </div>
                      <div className={cn("h-1.5 w-1.5 rounded-full", severityDotClass(notif.severity))} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className={cn("truncate text-xs font-semibold uppercase tracking-wider", severityTextClass(notif.severity))}>
                          {typeLabel(notif.type)}
                        </p>
                        
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {!notif.read && (
                            <>
                              <span className="h-2 w-2 rounded-full bg-cyan-600 dark:bg-cyan-400 shrink-0" />
                              <button
                                type="button"
                                onClick={() => markNotificationRead(notif.id)}
                                title="Mark as read"
                                className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 transition-all hover:bg-cyan-500/30 hover:border-cyan-500/60"
                              >
                                <Check className="h-3 w-3" />
                                <span>Mark read</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-sm font-medium text-foreground">{notif.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notif.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{formatRelativeTime(notif.timestamp)}</span>
                        {notif.db && (
                          <>
                            <span>·</span>
                            <span className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
                              {notif.db}
                            </span>
                          </>
                        )}
                      </div>
                      {notif.read && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                          <span>
                            Read by <strong className="font-semibold text-foreground">{notif.readBy || "system"}</strong>
                            {notif.readAt && <> at {formatAppDateTime(notif.readAt)}</>}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer with More Notifications Link */}
          <div className="border-t border-border/70 bg-cyan-500/5 px-4 py-2.5 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-medium">
              Showing latest {Math.min(notifications.length, 30)} database alert{notifications.length !== 1 ? "s" : ""}
            </span>
            <Link
              href="/notifications?category=db"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300 hover:text-cyan-800 dark:hover:text-cyan-200 transition-colors"
            >
              <span>More Notifications</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** 2. DBA Console Activities Bell Component (Icon Only) */
export function DbaConsoleBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const rawNotifications = useAppStore((s) => s.notifications);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);

  const notifications = rawNotifications
    .filter((n) => n.type === "dba_shift")
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 30);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasAny = notifications.length > 0;

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [open]);

  const handleClick = (notification: NotificationItem) => {
    markNotificationRead(notification.id);
    setOpen(false);
    if (notification.targetPath) {
      router.push(notification.targetPath);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title={unreadCount > 0 ? `${unreadCount} unread console activity${unreadCount > 1 ? "ies" : ""}` : "DBA Console Activities"}
        aria-label="DBA Console Activities"
        className={cn(
          "relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-all duration-200",
          open
            ? "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-2 ring-amber-500/20"
            : unreadCount > 0
            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/60 shadow-sm"
            : "border-border/70 bg-background/60 text-muted-foreground hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
        )}
      >
        <UserCheck className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <Bell className="h-3.5 w-3.5 shrink-0 opacity-80" />
        {unreadCount > 0 && (
          <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950 px-1 text-[10px] font-bold leading-none shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[480px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-amber-500/30 bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5 animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 bg-amber-500/10 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                <UserCheck className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="text-sm font-semibold text-foreground">DBA Console Activities</span>
                <p className="text-[10px] text-muted-foreground">Shift Login, Logout & Handover Events</p>
              </div>
              {unreadCount > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllNotificationsRead("console")}
                  className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-500/20"
                  title="Mark all console activities as read"
                >
                  <Check className="h-3 w-3" />
                  All read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          {!hasAny ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <UserCheck className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-foreground">No console activities yet</p>
              <p className="text-xs text-muted-foreground max-w-[260px]">
                Shift login, logout, handover submissions & acknowledgments will appear here.
              </p>
              <Link
                href="/notifications?category=console"
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
              >
                <span>View Activity History</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto overflow-x-hidden">
              <div className="divide-y divide-border/40">
                {notifications.slice(0, 30).map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={cn(
                      "group relative flex w-full items-start gap-3 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-amber-500/10 cursor-pointer",
                      severityBorderClass(notif.severity),
                      !notif.read ? "bg-amber-500/10" : "bg-transparent"
                    )}
                  >
                    {/* Type icon + severity dot */}
                    <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                        <UserCheck className="h-3.5 w-3.5" />
                      </div>
                      <div className={cn("h-1.5 w-1.5 rounded-full", severityDotClass(notif.severity))} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          DBA Console Activity
                        </p>
                        
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {!notif.read && (
                            <>
                              <span className="h-2 w-2 rounded-full bg-amber-600 dark:bg-amber-400 shrink-0" />
                              <button
                                type="button"
                                onClick={() => markNotificationRead(notif.id)}
                                title="Mark as read"
                                className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 transition-all hover:bg-amber-500/30 hover:border-amber-500/60"
                              >
                                <Check className="h-3 w-3" />
                                <span>Mark read</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-sm font-medium text-foreground">{notif.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notif.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{formatRelativeTime(notif.timestamp)}</span>
                        {notif.db && (
                          <>
                            <span>·</span>
                            <span className="truncate rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-800 dark:text-amber-300">
                              {notif.db}
                            </span>
                          </>
                        )}
                      </div>
                      {notif.read && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                          <span>
                            Read by <strong className="font-semibold text-foreground">{notif.readBy || "system"}</strong>
                            {notif.readAt && <> at {formatAppDateTime(notif.readAt)}</>}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer with More Notifications Link */}
          <div className="border-t border-border/70 bg-amber-500/5 px-4 py-2.5 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-medium">
              Showing latest {Math.min(notifications.length, 30)} console activit{notifications.length !== 1 ? "ies" : "y"}
            </span>
            <Link
              href="/notifications?category=console"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
            >
              <span>More Notifications</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Master component rendering both Database Alerts Bell & DBA Console Bell side-by-side */
export function NotificationBell() {
  return (
    <div className="flex items-center gap-2">
      <DatabaseAlertsBell />
      <DbaConsoleBell />
    </div>
  );
}
