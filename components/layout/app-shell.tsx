"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArchiveRestore,
  Bot,
  ClipboardList,
  Database,
  DatabaseZap,
  FileWarning,
  HardDrive,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Settings2,
  TrendingUp,
  UserCog
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NotificationBell } from "@/components/layout/notification-bell";
import { DatabaseSelector } from "@/components/visual/database-selector";
import { StatusBadge } from "@/components/visual/status-badge";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchCurrentSession, isMockMode, logoutSession } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/general-admin", label: "General Admin", icon: Settings2 },
  { href: "/tablespaces", label: "Tablespace", icon: Database },
  { href: "/user-management", label: "User Management", icon: UserCog },
  { href: "/backups", label: "RMAN Backup", icon: ArchiveRestore },
  { href: "/data-pump", label: "Data Pump", icon: DatabaseZap },
  { href: "/filesystem-drive", label: "Disk utilization", icon: HardDrive },
  { href: "/alerts", label: "Alert Log", icon: FileWarning },
  { href: "/performance-tuning", label: "Performance Tuning", icon: TrendingUp },
  { href: "/chat", label: "Chat with DB", icon: Bot },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList }
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 p-5 bg-gradient-to-b from-background/50 to-transparent">
        <div className="group flex cursor-pointer items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 via-rose-600 to-orange-500 text-white shadow-[0_0_15px_rgba(225,29,72,0.4)] transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_25px_rgba(225,29,72,0.6)]">
            <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 mix-blend-overlay transition-opacity duration-300 group-hover:opacity-100" />
            <DatabaseZap className="relative h-[22px] w-[22px] drop-shadow-md transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[15deg]" />
          </div>
          <div className="min-w-0 flex-1 transition-transform duration-300 group-hover:translate-x-0.5">
            <p className="truncate bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-base font-extrabold tracking-tight text-transparent">
              ITSS DBA <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">PORTAL</span>
            </p>
            <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
              Operations Portal
            </p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                active && "bg-secondary text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function RmanRunningBadge() {
  const rmanJobs = useAppStore((s) => s.rmanJobs);
  const runningCount = rmanJobs.filter((j) => j.status === "running").length;
  if (runningCount === 0) return null;
  return (
    <Link
      href="/backups"
      className="hidden sm:flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
      title="RMAN backup running in background"
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      RMAN {runningCount > 1 ? `×${runningCount}` : "running"}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    let active = true;
    fetchCurrentSession()
      .then((session) => {
        if (!active) return;
        setUser(session.user);
        setAuthChecking(false);
      })
      .catch(() => {
        if (!active) return;
        setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, [setUser]);

  const logout = async () => {
    try {
      await logoutSession();
    } catch {
      // Ignore API logout errors and force local sign-out.
    }
    setUser(undefined);
    router.push("/login");
  };

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Validating session...
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-border/70 bg-background/80 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 lg:px-6">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} title="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
              <DatabaseSelector />
            </div>
            <div className="flex items-center gap-2">
              <RmanRunningBadge />
              <StatusBadge status={isOnline ? "healthy" : "critical"} className="hidden sm:inline-flex">
                {isOnline ? "Online" : "Offline"}
              </StatusBadge>
              <StatusBadge status={isMockMode() ? "warning" : "healthy"} className="hidden md:inline-flex">
                {isMockMode() ? "Mock API" : "n8n Live"}
              </StatusBadge>
              {user && (
                <div className="hidden rounded-md border border-border/70 bg-background/40 px-3 py-2 text-sm text-muted-foreground md:block">
                  {user.username} / {user.role}
                </div>
              )}
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={logout} title="Logout">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>
        <main className="px-4 py-5 lg:px-6">{children}</main>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="left-0 top-0 h-full w-80 max-w-[85vw] translate-x-0 translate-y-0 rounded-none p-0">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
