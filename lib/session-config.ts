/**
 * Session timeout configuration — shared between client and server.
 *
 * These are **compile-time defaults**.  At runtime the server reads
 * environment variables and returns authoritative values via the
 * GET /api/auth/session response.  The client uses those server values
 * when available, falling back to the constants below.
 */

// ---------------------------------------------------------------------------
// Inactivity timeout (idle → auto-logout)
// ---------------------------------------------------------------------------
/** Default inactivity timeout in milliseconds (60 minutes). */
export const SESSION_INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Absolute session timeout (hard cap from login time)
// ---------------------------------------------------------------------------
/** Default absolute session lifetime in milliseconds (24 hours). */
export const SESSION_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Warning before inactivity logout
// ---------------------------------------------------------------------------
/** How many milliseconds before inactivity logout the warning appears (5 min). */
export const SESSION_WARNING_BEFORE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Touch throttle — minimum gap between /api/auth/session/touch calls
// ---------------------------------------------------------------------------
/** Minimum milliseconds between touch API calls (60 seconds). */
export const SESSION_TOUCH_THROTTLE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Activity detection throttle — DOM event listener debounce
// ---------------------------------------------------------------------------
/** Minimum milliseconds between processing DOM activity events (2 seconds). */
export const SESSION_ACTIVITY_THROTTLE_MS = 2 * 1000;

// ---------------------------------------------------------------------------
// BroadcastChannel name for cross-tab session synchronization
// ---------------------------------------------------------------------------
export const SESSION_BROADCAST_CHANNEL = "dba-session-sync";
