/**
 * Webhook ingestion (ADR-0004): verify → persist (dedupe) → process via authoritative sync.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { webhookEvents } from "@/server/db/schema";
import { currentLogContext, logger, withLogContext } from "@/server/lib/logger";
import { getProvider, isKnownProvider } from "@/server/payments/registry";
import { syncByProviderPaymentId } from "./payments";

const MAX_ATTEMPTS = 8;

export type WebhookResult =
  | { status: 200; body: { received: true; duplicate?: boolean; processed?: boolean } }
  | { status: 400 | 401 | 404; body: { error: string } };

export async function receiveWebhook(providerId: string, req: { headers: Headers; rawBody: string; url: URL }): Promise<WebhookResult> {
  if (!isKnownProvider(providerId)) return { status: 404, body: { error: "unknown provider" } };
  const provider = getProvider(providerId);

  const verification = await provider.verifyWebhook(req);
  if (!verification.ok) {
    // No payload in logs: it is untrusted and may be crafted.
    logger.warn("webhook.rejected", { provider: providerId, reason: verification.reason });
    return { status: 401, body: { error: "invalid signature" } };
  }

  const [stored] = await getDb()
    .insert(webhookEvents)
    .values({
      provider: providerId,
      dedupeKey: verification.dedupeKey,
      eventType: verification.eventType,
      resourceType: verification.resourceType,
      resourceId: verification.resourceId,
      payload: verification.payload,
      requestId: (currentLogContext().request_id as string | undefined) ?? null,
    })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.dedupeKey] })
    .returning({ id: webhookEvents.id });

  if (!stored) {
    logger.info("webhook.duplicate", { provider: providerId, dedupe_key: verification.dedupeKey });
    return { status: 200, body: { received: true, duplicate: true } };
  }

  // Process inline for low latency; failures are retried by the retry-webhooks job.
  // We answer 200 either way once the event is durably stored.
  const processed = await processWebhookEvent(stored.id);
  return { status: 200, body: { received: true, processed } };
}

export async function processWebhookEvent(eventId: string): Promise<boolean> {
  const db = getDb();
  // Claim the event (RECEIVED/FAILED → PROCESSING) so concurrent workers don't double-process.
  const [event] = await db
    .update(webhookEvents)
    .set({ status: "PROCESSING", attempts: sql`${webhookEvents.attempts} + 1` })
    .where(and(eq(webhookEvents.id, eventId), sql`${webhookEvents.status} IN ('RECEIVED','FAILED')`))
    .returning();
  if (!event) return false;

  return withLogContext({ webhook_event_id: event.id, provider: event.provider }, async () => {
    try {
      if (event.resourceType !== "payment") {
        await db
          .update(webhookEvents)
          .set({ status: "IGNORED", processedAt: new Date(), lastError: `resource ${event.resourceType} not handled` })
          .where(eq(webhookEvents.id, event.id));
        return true;
      }
      const result = await syncByProviderPaymentId(event.provider, event.resourceId);
      if (!result.found) {
        // Possible race (webhook before our create response committed) or a payment not created by us.
        // Retry a few times; after that it stays FAILED and shows up in reconciliation.
        throw new Error(`payment ${event.resourceId} not found locally`);
      }
      await db
        .update(webhookEvents)
        .set({ status: "PROCESSED", processedAt: new Date(), lastError: null, nextAttemptAt: null })
        .where(eq(webhookEvents.id, event.id));
      return true;
    } catch (e) {
      const attempts = event.attempts;
      const backoffSeconds = Math.min(3600, 15 * 2 ** (attempts - 1));
      await db
        .update(webhookEvents)
        .set({
          status: "FAILED",
          lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
          nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + backoffSeconds * 1000),
        })
        .where(eq(webhookEvents.id, event.id));
      logger.error("webhook.processing_failed", { err: e, attempts });
      return false;
    }
  });
}

export async function retryFailedWebhooks(limit = 50) {
  const due = await getDb()
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.status, "FAILED"), lte(webhookEvents.nextAttemptAt, new Date())))
    .limit(limit);
  let ok = 0;
  for (const e of due) if (await processWebhookEvent(e.id)) ok++;
  return { attempted: due.length, processed: ok };
}
