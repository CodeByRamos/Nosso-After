/**
 * Payment core (ADR-0004).
 *
 *  createPaymentForOrder  → registers a Payment, calls the PSP, stores the pending state.
 *  syncPaymentFromProvider → the ONLY path that applies PSP state (PAID, refunds, chargebacks…),
 *                            always from an authoritative provider.getPayment() read.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db/client";
import {
  customers,
  events,
  orderItems,
  orders,
  paymentAttempts,
  payments,
  providerTransactions,
  refunds,
} from "@/server/db/schema";
import { canTransition, type PaymentStatus } from "@/server/domain/payment-status";
import { audit } from "@/server/lib/audit";
import { env } from "@/server/lib/env";
import { AppError } from "@/server/lib/errors";
import { logger, withLogContext } from "@/server/lib/logger";
import { getActiveProvider, getProvider } from "@/server/payments/registry";
import {
  ProviderError,
  type PaymentProvider,
  type ProviderPaymentSnapshot,
} from "@/server/payments/provider";
import type { CreatePaymentInput } from "@/validators/checkout";
import { addOrderEvent } from "./order-events";
import { lockOrder, markOrderPaid } from "./orders";
import { invalidateOrderTickets } from "./tickets";

export type PaymentRow = typeof payments.$inferSelect;

async function recordAttempt(values: typeof paymentAttempts.$inferInsert) {
  try {
    await getDb().insert(paymentAttempts).values(values);
  } catch (err) {
    logger.error("payment_attempt.record_failed", { err });
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = performance.now();
  try {
    const value = await fn();
    return { value, ms: Math.round(performance.now() - start) };
  } catch (error) {
    return { error, ms: Math.round(performance.now() - start) };
  }
}

export function publicPaymentView(p: PaymentRow) {
  return {
    id: p.id,
    orderId: p.orderId,
    status: p.status,
    method: p.method,
    environment: p.environment,
    amount: p.amount,
    installments: p.installments,
    pixQrCode: p.pixQrCode,
    pixExpiresAt: p.pixExpiresAt?.toISOString() ?? null,
    cardLastFour: p.cardLastFour,
    failureMessage: p.failureMessage,
  };
}

/**
 * Starts (or resumes) the payment of an order.
 * - One live payment per order (partial unique index). A PIX request for an order that already has
 *   a pending Pix returns the same QR code instead of creating a second charge.
 * - The PSP idempotency key is derived from OUR payment id, so a retry after a timeout can never
 *   create a second charge at the PSP.
 */
export async function createPaymentForOrder(input: CreatePaymentInput, meta: { ip?: string | null } = {}) {
  const db = getDb();
  const provider = getActiveProvider();

  const order = await db.query.orders.findFirst({ where: eq(orders.id, input.orderId) });
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  return withLogContext({ order_id: order.id }, async () => {
    if (order.status !== "AWAITING_PAYMENT") throw new AppError("INVALID_STATE", "Este pedido não aguarda pagamento.");
    if (order.expiresAt.getTime() < Date.now() + 30_000) {
      throw new AppError("ORDER_EXPIRED", "A reserva expirou. Refaça o pedido.");
    }
    if (order.paymentMethod !== input.method) {
      throw new AppError("VALIDATION_ERROR", "Forma de pagamento diferente da escolhida no pedido.");
    }
    if (input.method === "PIX" && !provider.capabilities.pix) throw new AppError("NOT_SUPPORTED", "Pix indisponível.");
    if (input.method === "CREDIT_CARD" && !provider.capabilities.creditCard) {
      throw new AppError("NOT_SUPPORTED", "Cartão indisponível.");
    }

    // Reuse an in-flight payment (retry after timeout, double click, page reload).
    const [live] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), inArray(payments.status, ["PENDING", "PROCESSING", "AUTHORIZED", "PAID"])));
    let payment: PaymentRow;
    if (live) {
      if (live.providerPaymentId) {
        if (live.method === "PIX" || live.status !== "PENDING") return publicPaymentView(live);
      }
      if (live.provider !== provider.id) throw new AppError("CONFLICT", "Pagamento em andamento em outro provedor.");
      payment = live; // created locally but the PSP call never completed → resume with same key
    } else {
      try {
        const [created] = await db
          .insert(payments)
          .values({
            organizationId: order.organizationId,
            orderId: order.id,
            provider: provider.id,
            environment: provider.environment,
            method: input.method,
            amount: order.totalAmount,
            installments: input.method === "CREDIT_CARD" ? input.card.installments : 1,
          })
          .returning();
        payment = created!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe um pagamento em andamento para este pedido.");
        throw e;
      }
    }

    return withLogContext({ payment_id: payment.id }, () => callProviderCreate(provider, payment, order, input, meta));
  });
}

