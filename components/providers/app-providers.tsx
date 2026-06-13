"use client";

import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/providers/error-boundary";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={250}>
        {children}
        <Toaster richColors closeButton position="top-right" toastOptions={{ className: "glass-panel" }} />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
