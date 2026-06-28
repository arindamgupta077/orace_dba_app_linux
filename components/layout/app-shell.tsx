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
  ShieldCheck,
  Settings2,
  TrendingUp,
  UserCog
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NotificationBell } from "@/components/layout/notification-bell";
import { DatabaseSelector } from "@/components/visual/database-selector";
import { fetchCurrentSession, fetchDatabases, logoutSession } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";
// Pages accessible by the "client" role (all others are restricted to dba_admin / app_admin)
const CLIENT_ALLOWED_PATHS = ["/dashboard", "/audit"];

const navItems: Array<{
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  clientAllowed?: boolean;
  adminOnly?: boolean;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, clientAllowed: true },
  { href: "/general-admin", label: "General Admin", icon: Settings2 },
  { href: "/tablespaces", label: "Tablespace", icon: Database },
  { href: "/user-management", label: "User Management", icon: UserCog },
  { href: "/backups", label: "RMAN Backup", icon: ArchiveRestore },
  { href: "/data-pump", label: "Data Pump", icon: DatabaseZap },
  { href: "/filesystem-drive", label: "Disk utilization", icon: HardDrive },
  { href: "/alerts", label: "Alert Log", icon: FileWarning },
  { href: "/performance-tuning", label: "Performance Tuning", icon: TrendingUp },
  { href: "/chat", label: "Chat with DB", icon: Bot },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAppStore((state) => state.user);
  const visibleNavItems = navItems.filter((item) => {
    if (user?.role === "client") return item.clientAllowed === true;
    if (item.adminOnly) return user?.role === "app_admin";
    return true;
  });

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
        {visibleNavItems.map((item) => {
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
  const pathname = usePathname();
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const setDatabases = useAppStore((state) => state.setDatabases);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [showDatabase, setShowDatabase] = useState(true);

  const isNonDbRoute = pathname.startsWith("/admin-panel") || pathname.startsWith("/db-inventory") || pathname.startsWith("/audit");
  const isClient = user?.role === "client";
  const isSidebarVisible = !!user && !isClient && showDatabase && !isNonDbRoute;
  const isDbSelectorVisible = !!user && showDatabase && !isNonDbRoute;
  const isDatabaseActive = !isNonDbRoute && showDatabase;

  const handleDatabaseToggle = () => {
    if (isNonDbRoute) {
      setShowDatabase(true);
      router.push("/dashboard");
    } else {
      setShowDatabase(!showDatabase);
    }
  };

  // Redirect "client" users away from pages they are not authorised to view.
  useEffect(() => {
    if (!user || user.role !== "client") return;
    const isAllowed = CLIENT_ALLOWED_PATHS.some((allowed) => pathname === allowed || pathname.startsWith(allowed + "/"));
    if (!isAllowed) {
      router.replace("/dashboard");
    }
  }, [user, pathname, router]);

  useEffect(() => {
    let active = true;
    fetchCurrentSession()
      .then((session) => {
        if (!active) return;
        setUser(session.user);
        fetchDatabases()
          .then((response) => {
            if (active) setDatabases(response.databases);
          })
          .catch(() => {
            if (active) setDatabases([]);
          });
        setAuthChecking(false);
      })
      .catch(() => {
        if (!active) return;
        setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, [setDatabases, setUser]);

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
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 border-r border-border/70 bg-background/80 backdrop-blur-xl transition-all duration-300 ease-in-out hidden lg:block",
        isSidebarVisible ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 pointer-events-none"
      )}>
        <SidebarContent />
      </aside>
      <div className={cn(
        "transition-all duration-300 ease-in-out",
        isSidebarVisible ? "lg:pl-72" : "lg:pl-0"
      )}>
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 lg:px-6">
            <div className="flex items-center gap-2">
              {isClient && (
                <Link href="/dashboard" className="group flex items-center gap-2.5 mr-4 shrink-0">
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 via-rose-600 to-orange-500 text-white shadow-[0_0_10px_rgba(225,29,72,0.3)] transition-all duration-300 group-hover:scale-105">
                    <DatabaseZap className="h-4.5 w-4.5 drop-shadow-sm" />
                  </div>
                  <div className="min-w-0">
                    <p className="bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-sm font-extrabold tracking-tight text-transparent">
                      ITSS DBA <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">PORTAL</span>
                    </p>
                  </div>
                </Link>
              )}
              {isSidebarVisible && (
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} title="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              {/* Database Toggle Button */}
              <Button
                variant={isDatabaseActive ? "secondary" : "outline"}
                size="sm"
                onClick={handleDatabaseToggle}
                className={cn(
                  "gap-1.5 transition-all",
                  isDatabaseActive && "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20"
                )}
              >
                <Database className="h-4 w-4" />
                <span className="hidden sm:inline">Database</span>
              </Button>

              {/* Admin-only buttons */}
              {user?.role === "app_admin" && (
                <>
                  <Button
                    asChild
                    variant={pathname.startsWith("/admin-panel") ? "secondary" : "outline"}
                    size="sm"
                    className={cn(
                      "transition-all",
                      pathname.startsWith("/admin-panel") && "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                    )}
                  >
                    <Link href="/admin-panel">
                      <ShieldCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">Admin Panel</span>
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant={pathname.startsWith("/db-inventory") ? "secondary" : "outline"}
                    size="sm"
                    className={cn(
                      "transition-all",
                      pathname.startsWith("/db-inventory") && "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                    )}
                  >
                    <Link href="/db-inventory">
                      <DatabaseZap className="h-4 w-4" />
                      <span className="hidden sm:inline">DB Inventory</span>
                    </Link>
                  </Button>
                </>
              )}

              {/* Audit Logs button */}
              <Button
                asChild
                variant={pathname.startsWith("/audit") ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  "transition-all",
                  pathname.startsWith("/audit") && "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                )}
              >
                <Link href="/audit">
                  <ClipboardList className="h-4 w-4" />
                  <span className="hidden sm:inline">Audit log</span>
                </Link>
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <RmanRunningBadge />
              {user && (
                <div className="hidden rounded-md border border-border/70 bg-background/40 px-3 py-2 text-sm text-muted-foreground md:block">
                  {user.username} / {user.role}
                </div>
              )}
              {!isClient && <NotificationBell />}
              <Button variant="ghost" size="icon" onClick={logout} title="Logout">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {isDbSelectorVisible && (
            <div className="px-4 py-3 lg:px-6 border-t border-border/70 bg-background/40 flex items-center gap-3">
              <DatabaseSelector />
            </div>
          )}
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