async function callProviderCreate(
  provider: PaymentProvider,
  payment: PaymentRow,
  order: typeof orders.$inferSelect,
  input: CreatePaymentInput,
  meta: { ip?: string | null },
) {
  const db = getDb();
  const [customer, event, items] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, order.customerId) }),
    db.query.events.findFirst({ where: eq(events.id, order.eventId) }),
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
  ]);
  if (!customer || !event) throw new AppError("INTERNAL", "Pedido inconsistente.");

  const idempotencyKey = `pay_${payment.id}`;
  const notificationUrl = env().APP_ENV === "development" ? undefined : `${env().APP_URL}/api/webhooks/${provider.id}`;
  const { value: snap, error, ms } = await timed(() =>
    provider.createPayment(
      {
        paymentId: payment.id,
        orderCode: order.code,
        method: input.method,
        amount: payment.amount,
        description: `${event.name} — pedido ${order.code}`,
        payer: {
          name: customer.name,
          email: customer.email,
          document: (input.method === "CREDIT_CARD" ? input.card.document : undefined) ?? customer.document,
          phone: customer.phone,
        },
        card:
          input.method === "CREDIT_CARD"
            ? {
                token: input.card.token,
                paymentMethodId: input.card.paymentMethodId,
                issuerId: input.card.issuerId ?? null,
                installments: input.card.installments,
              }
            : undefined,
        // The Pix must die with the reservation so a late payment is the exception, not the rule.
        expiresAt: input.method === "PIX" ? order.expiresAt : undefined,
        notificationUrl,
        items: items.map((i) => ({ id: i.ticketBatchId, title: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
        buyerIp: meta.ip ?? null,
      },
      { idempotencyKey },
    ),
  );

  if (error || !snap) {
    const pe = error instanceof ProviderError ? error : null;
    await recordAttempt({
      paymentId: payment.id,
      provider: provider.id,
      operation: "CREATE",
      outcome: "ERROR",
      idempotencyKey,
      errorCode: pe?.code ?? "UNKNOWN",
      errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      durationMs: ms,
    });
    logger.error("payment.create_failed", { err: error, retryable: pe?.retryable });
    if (pe && !pe.retryable) {
      const [failed] = await db
        .update(payments)
        .set({ status: "FAILED", failedAt: new Date(), failureCode: pe.code, failureMessage: "Pagamento não pôde ser criado.", updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "PENDING")))
        .returning();
      if (failed) return publicPaymentView(failed);
    }
    // Unknown outcome (timeout/5xx): keep PENDING without provider id; a retry reuses the same key.
    throw new AppError("PAYMENT_PROVIDER_ERROR", "Não foi possível falar com o processador de pagamentos. Tente novamente.");
  }

  await recordAttempt({
    paymentId: payment.id,
    provider: provider.id,
    operation: "CREATE",
    outcome: "SUCCESS",
    idempotencyKey,
    providerReference: snap.providerPaymentId,
    durationMs: ms,
  });

  // ADR-0004: the synchronous response never confirms a payment. PAID/AUTHORIZED are recorded as
  // PROCESSING until the authoritative read (webhook/job) confirms them. Declines are final.
  const initial: PaymentStatus =
    snap.status === "FAILED" ? "FAILED" : snap.status === "PENDING" ? "PENDING" : "PROCESSING";

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(payments)
      .set({
        providerPaymentId: snap.providerPaymentId,
        providerStatus: snap.rawStatus,
        providerStatusDetail: snap.rawStatusDetail ?? null,
        status: initial,
        pixQrCode: snap.pix?.qrCode ?? null,
        pixExpiresAt: snap.pix?.expiresAt ?? null,
        cardBrand: snap.card?.brand ?? null,
        cardLastFour: snap.card?.lastFour && /^\d{4}$/.test(snap.card.lastFour) ? snap.card.lastFour : null,
        installments: snap.installments ?? payment.installments,
        failedAt: initial === "FAILED" ? new Date() : null,
        failureCode: snap.failure?.code ?? null,
        failureMessage: snap.failure?.message ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();
    await upsertProviderTransaction(tx, provider.id, payment.id, snap);
    await addOrderEvent(tx, order.id, initial === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_PENDING", {
      paymentId: payment.id,
      method: input.method,
      providerStatus: snap.rawStatus,
    });
    await audit(tx, {
      action: "payment.create",
      entityType: "payment",
      entityId: payment.id,
      organizationId: order.organizationId,
      actorType: "CUSTOMER",
      amount: payment.amount,
      metadata: { provider: provider.id, environment: provider.environment, method: input.method, status: initial },
    });
    return row!;
  });
  logger.info("payment.created", { provider_transaction_id: snap.providerPaymentId, status: updated.status });
  return publicPaymentView(updated);
}

