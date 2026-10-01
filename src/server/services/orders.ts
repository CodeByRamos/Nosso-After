/**
 * Orders + inventory (ADR-0003).
 *
 * Lock ordering, used everywhere to avoid deadlocks:
 *   orders → payments → ticket_batches (always sorted by id) → tickets
 * createOrder only takes an advisory lock + batch row locks (the order row is new), so it cannot
 * form a cycle with the flows that lock an existing order first.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db/client";
import {
  customers,
  events,
  fees,
  orderItems,
  orders,
  payments,
  ticketBatches,
  ticketTypes,
} from "@/server/db/schema";
import { computeQuote, type Quote } from "@/server/domain/fees";
import { audit } from "@/server/lib/audit";
import { humanCode } from "@/server/lib/crypto";
import { env } from "@/server/lib/env";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import type { CreateOrderInput, QuoteInput } from "@/validators/checkout";
import { batchOnSale, eventOnSale, resolveFeeRuleFor, type BatchRow, type EventRow } from "./catalog";
import { confirmCouponForOrder, releaseCouponForOrder, reserveCoupon, resolveCoupon, type CouponRow } from "./coupons";
import { addOrderEvent } from "./order-events";
import { commissionFor, eligiblePromoter } from "./promoters";
import { issueTicketsForOrder } from "./tickets";

export { addOrderEvent };

export type OrderRow = typeof orders.$inferSelect;

/** Statuses in which an order holds/consumes inventory for the per-customer limit. */
const COUNTED_ORDER_STATUSES = ["AWAITING_PAYMENT", "PAID", "PARTIALLY_REFUNDED", "REFUND_PENDING"] as const;

interface LoadedQuote {
  event: EventRow;
  batches: Map<string, BatchRow & { typeName: string }>;
  quote: Quote;
  coupon: CouponRow | null;
}

async function loadAndQuote(db: Tx | ReturnType<typeof getDb>, input: QuoteInput, now: Date): Promise<LoadedQuote> {
  const event = await db.query.events.findFirst({ where: eq(events.id, input.eventId) });
  if (!event) throw new AppError("NOT_FOUND", "Evento não encontrado.");
  const sale = eventOnSale(event, now);
  if (!sale.ok) throw new AppError("SALES_CLOSED", sale.reason);

  const ids = input.items.map((i) => i.batchId);
  const rows = await db
    .select({ batch: ticketBatches, typeName: ticketTypes.name })
    .from(ticketBatches)
    .innerJoin(ticketTypes, eq(ticketTypes.id, ticketBatches.ticketTypeId))
    .where(and(inArray(ticketBatches.id, ids), eq(ticketBatches.eventId, event.id)));
  const batches = new Map(rows.map((r) => [r.batch.id, { ...r.batch, typeName: r.typeName }]));

  for (const item of input.items) {
    const batch = batches.get(item.batchId);
    if (!batch) throw new AppError("NOT_FOUND", "Lote não encontrado para este evento.");
    const onSale = batchOnSale(batch, now);
    if (!onSale.ok) throw new AppError("SALES_CLOSED", onSale.reason);
    if (item.quantity > batch.maxPerCustomer) {
      throw new AppError("LIMIT_EXCEEDED", `Máximo de ${batch.maxPerCustomer} ingresso(s) por pessoa em ${batch.name}.`);
    }
  }

  const rule = await resolveFeeRuleFor(db, {
    organizationId: event.organizationId,
    eventId: event.id,
    paymentMethod: input.paymentMethod,
    at: now,
  });
  const coupon = input.couponCode
    ? await resolveCoupon(db, { organizationId: event.organizationId, eventId: event.id, code: input.couponCode, at: now })
    : null;
  const quote = computeQuote(
    input.items.map((i) => ({ batchId: i.batchId, quantity: i.quantity, unitPrice: batches.get(i.batchId)!.price })),
    rule,
    coupon?.pricing ?? null,
  );
  if (coupon && quote.discount === 0) {
    throw new AppError("COUPON_INVALID", "Este cupom não vale para os ingressos selecionados.");
  }
  if (quote.total <= 0) {
    // Free tickets need a different (non-payment) flow — out of scope for now.
    throw new AppError("NOT_SUPPORTED", "Ingressos gratuitos ainda não são suportados.");
  }
  return { event, batches, quote, coupon: coupon?.row ?? null };
}

