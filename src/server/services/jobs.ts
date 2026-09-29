/**
 * Background jobs. In production they are triggered by an external scheduler hitting
 * POST /api/cron/<job> with the CRON_SECRET; in development `instrumentation.ts` runs them in-process.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { emailOutbox, orders, payments } from "@/server/db/schema";
import { purgeExpiredIdempotencyKeys } from "@/server/lib/idempotency";
import { logger } from "@/server/lib/logger";
import { purgeRateLimits } from "@/server/lib/rate-limit";
import { getProvider } from "@/server/payments/registry";
import { sendEmail } from "./email";
import { expireOrder } from "./orders";
import { syncPaymentFromProvider } from "./payments";
import { retryFailedWebhooks } from "./webhooks";

/** Expire unpaid orders past their reservation: sync with PSP, cancel stale Pix, release stock. */
export async function expireDueOrders(limit = 100) {
  const db = getDb();
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "AWAITING_PAYMENT"), lt(orders.expiresAt, new Date())))
    .limit(limit);

  let expired = 0;
  for (const { id } of due) {
    try {
      const pending = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, id), inArray(payments.status, ["PENDING", "PROCESSING", "AUTHORIZED"])));
      for (const p of pending) {
        if (!p.providerPaymentId) {
          // Never reached the PSP: nothing to cancel remotely.
          await db.update(payments).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(payments.id, p.id), eq(payments.status, "PENDING")));
          continue;
        }
        const outcome = await syncPaymentFromProvider(p.id); // maybe it was paid at the last second
        const status = outcome.changed ? outcome.to : outcome.status;
        if (status === "PENDING" && p.method === "PIX") {
          try {
            await getProvider(p.provider).cancelPayment(p.providerPaymentId, { idempotencyKey: `cancel_${p.id}` });
          } catch (e) {
            logger.warn("jobs.expire.cancel_failed", { payment_id: p.id, err: e });
          }
          await syncPaymentFromProvider(p.id);
        }
      }
      if (await expireOrder(id)) expired++;
    } catch (e) {
      logger.error("jobs.expire.order_failed", { order_id: id, err: e });
    }
  }
  return { candidates: due.length, expired };
}

/** Fallback for lost webhooks: re-read payments that are still open after a few minutes. */
export async function syncStalePayments(limit = 50) {
  const stale = await getDb()
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        inArray(payments.status, ["PENDING", "PROCESSING", "AUTHORIZED"]),
        sql`${payments.providerPaymentId} IS NOT NULL`,
        sql`COALESCE(${payments.lastSyncedAt}, ${payments.createdAt}) < now() - interval '2 minutes'`,
      ),
    )
    .limit(limit);
  let changed = 0;
  for (const { id } of stale) {
    try {
      const r = await syncPaymentFromProvider(id);
      if (r.changed) changed++;
    } catch (e) {
      logger.warn("jobs.sync.failed", { payment_id: id, err: e });
    }
  }
  return { checked: stale.length, changed };
}

export async function deliverEmails(limit = 20) {
  const db = getDb();
  const pending = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "PENDING"), lt(emailOutbox.attempts, 5)))
    .limit(limit);
  let sent = 0;
  for (const m of pending) {
    try {
      await sendEmail(m);
      await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date(), attempts: m.attempts + 1 }).where(eq(emailOutbox.id, m.id));
      sent++;
    } catch (e) {
      await db
        .update(emailOutbox)
        .set({ attempts: m.attempts + 1, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300), status: m.attempts + 1 >= 5 ? "FAILED" : "PENDING" })
        .where(eq(emailOutbox.id, m.id));
    }
  }
  return { pending: pending.length, sent };
}

export const JOBS = {
  "expire-orders": () => expireDueOrders(),
  "retry-webhooks": () => retryFailedWebhooks(),
  "sync-payments": () => syncStalePayments(),
  "deliver-emails": () => deliverEmails(),
  housekeeping: async () => ({
    idempotencyKeys: await purgeExpiredIdempotencyKeys(),
    rateLimits: await purgeRateLimits(),
  }),
} as const;
export type JobName = keyof typeof JOBS;

export async function runAllJobs() {
  const results: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(JOBS)) {
    try {
      results[name] = await fn();
    } catch (e) {
      logger.error("jobs.failed", { job: name, err: e });
      results[name] = { error: true };
    }
  }
  return results;
}
