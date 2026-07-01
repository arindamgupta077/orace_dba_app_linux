"use client";

import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/providers/error-boundary";
import { ThemeProvider, useTheme } from "@/components/providers/theme-provider";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      richColors
      closeButton
      position="top-right"
      theme={theme === "dark" ? "dark" : "light"}
      toastOptions={{ className: "app-toast glass-panel" }}
    />
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark">
      <ErrorBoundary>
        <TooltipProvider delayDuration={250}>
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
