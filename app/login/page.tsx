"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  DatabaseZap,
  Eye,
  EyeOff,
  Fingerprint,
  Gauge,
  History,
  KeyRound,
  Lock,
  LockKeyhole,
  Mail,
  ScrollText,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/components/providers/theme-provider";
import { fetchCurrentSession, loginWithPassword } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";

const CAPABILITIES = [
  {
    icon: ShieldCheck,
    badgeColor: "bg-emerald-50 text-emerald-600 border-emerald-200/70",
    title: "Enterprise-grade security",
    description: "Session-based auth, lockout protection and role-aware access control."
  },
  {
    icon: Gauge,
    badgeColor: "bg-cyan-50 text-cyan-600 border-cyan-200/70",
    title: "Real-time estate monitoring",
    description: "Health, backups, tablespaces, sessions and alert logs in one panel."
  },
  {
    icon: Sparkles,
    badgeColor: "bg-violet-50 text-violet-600 border-violet-200/70",
    title: "AI-assisted operations",
    description: "Intelligent diagnostics and automated remediation workflows."
  },
  {
    icon: ScrollText,
    badgeColor: "bg-amber-50 text-amber-600 border-amber-200/70",
    title: "Complete audit visibility",
    description: "Approvals, shift handovers and privileged actions, fully traced."
  }
] as const;

const TRUST_MARKERS = [
  { icon: Fingerprint, label: "Session-based auth" },
  { icon: Lock, label: "Encrypted in transit" },
  { icon: KeyRound, label: "Lockout protection" },
  { icon: History, label: "Full audit trail" }
] as const;

function postLoginPath(role: string) {
  return role === "dba_admin" ? "/dba-console/shift-management" : "/dashboard";
}

