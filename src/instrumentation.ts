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

/**
 * Called by Next.js for every uncaught server error (render, route handler, action).
 * Structured + redacted log line; this is the hook to forward to Sentry/OTel when adopted.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const { logger } = await import("@/server/lib/logger");
  const rid = request.headers["x-request-id"];
  logger.error("request.uncaught_error", {
    err,
    request_id: Array.isArray(rid) ? rid[0] : rid,
    method: request.method,
    route: context.routePath,
    route_type: context.routeType,
  });
}