async function upsertProviderTransaction(tx: Tx, provider: string, paymentId: string, snap: ProviderPaymentSnapshot) {
  await tx
    .insert(providerTransactions)
    .values({
      provider,
      type: "PAYMENT",
      providerTransactionId: snap.providerPaymentId,
      paymentId,
      rawStatus: snap.rawStatus,
      amount: snap.amount,
      snapshot: snap.sanitized,
    })
    .onConflictDoUpdate({
      target: [providerTransactions.provider, providerTransactions.type, providerTransactions.providerTransactionId],
      set: { rawStatus: snap.rawStatus, amount: snap.amount, snapshot: snap.sanitized, fetchedAt: new Date() },
    });
}

export type SyncOutcome =
  | { changed: false; status: PaymentStatus }
  | { changed: true; from: PaymentStatus; to: PaymentStatus };

/** Syncs by PSP payment id (used by webhooks). Unknown ids are reported, not created. */
export async function syncByProviderPaymentId(providerId: string, providerPaymentId: string) {
  const payment = await getDb().query.payments.findFirst({
    where: and(eq(payments.provider, providerId), eq(payments.providerPaymentId, providerPaymentId)),
  });
  if (!payment) return { found: false as const };
  return { found: true as const, outcome: await syncPaymentFromProvider(payment.id) };
}

/**
 * Pulls the authoritative state from the PSP and applies it (idempotent; safe to call any time).
 * Network I/O happens BEFORE the DB transaction so no row locks are held while waiting on the PSP.
 */
export async function syncPaymentFromProvider(paymentId: string): Promise<SyncOutcome> {
  const db = getDb();
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");
  if (!payment.providerPaymentId) return { changed: false, status: payment.status };

  return withLogContext(
    { payment_id: payment.id, order_id: payment.orderId, provider_transaction_id: payment.providerPaymentId },
    async () => {
      const provider = getProvider(payment.provider);
      const { value: snap, error, ms } = await timed(() => provider.getPayment(payment.providerPaymentId!));
      await recordAttempt({
        paymentId: payment.id,
        provider: provider.id,
        operation: "GET",
        outcome: error ? "ERROR" : "SUCCESS",
        providerReference: payment.providerPaymentId,
        errorCode: error instanceof ProviderError ? error.code : error ? "UNKNOWN" : null,
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : null,
        durationMs: ms,
      });
      if (error || !snap) throw error ?? new Error("empty provider response");

      // Integrity checks: never accept a PSP object that doesn't match what we charged.
      const mismatch =
        snap.amount !== payment.amount
          ? `amount ${snap.amount} != ${payment.amount}`
          : snap.externalReference && snap.externalReference !== payment.id
            ? `external_reference ${snap.externalReference} != ${payment.id}`
            : null;
      if (mismatch) {
        logger.error("payment.integrity_mismatch", { mismatch });
        await db.transaction(async (tx) => {
          await tx
            .update(payments)
            .set({ failureCode: "INTEGRITY_MISMATCH", failureMessage: mismatch, lastSyncedAt: new Date(), updatedAt: new Date() })
            .where(eq(payments.id, payment.id));
          await audit(tx, {
            action: "manual.adjustment",
            entityType: "payment",
            entityId: payment.id,
            organizationId: payment.organizationId,
            actorType: "SYSTEM",
            metadata: { alert: "INTEGRITY_MISMATCH", mismatch },
          });
        });
        throw new AppError("CONFLICT", "Divergência entre pagamento e PSP — requer análise.");
      }

      return db.transaction((tx) => applySnapshot(tx, payment.id, provider.id, snap));
    },
  );
}

