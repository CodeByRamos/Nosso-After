import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter backed by PostgreSQL, so limits hold across all app instances
 * without extra infrastructure. Swap for Redis if request volume demands it (same signature).
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const result = await getDb().execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count, window_start
  `);
  const row = result.rows[0];
  const count = Number(row?.count ?? 1);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.allowed) throw new AppError("RATE_LIMITED", "Muitas tentativas. Aguarde um pouco e tente novamente.");
}

export async function purgeRateLimits() {
  const res = await getDb().execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  return res.rowCount ?? 0;
}
