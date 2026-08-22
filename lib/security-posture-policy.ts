/** Age at which an active security-posture report must be refreshed, in minutes (default: 30 days). */
export const SECURITY_POSTURE_OUTDATED_AFTER_MINUTES = 30 * 24 * 60;

export const SECURITY_POSTURE_OUTDATED_AFTER_MS =
  SECURITY_POSTURE_OUTDATED_AFTER_MINUTES * 60 * 1000;

/** Number of successful overdue-report notifications sent for each document. */
export const SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS = 7;

/** Delay between successful overdue-report notifications for the same document (hours). */
export const SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS = 24;

/** How often the scheduler checks for reports due to send an overdue notification (minutes). */
export const SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES = 240;

export interface SecurityPosturePolicyConfig {
  /** Age in minutes at which an active security-posture report is considered outdated / overdue. */
  outdatedAfterMinutes: number;
  /** Maximum number of successful overdue-report notifications sent for each document. */
  outdatedWebhookMaxSends: number;
  /** Delay in hours between consecutive overdue-report notifications for the same document. */
  outdatedWebhookIntervalHours: number;
  /** How often the background scheduler checks for reports due to send an overdue notification (minutes). */
  outdatedWebhookCheckIntervalMinutes: number;
}

export const DEFAULT_SECURITY_POSTURE_POLICY: SecurityPosturePolicyConfig = {
  outdatedAfterMinutes: SECURITY_POSTURE_OUTDATED_AFTER_MINUTES,
  outdatedWebhookMaxSends: SECURITY_POSTURE_OUTDATED_WEBHOOK_MAX_SENDS,
  outdatedWebhookIntervalHours: SECURITY_POSTURE_OUTDATED_WEBHOOK_INTERVAL_HOURS,
  outdatedWebhookCheckIntervalMinutes: SECURITY_POSTURE_OUTDATED_WEBHOOK_CHECK_INTERVAL_MINUTES
};
