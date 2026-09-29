/**
 * Runs once per server process. In development only, background jobs (order expiry, webhook
 * retries, payment sync, e-mail outbox) run in-process every 30s so the local flow is complete.
 * In staging/production an external scheduler calls /api/cron/<job> instead (see DEPLOYMENT.md).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/server/lib/env");
  env(); // fail fast on invalid configuration
  if (process.env.APP_ENV !== "development") return;
  const g = globalThis as unknown as { __naJobs?: NodeJS.Timeout };
  if (g.__naJobs) return;
  const { runAllJobs } = await import("@/server/services/jobs");
  const { logger } = await import("@/server/lib/logger");
  let running = false;
  g.__naJobs = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runAllJobs();
      logger.debug("dev.jobs", r);
    } finally {
      running = false;
    }
  }, 30_000);
}
