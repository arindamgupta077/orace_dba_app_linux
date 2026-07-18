/** Age at which an active security-posture report must be refreshed, in minutes. */
export const SECURITY_POSTURE_OUTDATED_AFTER_MINUTES = 30 * 24 * 60;

export const SECURITY_POSTURE_OUTDATED_AFTER_MS =
  SECURITY_POSTURE_OUTDATED_AFTER_MINUTES * 60 * 1000;

/** Number of successful overdue-report notifications sent for each document. */
export const SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS = 7;

/** Delay between successful overdue-report notifications for the same document. */
export const SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS = 24;

/** How often the scheduler checks for reports due to send an overdue notification. */
export const SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES = 240;
