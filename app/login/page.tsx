"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, DatabaseZap, LockKeyhole, Mail, Server, ShieldCheck } from "lucide-react";
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
    title: "Secure access",
    description: "Session-based authentication with account lockout protection."
  },
  {
    icon: Server,
    title: "Database operations",
    description: "Monitor health, backups, tablespaces, and alert logs from one place."
  },
  {
    icon: Activity,
    title: "Operational visibility",
    description: "Track actions, approvals, and audit history across your estate."
  }
] as const;

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAppStore((state) => state.setUser);
  const { setTheme } = useTheme();
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  // Tracks whether the user has already submitted a successful login so that
  // the auto-session-check effect cannot race against the post-login redirect
  // and call clearAuthAndRedirect() (which would log them back out immediately).
  const loginSucceededRef = useRef(false);

  // Login page is ALWAYS dark — apply dark mode without persisting so
  // the user's saved preference (e.g. "light") survives in localStorage
  // and is restored by AppShell after they log in.
  useEffect(() => {
    setTheme("dark", { persistRemote: false, skipLocal: true });
  }, [setTheme]);

  useEffect(() => {
    const controller = new AbortController();

    fetchCurrentSession()
      .then((session) => {
        if (controller.signal.aborted || loginSucceededRef.current) return;
        setUser(session.user);
        router.replace("/dashboard");
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

      // Mark login as succeeded BEFORE navigating so that if the useEffect
      // above fires again on any re-render/remount it won't clear the session.
      loginSucceededRef.current = true;
      setUser(response.user);
      toast.success("Login successful");
      router.push("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed.";
      toast.error("Authentication failed", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="enterprise-grid relative flex min-h-screen items-center justify-center overflow-hidden p-4 animate-grid-flow">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,49,46,0.12),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(35,211,238,0.08),transparent_35%)]" />
      <motion.div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/70 to-transparent"
        animate={{ opacity: [0.2, 0.7, 0.2] }}
        transition={{ duration: 3, repeat: Infinity }}
      />

      <div className="relative grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_420px] lg:items-center">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="hidden lg:block"
        >
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 via-rose-600 to-orange-500 text-white shadow-[0_0_24px_rgba(225,29,72,0.35)]">
              <DatabaseZap className="h-7 w-7 drop-shadow-md" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-red-300/90">ITSS</p>
              <h1 className="text-3xl font-semibold leading-tight tracking-tight">
                Database management portal
              </h1>
            </div>
          </div>

          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            Centralized Oracle database administration for monitoring, maintenance, backups, and day-to-day DBA workflows.
          </p>

          <div className="mt-10 grid gap-4">
            {FEATURES.map(({ icon: Icon, title, description }, index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 + index * 0.08 }}
                className="glass-panel flex items-start gap-4 rounded-xl p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10">
                  <Icon className="h-5 w-5 text-cyan-300" />
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08, duration: 0.4 }}
        >
          <Card className="glass-panel border-border/60 shadow-neon">
            <CardContent className="p-6 sm:p-8">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-orange-500 text-white">
                  <DatabaseZap className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-red-300/90">ITSS</p>
                  <h2 className="text-lg font-semibold leading-tight">Database management portal</h2>
                </div>
              </div>

              <div className="mb-6 hidden items-center gap-3 lg:flex">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Sign in</h2>
                  <p className="text-sm text-muted-foreground">Use your email address to continue</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })}
                      placeholder="your.name@itc.in"
                      disabled={loading}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs font-medium text-cyan-200 transition-colors hover:text-cyan-100"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    placeholder="Enter your password"
                    disabled={loading}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 accent-red-500"
                    disabled={loading}
                  />
                  Remember this device
                </label>
                <Button className="w-full" type="submit" disabled={loading || !form.email || !form.password}>
                  {loading ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}
