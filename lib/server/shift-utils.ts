export interface ShiftTiming {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface ShiftDefinition {
  number: 1 | 2 | 3 | 4;
  label: string;
  timing?: ShiftTiming;
}

export const SHIFT_DEFINITIONS: ShiftDefinition[] = [
  { number: 1, label: "Shift 1 (07:00 - 15:30)", timing: { startHour: 7, startMinute: 0, endHour: 15, endMinute: 30 } },
  { number: 2, label: "Shift 2 (14:30 - 23:00)", timing: { startHour: 14, startMinute: 30, endHour: 23, endMinute: 0 } },
  { number: 3, label: "Shift 3 (22:30 - 07:00)", timing: { startHour: 22, startMinute: 30, endHour: 7, endMinute: 0 } },
  { number: 4, label: "General Shift" }
];

export const GENERAL_SHIFT_NUMBER = 4;

export function isGeneralShift(shiftNumber: number): boolean {
  return shiftNumber === GENERAL_SHIFT_NUMBER;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function to12h(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  let h12 = hour % 12;
  if (h12 === 0) h12 = 12;
  return `${pad2(h12)}:${pad2(minute)} ${period}`;
}

export function getShiftLabel(shiftNumber: number): string {
  const def = SHIFT_DEFINITIONS.find((s) => s.number === shiftNumber);
  return def ? def.label : `Shift ${shiftNumber}`;
}

export function getShiftTimings(shiftNumber: number): { start: string; end: string } | null {
  const def = SHIFT_DEFINITIONS.find((s) => s.number === shiftNumber);
  if (!def || !def.timing) return null;
  return {
    start: to12h(def.timing.startHour, def.timing.startMinute),
    end: to12h(def.timing.endHour, def.timing.endMinute)
  };
}

/**
 * Converts a Date to IST (UTC+5:30) components.
 * Shift timings are defined in IST, so all window calculations must use IST
 * regardless of the server's local timezone (which may be UTC in Docker/cloud).
 */
function toIstParts(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  minuteOfDay: number;
} {
  // IST = UTC + 5h30m = +330 minutes
  const istMs = now.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    hour,
    minute,
    minuteOfDay: hour * 60 + minute
  };
}

/**
 * Returns the list of shift numbers that are active at the given moment (IST).
 * During overlap windows (14:30-15:30, 22:30-23:00) two shifts are active.
 *
 * Shift 1: 07:00 - 15:30  (minutes 420 - 930)
 * Shift 2: 14:30 - 23:00  (minutes 870 - 1380)
 * Shift 3: 22:30 - 07:00  (minutes >= 1350 or < 420, wraps midnight)
 */
export function getActiveShifts(now: Date = new Date()): number[] {
  const { minuteOfDay } = toIstParts(now);
  const active: number[] = [];

  if (minuteOfDay >= 420 && minuteOfDay < 930) active.push(1);
  if (minuteOfDay >= 870 && minuteOfDay < 1380) active.push(2);
  if (minuteOfDay >= 1350 || minuteOfDay < 420) active.push(3);

  return active;
}

/**
 * Returns the calendar date (at midnight IST) on which the currently-active
 * instance of the given shift started. Shift 3 spans midnight, so its
 * shift_date is the previous day when queried before 07:00 IST.
 */
export function getShiftStartDate(now: Date, shiftNumber: number): Date {
  const { minuteOfDay, year, month, day } = toIstParts(now);
  // Build a Date representing midnight IST on the shift's start calendar day.
  // Midnight IST = 18:30 UTC of the previous day.
  const startUtcMs = Date.UTC(year, month, day) - 330 * 60 * 1000;

  // Shift 3 spans midnight; before 07:00 IST it started the previous day.
  // General Shift (4) always starts "today" regardless of time.
  if (shiftNumber === 3 && minuteOfDay < 420) {
    return new Date(startUtcMs - 24 * 60 * 60 * 1000);
  }

  return new Date(startUtcMs);
}

/**
 * Returns a date string in YYYY-MM-DD format (IST calendar day) for Oracle DATE binding.
 */
export function toOracleDateString(date: Date): string {
  const { year, month, day } = toIstParts(date);
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * Human-readable summary of the current shift window for UI display.
 */
export function describeCurrentShift(now: Date = new Date()): {
  activeShifts: number[];
  label: string;
  overlap: boolean;
} {
  const activeShifts = getActiveShifts(now);
  const overlap = activeShifts.length > 1;
  const label = activeShifts.length
    ? activeShifts.map((n) => `Shift ${n}`).join(" + ")
    : "No active shift";
  return { activeShifts, label, overlap };
}

// ============================================================
// Selectable shifts — for the login dropdown with buffer time
// ============================================================

export interface SelectableShifts {
  /** All shift numbers: [1, 2, 3, 4] */
  allShifts: number[];
  /** Shifts the user can select (currently active or starting within buffer) */
  enabledShifts: number[];
  /** Shifts shown in dropdown but greyed out (too far away) */
  disabledShifts: number[];
  /** The auto-selected default shift based on time thresholds */
  preferredShift: number;
}

/** Buffer in minutes before a shift starts during which it becomes selectable. */
const SHIFT_BUFFER_MINUTES = 6 * 60; // 6 hours

/** Auto-select thresholds in minutes from midnight (IST). */
const AUTO_SELECT_THRESHOLDS: Array<{ shift: number; fromMinute: number }> = [
  { shift: 1, fromMinute: 6 * 60 },      // 06:00
  { shift: 2, fromMinute: 12 * 60 },     // 12:00
  { shift: 3, fromMinute: 21 * 60 }      // 21:00
];

/** Shift start times in minutes from midnight (IST). */
const SHIFT_START_MINUTES: Record<number, number> = {
  1: 7 * 60,       // 07:00
  2: 14 * 60 + 30, // 14:30
  3: 22 * 60 + 30  // 22:30
};

/**
 * Returns which shifts are enabled/disabled in the login dropdown and which
 * one should be auto-selected as the default.
 *
 * Rules:
 * - All 4 shifts always appear in the dropdown.
 * - A time-based shift (1,2,3) is enabled if it is currently active OR its
 *   next start is within SHIFT_BUFFER_MINUTES from now.
 * - General Shift (4) is always enabled.
 * - Once Shift 2 starts (14:30 IST), Shift 1 login is disabled for the day.
 * - Once Shift 3 starts (22:30 IST), Shift 2 login is disabled for the day.
 * - Auto-select: after 06:00 → Shift 1, after 12:00 → Shift 2, after 21:00 → Shift 3.
 * - If the preferred shift is disabled, fall back to General Shift.
 */
export function getSelectableShifts(now: Date = new Date()): SelectableShifts {
  const { minuteOfDay } = toIstParts(now);
  const activeShifts = getActiveShifts(now);

  const enabledShifts: number[] = [GENERAL_SHIFT_NUMBER];
  const disabledShifts: number[] = [];

  // Shift start minutes (IST) used for the "next shift started → disable previous" rule.
  const SHIFT2_START_MIN = 14 * 60 + 30; // 14:30
  const SHIFT3_START_MIN = 22 * 60 + 30; // 22:30

  for (const shiftNum of [1, 2, 3]) {
    // Once the next shift has started, login for this shift is locked for the day,
    // even if this shift's active window has not ended (overlap period).
    if (shiftNum === 1 && minuteOfDay >= SHIFT2_START_MIN) {
      disabledShifts.push(shiftNum);
      continue;
    }
    if (shiftNum === 2 && minuteOfDay >= SHIFT3_START_MIN) {
      disabledShifts.push(shiftNum);
      continue;
    }

    // Currently active → always enabled.
    if (activeShifts.includes(shiftNum)) {
      enabledShifts.push(shiftNum);
      continue;
    }

    // Not active — compute minutes until next start.
    const startMin = SHIFT_START_MINUTES[shiftNum];
    let minutesUntilStart: number;
    if (minuteOfDay < startMin) {
      minutesUntilStart = startMin - minuteOfDay;
    } else {
      // Already passed today's start; next start is tomorrow.
      minutesUntilStart = startMin + 1440 - minuteOfDay;
    }

    if (minutesUntilStart <= SHIFT_BUFFER_MINUTES) {
      enabledShifts.push(shiftNum);
    } else {
      disabledShifts.push(shiftNum);
    }
  }

  // Determine the preferred (auto-selected) shift.
  let preferredShift = GENERAL_SHIFT_NUMBER;
  // Evaluate thresholds in reverse order so the latest matching one wins.
  for (let i = AUTO_SELECT_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = AUTO_SELECT_THRESHOLDS[i];
    // Handle midnight wrap: Shift 3 threshold (21:00) also applies from 00:00 to 05:59.
    if (threshold.fromMinute <= minuteOfDay) {
      preferredShift = threshold.shift;
      break;
    }
  }
  // If no threshold matched (shouldn't happen since Shift 3 covers 00:00–05:59 via wrap),
  // but if minuteOfDay is between 00:00 and 05:59, Shift 3 is preferred.
  if (minuteOfDay < AUTO_SELECT_THRESHOLDS[0].fromMinute) {
    preferredShift = 3;
  }

  // If the preferred shift is disabled, fall back to General Shift.
  if (disabledShifts.includes(preferredShift)) {
    preferredShift = GENERAL_SHIFT_NUMBER;
  }

  return {
    allShifts: [1, 2, 3, GENERAL_SHIFT_NUMBER],
    enabledShifts: enabledShifts.sort((a, b) => a - b),
    disabledShifts: disabledShifts.sort((a, b) => a - b),
    preferredShift
  };
}

/**
 * Checks if a shift is currently selectable (enabled) for login.
 */
export function isShiftSelectable(shiftNumber: number, now: Date = new Date()): boolean {
  if (isGeneralShift(shiftNumber)) return true;
  const { enabledShifts } = getSelectableShifts(now);
  return enabledShifts.includes(shiftNumber);
}
