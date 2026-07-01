"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, hydrated, toggleTheme } = useTheme();

  const isDark = theme === "dark";
  const label = !hydrated
    ? "Toggle theme"
    : isDark
      ? "Switch to light theme"
      : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-background/40 text-foreground/80 transition-colors hover:border-border hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {/* Sun shows in dark mode (click → go light); Moon shows in light mode */}
      <Sun className={cn("h-4 w-4 transition-all", isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0")} />
      <Moon className={cn("absolute h-4 w-4 transition-all", isDark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100")} />
    </button>
  );
}
