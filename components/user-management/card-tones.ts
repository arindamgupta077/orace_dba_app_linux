/* Shared action-card tone styling (presentation only).
   Static tone -> class lookup. All class names are full literal strings
   so Tailwind JIT can detect them.

   Light/dark compatible: every tone pairs an AA-compliant shade for the
   light theme with the vivid shade used on the dark theme. */

export type CardTone =
  | "cyan"
  | "emerald"
  | "amber"
  | "violet"
  | "blue"
  | "teal"
  | "indigo"
  | "fuchsia"
  | "orange";

export interface ToneStyle {
  chip: string;
  hover: string;
  arrow: string;
}

export const TONE_STYLES: Record<CardTone, ToneStyle> = {
  cyan: {
    chip: "border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300",
    hover: "hover:border-cyan-400/40 hover:shadow-cyan-500/10",
    arrow: "text-cyan-600 dark:text-cyan-400"
  },
  emerald: {
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
    hover: "hover:border-emerald-400/40 hover:shadow-emerald-500/10",
    arrow: "text-emerald-600 dark:text-emerald-400"
  },
  amber: {
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-700 dark:text-amber-300",
    hover: "hover:border-amber-400/40 hover:shadow-amber-500/10",
    arrow: "text-amber-600 dark:text-amber-400"
  },
  violet: {
    chip: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300",
    hover: "hover:border-violet-400/40 hover:shadow-violet-500/10",
    arrow: "text-violet-600 dark:text-violet-400"
  },
  blue: {
    chip: "border-blue-400/30 bg-blue-400/10 text-blue-700 dark:text-blue-300",
    hover: "hover:border-blue-400/40 hover:shadow-blue-500/10",
    arrow: "text-blue-600 dark:text-blue-400"
  },
  teal: {
    chip: "border-teal-400/30 bg-teal-400/10 text-teal-700 dark:text-teal-300",
    hover: "hover:border-teal-400/40 hover:shadow-teal-500/10",
    arrow: "text-teal-700 dark:text-teal-400"
  },
  indigo: {
    chip: "border-indigo-400/30 bg-indigo-400/10 text-indigo-700 dark:text-indigo-300",
    hover: "hover:border-indigo-400/40 hover:shadow-indigo-500/10",
    arrow: "text-indigo-600 dark:text-indigo-400"
  },
  fuchsia: {
    chip: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-700 dark:text-fuchsia-300",
    hover: "hover:border-fuchsia-400/40 hover:shadow-fuchsia-500/10",
    arrow: "text-fuchsia-600 dark:text-fuchsia-400"
  },
  orange: {
    chip: "border-orange-400/30 bg-orange-400/10 text-orange-700 dark:text-orange-300",
    hover: "hover:border-orange-400/40 hover:shadow-orange-500/10",
    arrow: "text-orange-600 dark:text-orange-400"
  }
};