async function applySnapshot(tx: Tx, paymentId: string, providerId: string, snap: ProviderPaymentSnapshot): Promise<SyncOutcome> {
  const current = await tx.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!current) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");
  // Lock order first, then payment (global lock order).
  const order = await lockOrder(tx, current.orderId);
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
  if (!payment) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");

  await upsertProviderTransaction(tx, providerId, payment.id, snap);

  const from = payment.status;
  const to = snap.status;
  const transition = canTransition(from, to);
  const now = new Date();

  const baseFields = {
    providerStatus: snap.rawStatus,
    providerStatusDetail: snap.rawStatusDetail ?? null,
    providerFeeAmount: snap.providerFeeAmount ?? payment.providerFeeAmount,
    netAmount: snap.netAmount ?? payment.netAmount,
    refundedAmount: Math.max(payment.refundedAmount, snap.refundedAmount),
    disputed: payment.disputed || snap.rawStatus === "in_mediation",
    pixQrCode: payment.pixQrCode ?? snap.pix?.qrCode ?? null,
    lastSyncedAt: now,
    updatedAt: now,
  };

  if (!transition) {
    await tx.update(payments).set(baseFields).where(eq(payments.id, payment.id));
    if (from !== to) logger.warn("payment.transition_ignored", { from, to });
    // Additional partial refunds keep PARTIALLY_REFUNDED but still move money.
    if (to === "PARTIALLY_REFUNDED" && snap.refundedAmount > payment.refundedAmount) {
      await applyRefundEffects(tx, order, payment, snap.refundedAmount, "PARTIALLY_REFUNDED");
    }
    return { changed: false, status: from };
  }

  await tx
    .update(payments)
    .set({
      ...baseFields,
      status: to,
      authorizedAt: to === "AUTHORIZED" ? now : payment.authorizedAt,
      paidAt: to === "PAID" ? (snap.paidAt ?? now) : payment.paidAt,
      failedAt: to === "FAILED" ? now : payment.failedAt,
      failureCode: to === "FAILED" ? (snap.failure?.code ?? null) : payment.failureCode,
      failureMessage: to === "FAILED" ? (snap.failure?.message ?? null) : payment.failureMessage,
    })
    .where(eq(payments.id, payment.id));

  await audit(tx, {
    action: "payment.status_change",
    entityType: "payment",
    entityId: payment.id,
    organizationId: payment.organizationId,
    actorType: "PROVIDER",
    amount: payment.amount,
    metadata: { from, to, providerStatus: snap.rawStatus, detail: snap.rawStatusDetail },
  });
  logger.info("payment.status_changed", { from, to });

  switch (to) {
    case "PAID":
      if (from === "CHARGEBACK") {
        await addOrderEvent(tx, order.id, "CHARGEBACK_REVERSED", { paymentId: payment.id });
      } else {
        await markOrderPaid(tx, order, payment.id);
      }
      break;
    case "FAILED":
    case "CANCELLED":
    case "EXPIRED":
      // The order keeps its reservation until it expires, so the buyer can retry.
      await addOrderEvent(tx, order.id, `PAYMENT_${to}`, { paymentId: payment.id, detail: snap.rawStatusDetail });
      break;
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      await applyRefundEffects(tx, order, payment, snap.refundedAmount, to);
      break;
    case "CHARGEBACK": {
      const n = await invalidateOrderTickets(tx, order, "CANCELLED", "chargeback");
      await addOrderEvent(tx, order.id, "CHARGEBACK", { paymentId: payment.id, ticketsCancelled: n });
      break;
    }
    default:
      await addOrderEvent(tx, order.id, `PAYMENT_${to}`, { paymentId: payment.id });
  }
  return { changed: true, from, to };
}

/** PSP-confirmed refund amounts → order + tickets + in-flight refund rows. */
async function applyRefundEffects(
  tx: Tx,
  order: typeof orders.$inferSelect,
  payment: PaymentRow,
  refundedAmount: number,
  status: "REFUNDED" | "PARTIALLY_REFUNDED",
) {
  const orderStatus = status === "REFUNDED" ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx
    .update(orders)
    .set({ status: orderStatus, refundedAmount: Math.min(refundedAmount, order.totalAmount), updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  await addOrderEvent(tx, order.id, status === "REFUNDED" ? "ORDER_REFUNDED" : "ORDER_PARTIALLY_REFUNDED", {
    paymentId: payment.id,
    refundedAmount,
  });
  if (status === "REFUNDED") {
    await invalidateOrderTickets(tx, order, "REFUNDED", "full refund confirmed by PSP");
  }

  // In-flight refund requests are now confirmed by the PSP's own numbers.
  const inflight = await tx
    .select()
    .from(refunds)
    .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ["REQUESTED", "PROCESSING"])))
    .orderBy(desc(refunds.createdAt));
  const [{ done } = { done: 0 }] = await tx
    .select({ done: sql<number>`COALESCE(SUM(${refunds.amount}),0)::int` })
    .from(refunds)
    .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "SUCCEEDED")));
  let budget = refundedAmount - Number(done);
  for (const r of inflight) {
    if (r.amount <= budget) {
      budget -= r.amount;
      await tx
        .update(refunds)
        .set({ status: "SUCCEEDED", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(refunds.id, r.id));
      await audit(tx, {
        action: "refund.succeeded",
        entityType: "refund",
        entityId: r.id,
        organizationId: r.organizationId,
        actorType: "PROVIDER",
        amount: r.amount,
      });
    }
  }
}

export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}
