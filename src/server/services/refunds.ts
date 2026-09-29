/**
 * Refunds: request → eligibility → PSP → authoritative sync → order/tickets.
 * The database never "declares" money returned: only the PSP's own numbers (via
 * syncPaymentFromProvider) move an order to REFUNDED and invalidate tickets.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { orders, paymentAttempts, payments, refunds, tickets } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";
import { logger, withLogContext } from "@/server/lib/logger";
import { getProvider } from "@/server/payments/registry";
import { ProviderError } from "@/server/payments/provider";
import { isUniqueViolation, syncPaymentFromProvider } from "./payments";

export interface RefundRequest {
  orderId: string;
  /** Cents. Omit for a full refund of the remaining balance. */
  amount?: number;
  reason: string;
  actorUserId: string;
}

export async function requestRefund(req: RefundRequest) {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, req.orderId) });
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  if (!["PAID", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(order.status)) {
    throw new AppError("INVALID_STATE", "Só é possível reembolsar pedidos pagos.");
  }
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, order.id), inArray(payments.status, ["PAID", "PARTIALLY_REFUNDED"])))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment?.providerPaymentId) throw new AppError("INVALID_STATE", "Nenhum pagamento aprovado para reembolsar.");

  const provider = getProvider(payment.provider);
  const refundable = payment.amount - payment.refundedAmount;
  const amount = req.amount ?? refundable;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > refundable) {
    throw new AppError("VALIDATION_ERROR", "Valor de reembolso inválido.");
  }
  const isFull = amount === refundable && payment.refundedAmount === 0;
  if (!isFull && !provider.capabilities.partialRefund) {
    throw new AppError("NOT_SUPPORTED", "Reembolso parcial não suportado por este PSP.");
  }
  if (isFull) {
    const [{ used } = { used: 0 }] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.orderId, order.id), eq(tickets.status, "CHECKED_IN")));
    if (Number(used) > 0) {
      throw new AppError("INVALID_STATE", "Há ingressos deste pedido já utilizados no evento; reembolso total bloqueado.");
    }
  }

  let refund: typeof refunds.$inferSelect;
  try {
    refund = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(refunds)
        .values({
          organizationId: order.organizationId,
          orderId: order.id,
          paymentId: payment.id,
          amount,
          reason: req.reason.slice(0, 500),
          requestedBy: req.actorUserId,
        })
        .returning();
      await audit(tx, {
        action: "refund.request",
        entityType: "refund",
        entityId: r!.id,
        organizationId: order.organizationId,
        actorType: "USER",
        actorUserId: req.actorUserId,
        amount,
        metadata: { orderId: order.id, orderCode: order.code, paymentId: payment.id, full: isFull, reason: req.reason },
      });
      return r!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe um reembolso em andamento para este pagamento.");
    throw e;
  }
  return executeRefund(refund.id);
}

/** Sends (or re-sends, with the same idempotency key) a REQUESTED refund to the PSP. */
export async function executeRefund(refundId: string) {
  const db = getDb();
  const refund = await db.query.refunds.findFirst({ where: eq(refunds.id, refundId) });
  if (!refund) throw new AppError("NOT_FOUND", "Reembolso não encontrado.");
  if (refund.status !== "REQUESTED") return refund;
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, refund.paymentId) });
  if (!payment?.providerPaymentId) throw new AppError("INVALID_STATE", "Pagamento sem referência no PSP.");

  return withLogContext({ payment_id: payment.id, order_id: refund.orderId }, async () => {
    const provider = getProvider(payment.provider);
    const refundable = payment.amount - payment.refundedAmount;
    const idempotencyKey = `refund_${refund.id}`;
    const start = performance.now();
    try {
      const result = await provider.refundPayment(
        {
          providerPaymentId: payment.providerPaymentId!,
          amount: refund.amount === refundable && payment.refundedAmount === 0 ? undefined : refund.amount,
          refundId: refund.id,
        },
        { idempotencyKey },
      );
      await db.insert(paymentAttempts).values({
        paymentId: payment.id,
        refundId: refund.id,
        provider: provider.id,
        operation: "REFUND",
        outcome: "SUCCESS",
        idempotencyKey,
        providerReference: result.providerRefundId,
        durationMs: Math.round(performance.now() - start),
      });
      if (result.status === "FAILED") {
        await markRefundFailed(refund.id, `PSP recusou o reembolso (${result.rawStatus}).`, refund.organizationId);
      } else {
        // Recorded as PROCESSING; SUCCEEDED is only set once the PSP payment shows the refunded amount.
        await db
          .update(refunds)
          .set({ status: "PROCESSING", providerRefundId: result.providerRefundId, updatedAt: new Date() })
          .where(eq(refunds.id, refund.id));
      }
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      await db.insert(paymentAttempts).values({
        paymentId: payment.id,
        refundId: refund.id,
        provider: provider.id,
        operation: "REFUND",
        outcome: "ERROR",
        idempotencyKey,
        errorCode: pe?.code ?? "UNKNOWN",
        errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        durationMs: Math.round(performance.now() - start),
      });
      if (pe && !pe.retryable) {
        await markRefundFailed(refund.id, pe.message, refund.organizationId);
        throw new AppError("PAYMENT_PROVIDER_ERROR", "O PSP recusou o reembolso.");
      }
      // Unknown outcome: keep REQUESTED; retrying executeRefund reuses the same idempotency key.
      logger.error("refund.provider_unreachable", { err: e });
      throw new AppError("PAYMENT_PROVIDER_ERROR", "PSP indisponível. O reembolso ficou pendente e pode ser reenviado.");
    }

    // Authoritative confirmation: read the payment back from the PSP.
    try {
      await syncPaymentFromProvider(payment.id);
    } catch (e) {
      logger.warn("refund.sync_deferred", { err: e });
    }
    return (await db.query.refunds.findFirst({ where: eq(refunds.id, refund.id) }))!;
  });
}

async function markRefundFailed(refundId: string, message: string, organizationId: string) {
  await getDb().transaction(async (tx) => {
    await tx
      .update(refunds)
      .set({ status: "FAILED", failureMessage: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(refunds.id, refundId));
    await audit(tx, {
      action: "refund.failed",
      entityType: "refund",
      entityId: refundId,
      organizationId,
      actorType: "PROVIDER",
      metadata: { message },
    });
  });
}
