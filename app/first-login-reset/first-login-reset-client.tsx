"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/services/api";

export function FirstLoginResetClient() {
  const searchParams = useSearchParams();
  const initialEmail = useMemo(() => searchParams.get("email")?.trim().toLowerCase() || "", [searchParams]);
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await requestPasswordReset(email);
      setSubmitted(true);
      toast.success("Reset link requested", { description: response.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to request reset link.";
      toast.error("Request failed", { description: message });
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
                {submitted ? <MailCheck className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </div>
              <div>
                <h1 className="text-xl font-semibold">Password reset required</h1>
                <p className="text-sm text-muted-foreground">
                  {submitted ? "Check your email for the secure reset link." : "Create your own password before entering the portal."}
                </p>
              </div>
            </div>

            {submitted ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-50">
                  If the account exists and is active, a reset link has been sent. The link expires in 15 minutes.
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
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-50">
                  Your initial password can only be used to verify the account. Use the emailed reset link to choose a private password.
                </div>
                <div className="space-y-2">
                  <Label htmlFor="first-login-email">Email</Label>
                  <Input
                    id="first-login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <Button className="w-full" type="submit" disabled={loading || !email.trim()}>
                  {loading ? "Sending..." : "Send reset link"}
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
