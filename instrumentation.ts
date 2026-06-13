/**
 * Next.js Server Instrumentation
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Runs once when the Next.js server process starts (both dev and production).
 * We use it to:
 *   1. Pre-warm the Oracle connection pool so the first user request never
 *      has to wait for the ~10 s TCP handshake + Oracle authentication.
 *   2. Start the dashboard refresh scheduler so scheduled auto-refresh jobs
 *      fire even when no browser session is active.
 */
export async function register() {
  // Only run in the Node.js runtime, not the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 1 – Oracle connection pool pre-warm
    try {
      const { preWarmPool } = await import("@/lib/server/oracle");
      await preWarmPool();
      console.log("[oracle] connection pool pre-warmed");
    } catch (err) {
      // Non-fatal: the pool will still be created on the first request.
      console.warn("[oracle] pool pre-warm failed at startup:", err instanceof Error ? err.message : err);
    }

    // 2 – Dashboard refresh scheduler
    try {
      const { startScheduler } = await import("@/lib/server/scheduler");
      await startScheduler();
    } catch (err) {
      // Non-fatal: scheduled refreshes won't run but the app still works.
      console.warn("[scheduler] Failed to start at startup:", err instanceof Error ? err.message : err);
    }
  }
}
