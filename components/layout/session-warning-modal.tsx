"use client";

import { AlertTriangle, Clock, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";

interface SessionWarningModalProps {
  open: boolean;
  secondsLeft: number;
  onContinue: () => void;
  onLogout: () => void;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Premium session timeout warning modal.
 *
 * Displays a countdown timer and gives the user the option to extend
 * their session (resets inactivity timer only) or log out immediately.
 */
export function SessionWarningModal({
  open,
  secondsLeft,
  onContinue,
  onLogout
}: SessionWarningModalProps) {
  const isUrgent = secondsLeft <= 60;

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-[420px] border-amber-500/30 bg-background/95 backdrop-blur-xl shadow-2xl"
        // Prevent closing by clicking overlay — user must explicitly choose.
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        // Hide the default close button
        hideCloseButton
      >
        {/* Accent hairline */}
        <div className="absolute inset-x-0 top-0 h-1 rounded-t-lg bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />

        <div className="flex flex-col items-center gap-4 pt-2 text-center">
          {/* Icon */}
          <div className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-500 ${
            isUrgent
              ? "bg-red-500/15 text-red-400 animate-pulse"
              : "bg-amber-500/15 text-amber-400"
          }`}>
            <AlertTriangle className="h-7 w-7" />
          </div>

          <DialogTitle className="text-xl font-bold tracking-tight">
            Session Expiring Soon
          </DialogTitle>

          <DialogDescription className="text-sm leading-relaxed text-muted-foreground max-w-[320px]">
            Your session will expire due to inactivity. Click{" "}
            <span className="font-semibold text-foreground">Continue Session</span>{" "}
            to stay signed in.
          </DialogDescription>

          {/* Countdown */}
          <div className={`flex items-center justify-center gap-2.5 rounded-xl border px-5 py-3 font-mono text-2xl font-bold tabular-nums transition-colors duration-500 ${
            isUrgent
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}>
            <Clock className="h-5 w-5 opacity-70" />
            {formatCountdown(secondsLeft)}
          </div>

          <p className="text-xs text-muted-foreground/70 max-w-[300px]">
            Continuing will reset the inactivity timer but will not extend the maximum session duration.
          </p>

          {/* Actions */}
          <div className="flex w-full flex-col gap-2.5 pt-1">
            <Button
              onClick={onContinue}
              className="h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold shadow-lg shadow-emerald-600/20 hover:from-emerald-700 hover:to-teal-700 hover:shadow-xl hover:shadow-emerald-600/30 transition-all duration-200 active:scale-[0.99]"
            >
              <RefreshCw className="h-4 w-4" />
              Continue Session
            </Button>
            <Button
              variant="ghost"
              onClick={onLogout}
              className="h-10 w-full gap-2 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
            >
              <LogOut className="h-4 w-4" />
              Log Out Now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
