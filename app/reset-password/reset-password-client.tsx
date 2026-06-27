"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/services/api";

function getPasswordError(password: string) {
  if (!password) return undefined;
  if (password.length < 12) return "Use at least 12 characters.";
  if (!/[a-z]/.test(password)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Add an uppercase letter.";
  if (!/\d/.test(password)) return "Add a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Add a special character.";
  return undefined;
}

export function ResetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  const passwordError = getPasswordError(password);
  const passwordsMatch = password && confirmPassword && password === confirmPassword;
  const canSubmit = Boolean(token && passwordsMatch && !passwordError && !loading);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      toast.error("Invalid reset link");
      return;
    }
    if (passwordError) {
      toast.error("Password is not strong enough", { description: passwordError });
      return;
    }
    if (!passwordsMatch) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const response = await resetPassword(token, password);
      if (!response.success) {
        toast.error("Reset failed", { description: response.message });
        return;
      }

      setCompleted(true);
      toast.success("Password reset successful");
      setTimeout(() => router.push("/login"), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reset password.";
      toast.error("Reset failed", { description: message });
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

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="relative w-full max-w-md"
      >
        <Card className="glass-panel border-border/60 shadow-neon">
          <CardContent className="p-6 sm:p-8">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                {completed ? <CheckCircle2 className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </div>
              <div>
                <h1 className="text-xl font-semibold">Create a new password</h1>
                <p className="text-sm text-muted-foreground">
                  {completed ? "Redirecting to sign in." : "Your reset link is valid for 15 minutes."}
                </p>
              </div>
            </div>

            {!token ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-4 text-sm leading-6 text-red-50">
                  This reset link is missing a token. Request a new password reset link.
                </div>
                <Button asChild className="w-full">
                  <Link href="/forgot-password">Request a new link</Link>
                </Button>
              </div>
            ) : completed ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-50">
                  Password reset successful. You can now login.
                </div>
                <Button asChild className="w-full">
                  <Link href="/login">
                    <ArrowLeft className="h-4 w-4" />
                    Back to sign in
                  </Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={loading}
                  />
                  {passwordError ? <p className="text-xs text-red-200">{passwordError}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={loading}
                  />
                  {confirmPassword && !passwordsMatch ? (
                    <p className="text-xs text-red-200">Passwords do not match.</p>
                  ) : null}
                </div>
                <Button className="w-full" type="submit" disabled={!canSubmit}>
                  {loading ? "Resetting..." : "Reset password"}
                </Button>
                <Button asChild variant="ghost" className="w-full">
                  <Link href="/login">
                    <ArrowLeft className="h-4 w-4" />
                    Back to sign in
                  </Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
}
