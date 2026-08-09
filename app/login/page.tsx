"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, DatabaseZap, Eye, EyeOff, LockKeyhole, Mail, Server, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/components/providers/theme-provider";
import { fetchCurrentSession, loginWithPassword } from "@/services/api";
import { useAppStore } from "@/store/use-app-store";

const FEATURES = [
  {
    icon: ShieldCheck,
    badgeColor: "bg-emerald-50 text-emerald-600 border-emerald-200/70",
    title: "Enterprise Grade Security",
    description: "Session-based authentication with account lockout protection and audit logs."
  },
  {
    icon: Server,
    badgeColor: "bg-cyan-50 text-cyan-600 border-cyan-200/70",
    title: "Database Operations",
    description: "Monitor health, backups, tablespaces, and alert logs from one unified panel."
  },
  {
    icon: Activity,
    badgeColor: "bg-rose-50 text-rose-600 border-rose-200/70",
    title: "Operational Visibility",
    description: "Track actions, shift handovers, approvals, and audit history across your estate."
  }
] as const;

function postLoginPath(role: string) {
  return role === "dba_admin" ? "/dba-console/shift-management" : "/dashboard";
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
    <main className="enterprise-grid relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6 lg:p-8 animate-grid-flow bg-slate-50/70">
      {/* Background Animated Glows & Radial Gradients */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(239,68,68,0.07),transparent_40%),radial-gradient(circle_at_85%_85%,rgba(14,116,144,0.06),transparent_40%),radial-gradient(circle_at_50%_50%,rgba(249,115,22,0.03),transparent_50%)]" />
      <motion.div
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-red-500/70 to-transparent"
        animate={{ opacity: [0.3, 0.8, 0.3] }}
        transition={{ duration: 3, repeat: Infinity }}
      />

      <div className="relative grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_420px] lg:items-center">
        {/* Left Side: Branding & Features */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="hidden lg:block"
        >
          <div className="mb-8 flex items-center gap-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 via-rose-600 to-orange-500 text-white shadow-lg shadow-red-500/30">
              <DatabaseZap className="h-8 w-8 drop-shadow-md" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="rounded-lg bg-red-100 px-3 py-1 text-sm font-bold uppercase tracking-widest text-red-700">
                  ITSS
                </span>
                <span className="text-xs font-semibold text-slate-500">v3</span>
              </div>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 lg:text-4xl">
                Database management portal
              </h1>
            </div>
          </div>

          <p className="max-w-2xl text-base lg:text-lg leading-relaxed text-slate-600 font-normal">
            AI-driven centralized Oracle database administration platform for real-time monitoring, automation, and seamless execution of end-to-end DBA operations.
          </p>

          <div className="mt-10 grid gap-4">
            {FEATURES.map(({ icon: Icon, badgeColor, title, description }, index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 + index * 0.08 }}
                className="group relative flex items-start gap-4 rounded-2xl bg-white/80 p-4 border border-slate-200/90 shadow-sm backdrop-blur-md transition-all duration-300 hover:bg-white hover:shadow-md hover:border-slate-300"
              >
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${badgeColor} transition-transform group-hover:scale-105`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Right Side: Login Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          className="relative"
        >
          {/* Subtle Ambient Glow under the Card */}
          <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-red-500/15 via-orange-500/10 to-cyan-500/15 blur-xl opacity-70" />

          <Card className="relative bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-2xl shadow-slate-300/40 rounded-3xl overflow-hidden">
            <CardContent className="p-6 sm:p-8">
              {/* Mobile Header */}
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 via-rose-600 to-orange-500 text-white shadow-md shadow-red-500/20">
                  <DatabaseZap className="h-6 w-6" />
                </div>
                <div>
                  <span className="rounded-md bg-red-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest text-red-700">
                    ITSS
                  </span>
                  <h2 className="mt-1 text-lg font-bold text-slate-900 leading-tight">Database management portal</h2>
                </div>
              </div>

              {/* Desktop Form Title Header */}
              <div className="mb-8 hidden items-center gap-3.5 lg:flex">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 border border-red-200/60 shadow-sm">
                  <LockKeyhole className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
                  <p className="text-sm text-slate-500 font-normal">Use your email address to access your console</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Email Field */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-semibold text-slate-700">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })}
                      placeholder="your.name@itc.in"
                      disabled={loading}
                      className="pl-10 h-11 bg-slate-50/60 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 rounded-xl transition-all"
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password" className="text-sm font-semibold text-slate-700">
                      Password
                    </Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs font-semibold text-red-600 hover:text-red-700 transition-colors hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      placeholder="Enter your password"
                      disabled={loading}
                      className="pl-10 pr-10 h-11 bg-slate-50/60 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 rounded-xl transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                      tabIndex={-1}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Checkbox */}
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500 accent-red-600 cursor-pointer"
                    disabled={loading}
                  />
                  Remember this device
                </label>

                {/* Submit Button */}
                <Button
                  className="w-full h-11 bg-gradient-to-r from-red-600 via-rose-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-xl shadow-lg shadow-red-600/25 hover:shadow-red-600/35 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
                  type="submit"
                  disabled={loading || !form.email || !form.password}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
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

              {/* Bottom Security Footer */}
              <div className="mt-8 flex items-center justify-center gap-2 text-xs font-medium text-slate-500 pt-4 border-t border-slate-100">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Secured with ITSS Enterprise Auth & End-to-End Encryption
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}

