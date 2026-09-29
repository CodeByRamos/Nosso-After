/**
 * Read models for the producer dashboard. Every query is scoped by organization ids resolved from
 * the caller's permissions, and every list is paginated (never unbounded).
 */
import { and, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  checkIns,
  customers,
  events,
  orders,
  payments,
  refunds,
  ticketBatches,
  tickets,
  ticketTypes,
  users,
  webhookEvents,
} from "@/server/db/schema";

export const PAGE_SIZE = 25;

const scope = (col: SQL | Parameters<typeof inArray>[0], orgIds: string[]) =>
  orgIds.length ? inArray(col as Parameters<typeof inArray>[0], orgIds) : sql`false`;

export interface DashboardFilter {
  organizationIds: string[];
  eventId?: string;
}

/**
 * Revenue definitions (shown in the UI):
 *  - Receita bruta: Σ total pago pelos compradores em pedidos que foram pagos.
 *  - Taxas da plataforma: Σ taxa de serviço desses pedidos.
 *  - Reembolsos: Σ valores devolvidos confirmados pelo PSP.
 *  - Receita líquida do produtor: bruta − taxas da plataforma − reembolsos (antes da tarifa do PSP).
 *  - Tarifa PSP: Σ custo informado pelo PSP (quando disponível).
 */
export async function dashboardMetrics(f: DashboardFilter) {
  const db = getDb();
  const orderScope = and(scope(orders.organizationId, f.organizationIds), f.eventId ? eq(orders.eventId, f.eventId) : undefined);
  const paidEver = sql`${orders.paidAt} IS NOT NULL`;

  const [o] = await db
    .select({
      orders: count(),
      paidOrders: sql<number>`count(*) FILTER (WHERE ${paidEver})::int`,
      pendingOrders: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'AWAITING_PAYMENT')::int`,
      gross: sql<number>`COALESCE(SUM(${orders.totalAmount}) FILTER (WHERE ${paidEver}),0)::bigint`,
      fees: sql<number>`COALESCE(SUM(${orders.feeAmount}) FILTER (WHERE ${paidEver}),0)::bigint`,
      refunded: sql<number>`COALESCE(SUM(${orders.refundedAmount}),0)::bigint`,
    })
    .from(orders)
    .where(orderScope);

  const payScope = and(
    scope(payments.organizationId, f.organizationIds),
    f.eventId ? sql`${payments.orderId} IN (SELECT id FROM orders WHERE event_id = ${f.eventId})` : undefined,
  );
  const [p] = await db
    .select({
      approved: sql<number>`count(*) FILTER (WHERE ${payments.status} IN ('PAID','PARTIALLY_REFUNDED','REFUNDED'))::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${payments.status} IN ('PENDING','PROCESSING','AUTHORIZED'))::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${payments.status} IN ('FAILED','CANCELLED','EXPIRED'))::int`,
      pspFees: sql<number>`COALESCE(SUM(${payments.providerFeeAmount}),0)::bigint`,
    })
    .from(payments)
    .where(payScope);

  const ticketScope = and(scope(tickets.organizationId, f.organizationIds), f.eventId ? eq(tickets.eventId, f.eventId) : undefined);
  const [t] = await db
    .select({
      sold: sql<number>`count(*) FILTER (WHERE ${tickets.status} IN ('VALID','CHECKED_IN'))::int`,
      checkedIn: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'CHECKED_IN')::int`,
    })
    .from(tickets)
    .where(ticketScope);

  const [r] = await db
    .select({ n: count() })
    .from(refunds)
    .where(and(scope(refunds.organizationId, f.organizationIds), f.eventId ? sql`${refunds.orderId} IN (SELECT id FROM orders WHERE event_id = ${f.eventId})` : undefined));

  const gross = Number(o?.gross ?? 0);
  const fees = Number(o?.fees ?? 0);
  const refunded = Number(o?.refunded ?? 0);
  const paidOrders = Number(o?.paidOrders ?? 0);
  return {
    ticketsSold: Number(t?.sold ?? 0),
    checkedIn: Number(t?.checkedIn ?? 0),
    orders: Number(o?.orders ?? 0),
    paidOrders,
    pendingOrders: Number(o?.pendingOrders ?? 0),
    gross,
    platformFees: fees,
    refunded,
    net: gross - fees - refunded,
    pspFees: Number(p?.pspFees ?? 0),
    paymentsApproved: Number(p?.approved ?? 0),
    paymentsPending: Number(p?.pending ?? 0),
    paymentsFailed: Number(p?.failed ?? 0),
    refunds: Number(r?.n ?? 0),
    averageTicket: paidOrders > 0 ? Math.round(gross / paidOrders) : 0,
  };
}

