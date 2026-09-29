import { and, asc, eq, inArray, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb, type Tx } from "@/server/db/client";
import { customers, emailOutbox, events, orderItems, orders, ticketBatches, tickets, ticketTypes, venues } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { humanCode } from "@/server/lib/crypto";
import { env } from "@/server/lib/env";
import { orderAccessToken, signTicketQr } from "@/server/lib/tokens";
import { addOrderEvent } from "./order-events";

type OrderRow = typeof orders.$inferSelect;

/**
 * Issues one ticket per purchased unit. Must run inside the transaction that marks the order PAID,
 * under the order lock; the existence check makes it idempotent regardless.
 */
export async function issueTicketsForOrder(tx: Tx, order: OrderRow) {
  const existing = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.orderId, order.id)).limit(1);
  if (existing.length > 0) return;

  const customer = await tx.query.customers.findFirst({ where: eq(customers.id, order.customerId) });
  if (!customer) throw new Error(`customer ${order.customerId} missing for order ${order.id}`);
  const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.id));

  const rows: (typeof tickets.$inferInsert)[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      rows.push({
        code: humanCode(10),
        organizationId: order.organizationId,
        orderId: order.id,
        orderItemId: line.id,
        eventId: order.eventId,
        ticketTypeId: line.ticketTypeId,
        ticketBatchId: line.ticketBatchId,
        holderName: customer.name,
        holderEmail: customer.email,
      });
    }
  }
  const inserted = await tx.insert(tickets).values(rows).returning({ id: tickets.id });
  await addOrderEvent(tx, order.id, "TICKETS_ISSUED", { count: inserted.length });
  await audit(tx, {
    action: "ticket.issue",
    entityType: "order",
    entityId: order.id,
    organizationId: order.organizationId,
    actorType: "SYSTEM",
    metadata: { count: inserted.length },
  });

  // Delivery e-mail (outbox pattern: committed atomically with the tickets, sent by a worker).
  await tx
    .insert(emailOutbox)
    .values({
      toEmail: customer.email,
      template: "order_confirmed",
      dedupeKey: `order_confirmed:${order.id}`,
      payload: {
        orderId: order.id,
        orderCode: order.code,
        buyerName: customer.name,
        accessUrl: `${env().APP_URL}/pedido/${order.id}/acesso?token=${orderAccessToken(order.id)}`,
      },
    })
    .onConflictDoNothing({ target: emailOutbox.dedupeKey });
}

/** Marks VALID tickets of an order as REFUNDED/CANCELLED and returns capacity to the batch. */
export async function invalidateOrderTickets(tx: Tx, order: OrderRow, status: "REFUNDED" | "CANCELLED", reason: string) {
  const affected = await tx
    .update(tickets)
    .set({ status, cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tickets.orderId, order.id), eq(tickets.status, "VALID")))
    .returning({ id: tickets.id, batchId: tickets.ticketBatchId });
  if (affected.length === 0) return 0;

  // Refunded tickets no longer occupy capacity (sorted batch order → no deadlocks).
  const perBatch = new Map<string, number>();
  for (const t of affected) perBatch.set(t.batchId, (perBatch.get(t.batchId) ?? 0) + 1);
  for (const [batchId, n] of [...perBatch.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    await tx
      .update(ticketBatches)
      .set({ soldQuantity: sql`${ticketBatches.soldQuantity} - ${n}`, updatedAt: new Date() })
      .where(and(eq(ticketBatches.id, batchId), sql`${ticketBatches.soldQuantity} >= ${n}`));
  }
  await audit(tx, {
    action: "ticket.invalidate",
    entityType: "order",
    entityId: order.id,
    organizationId: order.organizationId,
    actorType: "SYSTEM",
    metadata: { count: affected.length, status, reason },
  });
  return affected.length;
}

export async function listTicketsForOrder(orderId: string) {
  const db = getDb();
  const rows = await db
    .select({ ticket: tickets, typeName: ticketTypes.name, batchName: ticketBatches.name })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(ticketBatches, eq(ticketBatches.id, tickets.ticketBatchId))
    .where(eq(tickets.orderId, orderId))
    .orderBy(asc(tickets.createdAt), asc(tickets.code));
  return Promise.all(
    rows.map(async ({ ticket, typeName, batchName }) => ({
      id: ticket.id,
      code: ticket.code,
      status: ticket.status,
      holderName: ticket.holderName,
      typeName,
      batchName,
      checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
      // Only VALID tickets get a scannable QR on screen.
      qrSvg: ticket.status === "VALID" ? await renderQrSvg(signTicketQr(ticket.id, ticket.qrVersion)) : null,
    })),
  );
}

export async function renderQrSvg(payload: string) {
  return QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

export async function getEventForTickets(eventId: string) {
  const db = getDb();
  const [row] = await db
    .select({ event: events, venue: venues })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.id, eventId));
  return row ?? null;
}

export async function countTicketsByStatus(orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return getDb()
    .select({ orderId: tickets.orderId, status: tickets.status, n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(inArray(tickets.orderId, orderIds))
    .groupBy(tickets.orderId, tickets.status);
}