function SessionExpiryToast() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "session_expired") {
      toast.info("Session expired", {
        description: "Your session has expired. Please log in again.",
        duration: 8000
      });
    } else if (reason === "session_inactive") {
      toast.info("Logged out due to inactivity", {
        description: "You were logged out due to inactivity. Please log in again.",
        duration: 8000
      });
    }
    if (reason) {
      window.history.replaceState({}, "", "/login");
    }
  }, [searchParams]);

  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAppStore((state) => state.setUser);
  const { setTheme } = useTheme();
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const loginSucceededRef = useRef(false);

  // Login page ALWAYS stays in white mode theme (Light)
  useEffect(() => {
    setTheme("light", { persistRemote: false, skipLocal: true });
  }, [setTheme]);

  useEffect(() => {
    const controller = new AbortController();

    fetchCurrentSession()
      .then((session) => {
        if (controller.signal.aborted || loginSucceededRef.current) return;
        setUser(session.user);
        router.replace(postLoginPath(session.user.role));
      })
      .catch(() => {
        if (controller.signal.aborted || loginSucceededRef.current) return;
        setUser(undefined);
      });

    return () => {
      controller.abort();
    };
  // Run once on mount only to check for an existing valid session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await loginWithPassword(form.email, form.password, remember);
      if (response.requiresPasswordReset) {
        toast.info("Password reset required", { description: response.message });
        router.push(`/first-login-reset?email=${encodeURIComponent(response.email)}`);
        return;
      }

      loginSucceededRef.current = true;
      setUser(response.user);
      toast.success("Login successful");
      router.push(postLoginPath(response.user.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed.";
      toast.error("Authentication failed", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="enterprise-grid relative flex min-h-screen flex-col overflow-hidden bg-slate-50/70 animate-grid-flow">
      <Suspense fallback={null}>
        <SessionExpiryToast />
      </Suspense>
      {/* Background ambient glows */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(239,68,68,0.06),transparent_42%),radial-gradient(circle_at_88%_82%,rgba(14,116,144,0.05),transparent_42%),radial-gradient(circle_at_50%_120%,rgba(249,115,22,0.05),transparent_55%)]" />

      {/* Brand accent band */}
      <motion.div
        className="relative z-30 h-[3px] w-full shrink-0 bg-gradient-to-r from-red-600 via-rose-500 to-orange-500"
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Top chrome bar */}
      <header className="relative z-20 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-2.5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-red-600 via-rose-600 to-orange-500 text-white shadow-md shadow-red-500/25">
              <DatabaseZap className="h-5 w-5 drop-shadow-sm" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <p className="text-base font-extrabold tracking-wide text-slate-900">
                  ITSS DBA{" "}
                  <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                    PORTAL
                  </span>
                </p>
                <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-500 shadow-sm">
                  v3.6
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Database Management Portal
              </p>
            </div>
          </div>

          <span className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 sm:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            ITSS DBA Portal Online
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 items-center px-5 py-6 sm:px-8">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[1.02fr_460px] xl:gap-16">
          {/* Left: brand & capability narrative */}
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="hidden lg:block"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-red-200/70 bg-white px-3.5 py-1 text-xs font-semibold text-red-700 shadow-sm shadow-red-500/5">
              <Sparkles className="h-3.5 w-3.5" />
              AI-Powered Oracle DBA Operations
            </div>

            <h1 className="mt-4 max-w-xl text-balance text-[1.9rem] font-bold leading-[1.1] tracking-tight text-slate-900 xl:text-[2.3rem]">
              Next-Gen Control Center for your{" "}
              <span className="bg-gradient-to-r from-red-600 via-rose-600 to-orange-500 bg-clip-text text-transparent">
                Oracle Database Estate
              </span>
            </h1>

            <p className="mt-3 max-w-xl text-base leading-normal text-slate-600">
              AI-driven centralized Oracle database administration platform for real-time monitoring,
              automation, and seamless execution of end-to-end DBA operations.
            </p>

            <div className="mt-6 divide-y divide-slate-200/80 border-y border-slate-200/80">
              {CAPABILITIES.map(({ icon: Icon, badgeColor, title, description }, index) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + index * 0.08, duration: 0.4, ease: "easeOut" }}
                  className="group flex items-start gap-3.5 py-2.5"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${badgeColor} transition-transform duration-300 group-hover:scale-105`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-0.5 max-w-md text-sm leading-normal text-slate-500">
                      {description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2"
            >
              {TRUST_MARKERS.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"
                >
                  <Icon className="h-3.5 w-3.5 text-slate-400" />
                  {label}
                </span>
              ))}
            </motion.div>
          </motion.section>

          {/* Right: sign-in card */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.12, duration: 0.45, ease: "easeOut" }}
            className="relative mx-auto w-full max-w-md lg:max-w-none"
          >
            {/* Ambient glow behind the card */}
            <div
              aria-hidden="true"
              className="absolute -inset-2 rounded-[2rem] bg-gradient-to-r from-red-500/10 via-orange-400/5 to-cyan-500/10 opacity-80 blur-2xl"
            />

            <Card className="relative overflow-hidden rounded-3xl border-slate-200/80 shadow-2xl shadow-slate-400/20">
              {/* Card brand hairline */}
              <div className="h-1 w-full bg-gradient-to-r from-red-600 via-rose-500 to-orange-500" />

              <CardContent className="p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-200/60 bg-red-50 text-red-600 shadow-sm">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    <Lock className="h-3 w-3" />
                    Secure sign-in
                  </span>
                </div>

                <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
                  Sign in to the console
                </h2>
                <p className="mt-1 text-sm leading-normal text-slate-500">
                  Use your organizational credentials to continue.
                </p>

                <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
                  {/* Email Field */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="email"
                      className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500"
                    >
                      Email address
                    </Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={(event) => setForm({ ...form, email: event.target.value })}
                        placeholder="your.name@itc.in"
                        disabled={loading}
                        className="h-11 rounded-xl border-slate-300 bg-slate-50/70 pl-11 text-[15px] text-slate-900 transition-all placeholder:text-slate-400 hover:border-slate-400 focus-visible:border-red-500 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-red-500/15"
                      />
                    </div>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <Label
                        htmlFor="password"
                        className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500"
                      >
                        Password
                      </Label>
                      <Link
                        href="/forgot-password"
                        className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700 hover:underline"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                        placeholder="Enter your password"
                        disabled={loading}
                        className="h-11 rounded-xl border-slate-300 bg-slate-50/70 pl-11 pr-12 text-[15px] text-slate-900 transition-all placeholder:text-slate-400 hover:border-slate-400 focus-visible:border-red-500 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-red-500/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        tabIndex={-1}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Remember device */}
                  <label className="flex cursor-pointer select-none items-center gap-2.5 pt-0.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-red-600 accent-red-600 focus:ring-red-500"
                      disabled={loading}
                    />
                    Remember this device
                  </label>

                  {/* Submit */}
                  <Button
                    type="submit"
                    disabled={loading || !form.email || !form.password}
                    className="!mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-orange-600 text-[15px] font-semibold text-white shadow-lg shadow-red-600/25 transition-all duration-200 hover:from-red-700 hover:via-rose-700 hover:to-orange-700 hover:shadow-xl hover:shadow-red-600/30 active:scale-[0.99] disabled:opacity-60 disabled:shadow-none"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Signing in...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        Sign in
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </Button>
                </form>

                {/* Card security footer */}
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Secured with ITSS Enterprise Auth · End-to-end encrypted sessions
                  </p>
                </div>
              </CardContent>
            </Card>

            <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
              Access is restricted to authorized personnel. All sign-in activity is recorded.
            </p>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