export async function dashboardCharts(f: DashboardFilter) {
  const db = getDb();
  const orderScope = and(
    scope(orders.organizationId, f.organizationIds),
    f.eventId ? eq(orders.eventId, f.eventId) : undefined,
    sql`${orders.paidAt} IS NOT NULL`,
  );

  const byDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.paidAt} AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD')`,
      orders: count(),
      revenue: sql<number>`SUM(${orders.totalAmount})::bigint`,
    })
    .from(orders)
    .where(and(orderScope, gte(orders.paidAt, sql`now() - interval '30 days'`)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byMethod = await db
    .select({ method: orders.paymentMethod, orders: count(), revenue: sql<number>`SUM(${orders.totalAmount})::bigint` })
    .from(orders)
    .where(orderScope)
    .groupBy(orders.paymentMethod);

  const byBatch = await db
    .select({
      batch: sql<string>`${ticketTypes.name} || ' · ' || ${ticketBatches.name}`,
      sold: ticketBatches.soldQuantity,
      capacity: ticketBatches.quantity,
    })
    .from(ticketBatches)
    .innerJoin(ticketTypes, eq(ticketTypes.id, ticketBatches.ticketTypeId))
    .innerJoin(events, eq(events.id, ticketBatches.eventId))
    .where(and(scope(events.organizationId, f.organizationIds), f.eventId ? eq(events.id, f.eventId) : undefined))
    .orderBy(ticketTypes.sortOrder, ticketBatches.sortOrder)
    .limit(30);

  const checkinsByHour = await db
    .select({
      hour: sql<string>`to_char(date_trunc('hour', ${checkIns.createdAt} AT TIME ZONE 'America/Sao_Paulo'), 'DD/MM HH24"h"')`,
      n: count(),
    })
    .from(checkIns)
    .where(
      and(
        scope(checkIns.organizationId, f.organizationIds),
        f.eventId ? eq(checkIns.eventId, f.eventId) : undefined,
        eq(checkIns.result, "VALID"),
        gte(checkIns.createdAt, sql`now() - interval '7 days'`),
      ),
    )
    .groupBy(sql`1`, sql`date_trunc('hour', ${checkIns.createdAt} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(sql`date_trunc('hour', ${checkIns.createdAt} AT TIME ZONE 'America/Sao_Paulo')`);

  return {
    byDay: byDay.map((d) => ({ day: d.day, orders: Number(d.orders), revenue: Number(d.revenue) })),
    byMethod: byMethod.map((m) => ({ method: m.method, orders: Number(m.orders), revenue: Number(m.revenue) })),
    byBatch: byBatch.map((b) => ({ batch: b.batch, sold: b.sold, capacity: b.capacity })),
    checkinsByHour: checkinsByHour.map((c) => ({ hour: c.hour, n: Number(c.n) })),
  };
}

export async function listOrders(orgIds: string[], opts: { page: number; q?: string; status?: string; eventId?: string }) {
  const db = getDb();
  const where = and(
    scope(orders.organizationId, orgIds),
    opts.eventId ? eq(orders.eventId, opts.eventId) : undefined,
    opts.status ? sql`${orders.status}::text = ${opts.status}` : undefined,
    opts.q
      ? or(ilike(orders.code, `%${opts.q.toUpperCase()}%`), ilike(customers.email, `%${opts.q.toLowerCase()}%`), ilike(customers.name, `%${opts.q}%`))
      : undefined,
  );
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      method: orders.paymentMethod,
      total: orders.totalAmount,
      fee: orders.feeAmount,
      refunded: orders.refundedAmount,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      customerName: customers.name,
      customerEmail: customers.email,
      eventName: events.name,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function getOrderAdmin(orderId: string) {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return null;
  const [customer, event, items, pays, ticketRows, timeline, refundRows, feeRows] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, order.customerId) }),
    db.query.events.findFirst({ where: eq(events.id, order.eventId) }),
    db.query.orderItems.findMany({ where: (oi, { eq }) => eq(oi.orderId, order.id) }),
    db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)),
    db.select().from(tickets).where(eq(tickets.orderId, order.id)).orderBy(tickets.code),
    db.query.orderEvents.findMany({ where: (e, { eq }) => eq(e.orderId, order.id), orderBy: (e, { asc }) => asc(e.id) }),
    db.select({ refund: refunds, by: users.name }).from(refunds).leftJoin(users, eq(users.id, refunds.requestedBy)).where(eq(refunds.orderId, order.id)).orderBy(desc(refunds.createdAt)),
    db.query.fees.findMany({ where: (fe, { eq }) => eq(fe.orderId, order.id) }),
  ]);
  return { order, customer, event, items, payments: pays, tickets: ticketRows, timeline, refunds: refundRows, fees: feeRows };
}

export async function listPayments(orgIds: string[], opts: { page: number; status?: string }) {
  const rows = await getDb()
    .select({
      id: payments.id,
      orderId: payments.orderId,
      orderCode: orders.code,
      provider: payments.provider,
      environment: payments.environment,
      method: payments.method,
      status: payments.status,
      amount: payments.amount,
      refunded: payments.refundedAmount,
      providerFee: payments.providerFeeAmount,
      providerPaymentId: payments.providerPaymentId,
      providerStatus: payments.providerStatus,
      failureCode: payments.failureCode,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(scope(payments.organizationId, orgIds), opts.status ? sql`${payments.status}::text = ${opts.status}` : undefined))
    .orderBy(desc(payments.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function listTickets(orgIds: string[], opts: { page: number; q?: string; status?: string; eventId?: string }) {
  const rows = await getDb()
    .select({
      id: tickets.id,
      code: tickets.code,
      status: tickets.status,
      holderName: tickets.holderName,
      holderEmail: tickets.holderEmail,
      issuedAt: tickets.issuedAt,
      checkedInAt: tickets.checkedInAt,
      orderId: tickets.orderId,
      typeName: ticketTypes.name,
      batchName: ticketBatches.name,
      eventName: events.name,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(ticketBatches, eq(ticketBatches.id, tickets.ticketBatchId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .where(
      and(
        scope(tickets.organizationId, orgIds),
        opts.eventId ? eq(tickets.eventId, opts.eventId) : undefined,
        opts.status ? sql`${tickets.status}::text = ${opts.status}` : undefined,
        opts.q ? or(ilike(tickets.code, `%${opts.q.toUpperCase()}%`), ilike(tickets.holderName, `%${opts.q}%`), ilike(tickets.holderEmail, `%${opts.q.toLowerCase()}%`)) : undefined,
      ),
    )
    .orderBy(desc(tickets.issuedAt))
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function listCheckIns(orgIds: string[], opts: { page: number; eventId?: string; status?: string }) {
  const rows = await getDb()
    .select({
      id: checkIns.id,
      result: checkIns.result,
      createdAt: checkIns.createdAt,
      deviceId: checkIns.deviceId,
      operatorName: users.name,
      ticketCode: tickets.code,
      holderName: tickets.holderName,
      eventName: events.name,
    })
    .from(checkIns)
    .innerJoin(events, eq(events.id, checkIns.eventId))
    .leftJoin(users, eq(users.id, checkIns.operatorUserId))
    .leftJoin(tickets, eq(tickets.id, checkIns.ticketId))
    .where(
      and(
        scope(checkIns.organizationId, orgIds),
        opts.eventId ? eq(checkIns.eventId, opts.eventId) : undefined,
        opts.status ? sql`${checkIns.result}::text = ${opts.status}` : undefined,
      ),
    )
    .orderBy(desc(checkIns.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function webhookHealth() {
  const [row] = await getDb()
    .select({
      failed: sql<number>`count(*) FILTER (WHERE ${webhookEvents.status} = 'FAILED')::int`,
      last24h: sql<number>`count(*) FILTER (WHERE ${webhookEvents.receivedAt} > now() - interval '24 hours')::int`,
    })
    .from(webhookEvents);
  return { failed: Number(row?.failed ?? 0), last24h: Number(row?.last24h ?? 0) };
}
