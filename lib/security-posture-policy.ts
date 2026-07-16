/** Age at which an active security-posture report must be refreshed. */
export const SECURITY_POSTURE_OUTDATED_AFTER_DAYS = 30;

export const SECURITY_POSTURE_OUTDATED_AFTER_MS =
  SECURITY_POSTURE_OUTDATED_AFTER_DAYS * 24 * 60 * 60 * 1000;