/** Price preview shown in the review step (fees itemized before confirmation). No reservation. */
export async function quoteOrder(input: QuoteInput, now = new Date()) {
  const { quote, batches } = await loadAndQuote(getDb(), input, now);
  return {
    subtotal: quote.subtotal,
    discount: quote.discount,
    fee: quote.fee,
    total: quote.total,
    couponCode: quote.couponId ? input.couponCode?.trim().toUpperCase() : null,
    lines: quote.lines.map((l) => {
      const b = batches.get(l.batchId)!;
      return {
        batchId: l.batchId,
        description: `${b.typeName} · ${b.name}`,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitDiscount: l.unitDiscount,
        unitFee: l.unitFee,
      };
    }),
  };
}

export interface CreatedOrder {
  id: string;
  code: string;
  status: OrderRow["status"];
  subtotal: number;
  discount: number;
  fee: number;
  total: number;
  expiresAt: string;
  paymentMethod: OrderRow["paymentMethod"];
}

export async function createOrder(
  input: CreateOrderInput,
  meta: { ip?: string | null; promoterId?: string | null } = {},
): Promise<CreatedOrder> {
  const now = new Date();
  const reservationMs = env().ORDER_RESERVATION_MINUTES * 60_000;

  return getDb().transaction(async (tx) => {
    const { event, batches, quote, coupon } = await loadAndQuote(tx, input, now);
    const promoter = await eligiblePromoter(tx, meta.promoterId ?? null, event.organizationId);
    const ticketCount = input.items.reduce((s, i) => s + i.quantity, 0);
    const commission = promoter ? commissionFor(promoter, quote.subtotal - quote.discount, ticketCount) : 0;
    const email = input.buyer.email;

    // Serialize concurrent checkouts of the same buyer for the same event (per-customer limit).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${event.id}:${email}`}, 0))`);

    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: event.organizationId,
        name: input.buyer.name,
        email,
        phone: input.buyer.phone,
        document: input.buyer.document ?? null,
        marketingOptIn: input.buyer.marketingOptIn,
      })
      .onConflictDoUpdate({
        target: [customers.organizationId, customers.email],
        set: {
          name: input.buyer.name,
          phone: input.buyer.phone,
          document: sql`COALESCE(${input.buyer.document ?? null}, ${customers.document})`,
          marketingOptIn: input.buyer.marketingOptIn,
          anonymizedAt: null,
          updatedAt: now,
        },
      })
      .returning();
    if (!customer) throw new AppError("INTERNAL", "Falha ao registrar comprador.");

    // Per-customer limit across all their live orders for each batch.
    const held = await tx
      .select({ batchId: orderItems.ticketBatchId, qty: sql<number>`COALESCE(SUM(${orderItems.quantity}),0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(
        and(
          eq(orders.customerId, customer.id),
          inArray(orderItems.ticketBatchId, [...batches.keys()]),
          inArray(orders.status, [...COUNTED_ORDER_STATUSES]),
          sql`NOT (${orders.status} = 'AWAITING_PAYMENT' AND ${orders.expiresAt} < now())`,
        ),
      )
      .groupBy(orderItems.ticketBatchId);
    const heldBy = new Map(held.map((h) => [h.batchId, Number(h.qty)]));
    for (const item of input.items) {
      const b = batches.get(item.batchId)!;
      if ((heldBy.get(item.batchId) ?? 0) + item.quantity > b.maxPerCustomer) {
        throw new AppError(
          "LIMIT_EXCEEDED",
          `Limite de ${b.maxPerCustomer} ingresso(s) por pessoa em ${b.name} atingido (inclui pedidos em aberto).`,
        );
      }
    }

    // Atomic reservation, in deterministic batch order (deadlock-free).
    for (const item of [...input.items].sort((a, b) => a.batchId.localeCompare(b.batchId))) {
      const reserved = await tx
        .update(ticketBatches)
        .set({ reservedQuantity: sql`${ticketBatches.reservedQuantity} + ${item.quantity}`, updatedAt: now })
        .where(
          and(
            eq(ticketBatches.id, item.batchId),
            eq(ticketBatches.status, "ACTIVE"),
            sql`${ticketBatches.quantity} - ${ticketBatches.soldQuantity} - ${ticketBatches.reservedQuantity} >= ${item.quantity}`,
          ),
        )
        .returning({ id: ticketBatches.id });
      if (reserved.length === 0) {
        const b = batches.get(item.batchId)!;
        throw new AppError("SOLD_OUT", `Não há ingressos suficientes em ${b.typeName} · ${b.name}.`);
      }
    }

    const [order] = await tx
      .insert(orders)
      .values({
        code: humanCode(8),
        organizationId: event.organizationId,
        eventId: event.id,
        customerId: customer.id,
        paymentMethod: input.paymentMethod,
        subtotalAmount: quote.subtotal,
        discountAmount: quote.discount,
        feeAmount: quote.fee,
        totalAmount: quote.total,
        expiresAt: new Date(now.getTime() + reservationMs),
        ip: meta.ip ?? null,
        couponId: quote.couponId,
        promoterId: promoter?.id ?? null,
        promoterCommissionAmount: commission,
      })
      .returning();
    if (!order) throw new AppError("INTERNAL", "Falha ao criar pedido.");

    for (const line of quote.lines) {
      const b = batches.get(line.batchId)!;
      const [item] = await tx
        .insert(orderItems)
        .values({
          orderId: order.id,
          ticketBatchId: b.id,
          ticketTypeId: b.ticketTypeId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitDiscount: line.unitDiscount,
          unitFee: line.unitFee,
          description: `${b.typeName} · ${b.name}`,
        })
        .returning({ id: orderItems.id });
      if (quote.feeRuleId && line.lineFee > 0) {
        await tx.insert(fees).values({
          orderId: order.id,
          orderItemId: item!.id,
          feeRuleId: quote.feeRuleId,
          type: "PLATFORM_FEE",
          amount: line.lineFee,
          snapshot: quote.feeSnapshot ?? {},
        });
      }
    }
    const perOrderFee = quote.fee - quote.lines.reduce((s, l) => s + l.lineFee, 0);
    if (quote.feeRuleId && perOrderFee > 0) {
      await tx.insert(fees).values({
        orderId: order.id,
        feeRuleId: quote.feeRuleId,
        type: "PLATFORM_FEE",
        amount: perOrderFee,
        snapshot: quote.feeSnapshot ?? {},
      });
    }

    if (coupon && quote.couponId) {
      await reserveCoupon(tx, coupon, { orderId: order.id, customerId: customer.id, discount: quote.discount });
    }
    await addOrderEvent(tx, order.id, "ORDER_CREATED", {
      total: quote.total,
      method: input.paymentMethod,
      ...(quote.couponId ? { coupon: coupon?.code, discount: quote.discount } : {}),
      ...(promoter ? { promoter: promoter.code, commission } : {}),
    });
    await addOrderEvent(tx, order.id, "INVENTORY_RESERVED", {
      items: input.items,
      expiresAt: order.expiresAt.toISOString(),
    });
    await audit(tx, {
      action: "order.create",
      entityType: "order",
      entityId: order.id,
      organizationId: order.organizationId,
      actorType: "CUSTOMER",
      amount: order.totalAmount,
      metadata: { code: order.code, eventId: event.id },
    });

    return {
      id: order.id,
      code: order.code,
      status: order.status,
      subtotal: order.subtotalAmount,
      discount: order.discountAmount,
      fee: order.feeAmount,
      total: order.totalAmount,
      expiresAt: order.expiresAt.toISOString(),
      paymentMethod: order.paymentMethod,
    };
  });
}

export async function lockOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  return order;
}

async function orderLines(tx: Tx, orderId: string) {
  return tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.ticketBatchId));
}

/** Returns reserved stock to the pool. Caller must hold the order lock. Idempotent via inventory_status. */
export async function releaseInventory(tx: Tx, order: OrderRow, reason: string) {
  if (order.inventoryStatus !== "RESERVED") return false;
  for (const line of await orderLines(tx, order.id)) {
    const res = await tx
      .update(ticketBatches)
      .set({ reservedQuantity: sql`${ticketBatches.reservedQuantity} - ${line.quantity}`, updatedAt: new Date() })
      .where(and(eq(ticketBatches.id, line.ticketBatchId), sql`${ticketBatches.reservedQuantity} >= ${line.quantity}`))
      .returning({ id: ticketBatches.id });
    if (res.length === 0) throw new Error(`inventory invariant broken releasing batch ${line.ticketBatchId}`);
  }
  await tx.update(orders).set({ inventoryStatus: "RELEASED", updatedAt: new Date() }).where(eq(orders.id, order.id));
  await addOrderEvent(tx, order.id, "INVENTORY_RELEASED", { reason });
  return true;
}

/**
 * Converts the order's inventory into sold tickets. Returns false when a late payment can no
 * longer be fulfilled (stock gone) — the caller then routes the order to REFUND_PENDING.
 */
async function commitInventory(tx: Tx, order: OrderRow): Promise<boolean> {
  const lines = await orderLines(tx, order.id);
  if (order.inventoryStatus === "COMMITTED") return true;
  if (order.inventoryStatus === "RESERVED") {
    for (const line of lines) {
      const res = await tx
        .update(ticketBatches)
        .set({
          reservedQuantity: sql`${ticketBatches.reservedQuantity} - ${line.quantity}`,
          soldQuantity: sql`${ticketBatches.soldQuantity} + ${line.quantity}`,
          updatedAt: new Date(),
        })
        .where(and(eq(ticketBatches.id, line.ticketBatchId), sql`${ticketBatches.reservedQuantity} >= ${line.quantity}`))
        .returning({ id: ticketBatches.id });
      if (res.length === 0) throw new Error(`inventory invariant broken committing batch ${line.ticketBatchId}`);
    }
  } else {
    // RELEASED: late payment. Try to sell directly from available stock, all-or-nothing (savepoint).
    try {
      await tx.transaction(async (sp) => {
        for (const line of lines) {
          const res = await sp
            .update(ticketBatches)
            .set({ soldQuantity: sql`${ticketBatches.soldQuantity} + ${line.quantity}`, updatedAt: new Date() })
            .where(
              and(
                eq(ticketBatches.id, line.ticketBatchId),
                sql`${ticketBatches.quantity} - ${ticketBatches.soldQuantity} - ${ticketBatches.reservedQuantity} >= ${line.quantity}`,
              ),
            )
            .returning({ id: ticketBatches.id });
          if (res.length === 0) throw new LateStockUnavailable();
        }
      });
    } catch (e) {
      if (e instanceof LateStockUnavailable) return false;
      throw e;
    }
  }
  await tx.update(orders).set({ inventoryStatus: "COMMITTED", updatedAt: new Date() }).where(eq(orders.id, order.id));
  await addOrderEvent(tx, order.id, "INVENTORY_COMMITTED", { late: order.inventoryStatus === "RELEASED" });
  return true;
}

class LateStockUnavailable extends Error {}

/**
 * Called (under order lock) when the PSP confirms a payment as PAID.
 * Idempotent: a second call for an already PAID order is a no-op.
 */
export async function markOrderPaid(tx: Tx, order: OrderRow, paymentId: string) {
  if (order.status === "PAID" || order.status === "PARTIALLY_REFUNDED" || order.status === "REFUNDED") return;
  if (order.status === "REFUND_PENDING") return;

  const fulfilled = await commitInventory(tx, order);
  if (!fulfilled) {
    await tx
      .update(orders)
      .set({ status: "REFUND_PENDING", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await addOrderEvent(tx, order.id, "PAYMENT_APPROVED_WITHOUT_STOCK", { paymentId });
    await audit(tx, {
      action: "order.refund_pending",
      entityType: "order",
      entityId: order.id,
      organizationId: order.organizationId,
      actorType: "SYSTEM",
      amount: order.totalAmount,
      metadata: { reason: "late payment, inventory no longer available", paymentId },
    });
    logger.warn("order.late_payment_without_stock", { order_id: order.id, payment_id: paymentId });
    return;
  }

  const paidAt = new Date();
  await tx.update(orders).set({ status: "PAID", paidAt, updatedAt: paidAt }).where(eq(orders.id, order.id));
  await addOrderEvent(tx, order.id, "PAYMENT_APPROVED", { paymentId });
  await audit(tx, {
    action: "order.paid",
    entityType: "order",
    entityId: order.id,
    organizationId: order.organizationId,
    actorType: "PROVIDER",
    amount: order.totalAmount,
    metadata: { paymentId, code: order.code },
  });
  await confirmCouponForOrder(tx, order.id);
  await issueTicketsForOrder(tx, { ...order, status: "PAID", paidAt });
}

/** Expires one order if still unpaid. Caller must have synced the payment with the PSP first. */
export async function expireOrder(orderId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "AWAITING_PAYMENT" || order.expiresAt > new Date()) return false;
    const live = await tx
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), inArray(payments.status, ["PROCESSING", "AUTHORIZED", "PAID"])));
    if (live.length > 0) return false; // card under review / already paid — resolved by payment sync
    await releaseInventory(tx, order, "expired");
    await releaseCouponForOrder(tx, order.id);
    await tx
      .update(orders)
      .set({ status: "EXPIRED", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await addOrderEvent(tx, order.id, "ORDER_EXPIRED");
    await audit(tx, {
      action: "order.expired",
      entityType: "order",
      entityId: order.id,
      organizationId: order.organizationId,
      actorType: "SYSTEM",
    });
    return true;
  });
}

export async function orderOrganizationId(orderId: string): Promise<string | null> {
  const o = await getDb().query.orders.findFirst({ where: eq(orders.id, orderId), columns: { organizationId: true } });
  return o?.organizationId ?? null;
}

/** Buyer-facing order view (after access-token check). Contains only what the buyer needs. */
export async function getOrderView(orderId: string) {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return null;
  const [event, customer, items, pays] = await Promise.all([
    db.query.events.findFirst({ where: eq(events.id, order.eventId) }),
    db.query.customers.findFirst({ where: eq(customers.id, order.customerId) }),
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(asc(payments.createdAt)),
  ]);
  const payment = pays.at(-1) ?? null;
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    paymentMethod: order.paymentMethod,
    subtotal: order.subtotalAmount,
    discount: order.discountAmount,
    fee: order.feeAmount,
    total: order.totalAmount,
    refunded: order.refundedAmount,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    event: event
      ? { id: event.id, name: event.name, slug: event.slug, startsAt: event.startsAt.toISOString(), accentColor: event.accentColor }
      : null,
    buyer: customer ? { name: customer.name, email: customer.email } : null,
    items: items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      unitDiscount: i.unitDiscount,
      unitFee: i.unitFee,
    })),
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          method: payment.method,
          environment: payment.environment,
          pixQrCode: payment.pixQrCode,
          pixExpiresAt: payment.pixExpiresAt?.toISOString() ?? null,
          failureMessage: payment.failureMessage,
          cardLastFour: payment.cardLastFour,
          installments: payment.installments,
        }
      : null,
  };
}
export type OrderView = NonNullable<Awaited<ReturnType<typeof getOrderView>>>;
