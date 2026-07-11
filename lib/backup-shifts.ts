export type BackupResponsibleShift = 1 | 2 | 3;

const SHIFT_1_START_MIN = 7 * 60;
const SHIFT_1_END_MIN = 15 * 60 + 30;
const SHIFT_2_END_MIN = 23 * 60;

export function parseScheduledFinishMinutes(scheduledTime?: string | null): number | null {
  const match = scheduledTime?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
}

export function getBackupResponsibleShift(scheduledTime?: string | null): BackupResponsibleShift | null {
  const minuteOfDay = parseScheduledFinishMinutes(scheduledTime);
  if (minuteOfDay == null) return null;

  if (minuteOfDay >= SHIFT_1_START_MIN && minuteOfDay <= SHIFT_1_END_MIN) return 1;
  if (minuteOfDay > SHIFT_1_END_MIN && minuteOfDay <= SHIFT_2_END_MIN) return 2;
  return 3;
}
