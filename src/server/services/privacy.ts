/**
 * LGPD data-subject requests (art. 18): access/portability export and anonymization.
 * Financial records (amounts, PSP ids, dates) are kept — legal/fiscal retention — but every
 * piece of personal data attached to them is replaced.
 */
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { customers, emailOutbox, events, orders, tickets, ticketTypes } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";

export async function searchCustomers(orgIds: string[], q: string) {
  const term = q.trim();
  if (term.length < 3 || orgIds.length === 0) return [];
  return getDb()
    .select({
      id: customers.id,
      organizationId: customers.organizationId,
      name: customers.name,
      email: customers.email,
      anonymizedAt: customers.anonymizedAt,
      orders: sql<number>`(SELECT count(*)::int FROM orders o WHERE o.customer_id = ${customers.id})`,
    })
    .from(customers)
    .where(and(inArray(customers.organizationId, orgIds), or(ilike(customers.email, `%${term.toLowerCase()}%`), ilike(customers.name, `%${term}%`))))
    .orderBy(asc(customers.name))
    .limit(25);
}

export async function customerOrganizationId(customerId: string) {
  const c = await getDb().query.customers.findFirst({ where: eq(customers.id, customerId), columns: { organizationId: true } });
  return c?.organizationId ?? null;
}

/** Everything we hold about the data subject, in a portable JSON document. */
export async function exportCustomerData(customerId: string, actorUserId: string) {
  const db = getDb();
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  if (!customer) throw new AppError("NOT_FOUND", "Titular não encontrado.");
  const orderRows = await db
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      total: orders.totalAmount,
      discount: orders.discountAmount,
      fee: orders.feeAmount,
      refunded: orders.refundedAmount,
      paymentMethod: orders.paymentMethod,
      event: events.name,
      eventDate: events.startsAt,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.customerId, customerId))
    .orderBy(asc(orders.createdAt));
  const ticketRows = orderRows.length
    ? await db
        .select({ code: tickets.code, status: tickets.status, holderName: tickets.holderName, holderEmail: tickets.holderEmail, type: ticketTypes.name, checkedInAt: tickets.checkedInAt, orderId: tickets.orderId })
        .from(tickets)
        .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
        .where(inArray(tickets.orderId, orderRows.map((o) => o.id)))
    : [];

  await audit(db, {
    action: "customer.export",
    entityType: "customer",
    entityId: customerId,
    organizationId: customer.organizationId,
    actorType: "USER",
    actorUserId,
    metadata: { orders: orderRows.length },
  });

  return {
    generatedAt: new Date().toISOString(),
    controller: "Organização produtora do evento (ver política de privacidade)",
    subject: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      document: customer.document,
      marketingConsent: customer.marketingOptIn,
      createdAt: customer.createdAt,
      anonymizedAt: customer.anonymizedAt,
    },
    orders: orderRows.map(({ id: _id, ...o }) => ({ ...o, amountsInCents: true })),
    tickets: ticketRows.map(({ orderId: _o, ...t }) => t),
    notes: [
      "Dados de cartão nunca são armazenados por esta plataforma (tokenização pelo processador de pagamento).",
      "Registros financeiros são mantidos pelo prazo legal mesmo após anonimização.",
    ],
  };
}

/**
 * Irreversibly replaces the subject's personal data. Blocked while there is something the person
 * still needs the data for (open payment, valid ticket for a future event).
 */
export async function anonymizeCustomer(customerId: string, actorUserId: string, reason: string) {
  return getDb().transaction(async (tx) => {
    const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
    if (!customer) throw new AppError("NOT_FOUND", "Titular não encontrado.");
    if (customer.anonymizedAt) throw new AppError("INVALID_STATE", "Titular já anonimizado.");

    const [{ open } = { open: 0 }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), inArray(orders.status, ["AWAITING_PAYMENT", "REFUND_PENDING"])));
    const [{ live } = { live: 0 }] = await tx
      .select({ live: sql<number>`count(*)::int` })
      .from(tickets)
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .innerJoin(events, eq(events.id, tickets.eventId))
      .where(and(eq(orders.customerId, customerId), eq(tickets.status, "VALID"), sql`${events.endsAt} > now()`));
    if (Number(open) > 0 || Number(live) > 0) {
      throw new AppError(
        "INVALID_STATE",
        "Há pedido em aberto ou ingresso válido para evento futuro. Cancele/reembolse antes ou aguarde o evento.",
      );
    }

    const anonName = "Titular anonimizado";
    const anonEmail = `anon-${customer.id}@anonimizado.invalid`;
    await tx
      .update(customers)
      .set({ name: anonName, email: anonEmail, phone: null, document: null, marketingOptIn: false, anonymizedAt: new Date(), updatedAt: new Date() })
      .where(eq(customers.id, customerId));
    const orderIds = (await tx.select({ id: orders.id }).from(orders).where(eq(orders.customerId, customerId))).map((o) => o.id);
    let ticketCount = 0;
    if (orderIds.length) {
      const t = await tx
        .update(tickets)
        .set({ holderName: anonName, holderEmail: anonEmail, updatedAt: new Date() })
        .where(inArray(tickets.orderId, orderIds))
        .returning({ id: tickets.id });
      ticketCount = t.length;
      await tx.update(orders).set({ ip: null, updatedAt: new Date() }).where(inArray(orders.id, orderIds));
    }
    await tx.update(emailOutbox).set({ toEmail: anonEmail, payload: {} }).where(eq(emailOutbox.toEmail, customer.email));

    await audit(tx, {
      action: "customer.anonymize",
      entityType: "customer",
      entityId: customerId,
      organizationId: customer.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { reason, orders: orderIds.length, tickets: ticketCount },
    });
    return { orders: orderIds.length, tickets: ticketCount };
  });
}
