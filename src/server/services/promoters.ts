/**
 * Promoters (ADR-0008): code/link attribution + commission snapshot per order.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db/client";
import { events, orders, promoters } from "@/server/db/schema";
import { computeCommission } from "@/server/domain/fees";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";

export type PromoterRow = typeof promoters.$inferSelect;

export const normalizePromoterCode = (code: string) => code.trim().toUpperCase();

/** Active promoter by public code (used by /r/<code>). */
export async function findActivePromoterByCode(code: string) {
  const c = normalizePromoterCode(code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(c)) return null;
  const p = await getDb().query.promoters.findFirst({ where: and(eq(promoters.code, c), eq(promoters.isActive, true)) });
  return p ?? null;
}

/**
 * Promoter eligible to receive the sale: must exist, be active and belong to the event's
 * organization. Anything else is silently ignored (attribution never blocks a purchase).
 */
export async function eligiblePromoter(db: DbOrTx, promoterId: string | null, organizationId: string) {
  if (!promoterId) return null;
  const p = await db.query.promoters.findFirst({ where: eq(promoters.id, promoterId) });
  if (!p || !p.isActive || p.organizationId !== organizationId) return null;
  return p;
}

export function commissionFor(p: PromoterRow, ticketRevenue: number, tickets: number) {
  return computeCommission(
    { commissionBps: p.commissionBps, commissionFixedPerTicket: p.commissionFixedPerTicket },
    ticketRevenue,
    tickets,
  );
}

/** Where /r/<code> sends the visitor: the organization's next event on sale, else home. */
export async function landingPathFor(p: PromoterRow) {
  const [ev] = await getDb()
    .select({ slug: events.slug })
    .from(events)
    .where(and(eq(events.organizationId, p.organizationId), eq(events.status, "PUBLISHED"), sql`${events.endsAt} > now()`))
    .orderBy(events.startsAt)
    .limit(1);
  return ev ? `/eventos/${ev.slug}` : "/";
}

export interface PromoterInput {
  organizationId: string;
  name: string;
  code: string;
  commissionBps: number;
  commissionFixedPerTicket: number;
  userId?: string | null;
}

export async function createPromoter(input: PromoterInput, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    let row: PromoterRow;
    try {
      [row] = (await tx
        .insert(promoters)
        .values({ ...input, code: normalizePromoterCode(input.code), createdBy: actorUserId })
        .returning()) as [PromoterRow];
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw new AppError("CONFLICT", "Código já em uso.");
      throw e;
    }
    await audit(tx, {
      action: "promoter.create",
      entityType: "promoter",
      entityId: row.id,
      organizationId: row.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { code: row.code, commissionBps: row.commissionBps, commissionFixedPerTicket: row.commissionFixedPerTicket },
    });
    return row;
  });
}

export async function setPromoterActive(id: string, active: boolean, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const [p] = await tx.update(promoters).set({ isActive: active, updatedAt: new Date() }).where(eq(promoters.id, id)).returning();
    if (!p) throw new AppError("NOT_FOUND", "Promoter não encontrado.");
    await audit(tx, {
      action: "promoter.update",
      entityType: "promoter",
      entityId: p.id,
      organizationId: p.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { isActive: active },
    });
    return p;
  });
}

/**
 * Sales per promoter. Commission is only owed on orders that are still paid; fully refunded
 * orders drop out, partially refunded ones are prorated by the ticket revenue kept.
 */
const COMMISSION_OWED = sql`
  CASE
    WHEN ${orders.status} = 'PAID' THEN ${orders.promoterCommissionAmount}
    WHEN ${orders.status} = 'PARTIALLY_REFUNDED' AND ${orders.totalAmount} > 0
      THEN FLOOR(${orders.promoterCommissionAmount}::numeric * (${orders.totalAmount} - ${orders.refundedAmount}) / ${orders.totalAmount})
    ELSE 0
  END`;

export async function promoterStats(filter: { orgIds?: string[]; promoterId?: string }) {
  const db = getDb();
  const where = filter.promoterId
    ? eq(promoters.id, filter.promoterId)
    : filter.orgIds?.length
      ? inArray(promoters.organizationId, filter.orgIds)
      : sql`false`;
  return db
    .select({
      promoter: promoters,
      paidOrders: sql<number>`count(${orders.id}) FILTER (WHERE ${orders.paidAt} IS NOT NULL)::int`,
      tickets: sql<number>`COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id WHERE o2.promoter_id = ${promoters.id} AND o2.status IN ('PAID','PARTIALLY_REFUNDED')),0)::int`,
      revenue: sql<number>`COALESCE(SUM(${orders.subtotalAmount} - ${orders.discountAmount}) FILTER (WHERE ${orders.status} IN ('PAID','PARTIALLY_REFUNDED')),0)::bigint`,
      commission: sql<number>`COALESCE(SUM(${COMMISSION_OWED}),0)::bigint`,
    })
    .from(promoters)
    .leftJoin(orders, eq(orders.promoterId, promoters.id))
    .where(where)
    .groupBy(promoters.id)
    .orderBy(desc(promoters.createdAt))
    .limit(200);
}

export async function promoterOrganizationId(id: string) {
  const p = await getDb().query.promoters.findFirst({ where: eq(promoters.id, id), columns: { organizationId: true } });
  return p?.organizationId ?? null;
}
