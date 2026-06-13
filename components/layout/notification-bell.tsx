"use client";

import { Bell, BellRing, Check, Database, FileWarning, HardDrive, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStream } from "@/hooks/use-notification-stream";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { NotificationItem, NotificationItemType } from "@/types/dba";

function severityDotClass(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return "bg-red-500";
    case "error":
      return "bg-orange-500";
    case "warning":
      return "bg-yellow-400";
    default:
      return "bg-blue-400";
  }
}

function severityBorderClass(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return "border-l-red-500";
    case "error":
      return "border-l-orange-500";
    case "warning":
      return "border-l-yellow-400";
    default:
      return "border-l-blue-400";
  }
}

function severityTextClass(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return "text-red-400";
    case "error":
      return "text-orange-400";
    case "warning":
      return "text-yellow-400";
    default:
      return "text-blue-400";
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
    default:
      return <Bell className="h-3.5 w-3.5" />;
  }
}

function typeLabel(type: NotificationItemType) {
  switch (type) {
    case "tablespace":
      return "Tablespace";
    case "filesystem_drive":
      return "Filesystem";
    case "alert_log":
      return "Alert Log";
    default:
      return "Alert";
  }
}

function formatRelativeTime(timestamp: string) {
  try {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

export function NotificationBell() {
  useNotificationStream();

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const notifications = useAppStore((s) => s.notifications);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);
  const clearNotifications = useAppStore((s) => s.clearNotifications);
  const setSelectedDb = useAppStore((s) => s.setSelectedDb);

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
    setSelectedDb(notification.db);
    setOpen(false);
    router.push(notification.targetPath);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((prev) => !prev)}
        title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "Notifications"}
        className="relative"
      >
        {unreadCount > 0 ? <BellRing className="h-4 w-4 text-yellow-400" /> : <Bell className="h-4 w-4" />}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border/70 bg-background shadow-xl ring-1 ring-black/10">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 bg-secondary/30 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllNotificationsRead}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Mark all as read"
                >
                  <Check className="h-3 w-3" />
                  All read
                </button>
              )}
              {hasAny && (
                <button
                  onClick={clearNotifications}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Clear all notifications"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          {!hasAny ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground/60">Alerts from n8n will appear here</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[420px]">
              <div className="divide-y divide-border/50">
                {notifications.map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={cn(
                      "flex w-full items-start gap-3 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-secondary/40",
                      severityBorderClass(notif.severity),
                      !notif.read ? "bg-secondary/20" : "bg-transparent"
                    )}
                  >
                    {/* Type icon + severity dot */}
                    <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
                      <div className={cn("flex h-6 w-6 items-center justify-center rounded-md bg-secondary/60", severityTextClass(notif.severity))}>
                        <NotificationTypeIcon type={notif.type} />
                      </div>
                      <div className={cn("h-1.5 w-1.5 rounded-full", severityDotClass(notif.severity))} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className={cn("truncate text-xs font-semibold", severityTextClass(notif.severity))}>
                          {typeLabel(notif.type)}
                        </p>
                        {!notif.read && (
                          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-sm font-medium text-foreground">{notif.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notif.message}</p>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        <span>{formatRelativeTime(notif.timestamp)}</span>
                        <span>·</span>
                        <span className="truncate font-mono">{notif.db}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Footer */}
          {hasAny && (
            <div className="border-t border-border/70 px-4 py-2 text-center">
              <p className="text-[10px] text-muted-foreground/50">
                Showing {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
