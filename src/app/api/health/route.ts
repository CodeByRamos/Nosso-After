import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { env } from "@/server/lib/env";
import { route } from "@/server/lib/http";
import { getActiveProvider } from "@/server/payments/registry";

export const dynamic = "force-dynamic";

/** Liveness + readiness. Exposes no secrets and no PII. */
export const GET = route(async () => {
  const started = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch {
    database = "error";
  }
  let payments: { provider: string; environment: string } | { error: string };
  try {
    const p = getActiveProvider();
    payments = { provider: p.id, environment: p.environment };
  } catch {
    payments = { error: "misconfigured" };
  }
  const healthy = database === "ok" && !("error" in payments);
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      appEnv: env().APP_ENV,
      checks: { database, payments },
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
});
