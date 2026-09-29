/**
 * Coupons (ADR-0008). Everything is validated server-side; the client only sends a code.
 *
 * Usage counting mirrors inventory: an order RESERVES one use when created (atomic conditional
 * UPDATE guarded by a CHECK constraint), CONFIRMS it when paid and RELEASES it when it expires.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/server/db/client";
import { couponBatches, couponRedemptions, coupons, events, ticketBatches } from "@/server/db/schema";
import type { CouponLike } from "@/server/domain/fees";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { addOrderEvent } from "./order-events";

export type CouponRow = typeof coupons.$inferSelect;

export const normalizeCouponCode = (code: string) => code.trim().toUpperCase();

const invalid = (message = "Cupom inválido ou expirado.") => new AppError("COUPON_INVALID", message);

/** Loads and validates a coupon for an event. Throws COUPON_INVALID with a buyer-safe message. */
export async function resolveCoupon(
  db: DbOrTx,
  ctx: { organizationId: string; eventId: string; code: string; at: Date },
): Promise<{ row: CouponRow; pricing: CouponLike }> {
  const code = normalizeCouponCode(ctx.code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw invalid();
  const row = await db.query.coupons.findFirst({
    where: and(eq(coupons.organizationId, ctx.organizationId), eq(coupons.code, code)),
  });
  // Same message for "doesn't exist" and "inactive": codes can't be probed.
  if (!row || !row.isActive) throw invalid();
  if (row.eventId && row.eventId !== ctx.eventId) throw invalid();
  if (row.validFrom > ctx.at || (row.validUntil && row.validUntil <= ctx.at)) throw invalid();
  if (row.maxRedemptions !== null && row.redeemedCount >= row.maxRedemptions) throw invalid("Este cupom esgotou.");

  const batches = await db
    .select({ id: couponBatches.ticketBatchId })
    .from(couponBatches)
    .where(eq(couponBatches.couponId, row.id));
  return {
    row,
    pricing: {
      id: row.id,
      type: row.type,
      value: row.value,
      eligibleBatchIds: batches.length ? new Set(batches.map((b) => b.id)) : null,
    },
  };
}

/** Reserves one use of the coupon for an order. Must run inside the createOrder transaction. */
export async function reserveCoupon(
  tx: Tx,
  coupon: CouponRow,
  args: { orderId: string; customerId: string; discount: number },
) {
  // Serializes the same buyer using the same coupon on concurrent checkouts (any event).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`coupon:${coupon.id}:${args.customerId}`}, 0))`);
  const [{ used } = { used: 0 }] = await tx
    .select({ used: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .where(
      and(
        eq(couponRedemptions.couponId, coupon.id),
        eq(couponRedemptions.customerId, args.customerId),
        inArray(couponRedemptions.status, ["RESERVED", "CONFIRMED"]),
      ),
    );
  if (Number(used) >= coupon.perCustomerLimit) throw invalid("Você já usou este cupom.");

  const claimed = await tx
    .update(coupons)
    .set({ redeemedCount: sql`${coupons.redeemedCount} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(coupons.id, coupon.id),
        eq(coupons.isActive, true),
        sql`(${coupons.maxRedemptions} IS NULL OR ${coupons.redeemedCount} < ${coupons.maxRedemptions})`,
      ),
    )
    .returning({ id: coupons.id });
  if (claimed.length === 0) throw invalid("Este cupom esgotou.");

  await tx.insert(couponRedemptions).values({
    couponId: coupon.id,
    orderId: args.orderId,
    customerId: args.customerId,
    discountAmount: args.discount,
  });
}

/** Order expired/cancelled: give the use back. Idempotent. */
export async function releaseCouponForOrder(tx: Tx, orderId: string) {
  const [r] = await tx
    .update(couponRedemptions)
    .set({ status: "RELEASED", updatedAt: new Date() })
    .where(and(eq(couponRedemptions.orderId, orderId), eq(couponRedemptions.status, "RESERVED")))
    .returning();
  if (!r) return;
  await tx
    .update(coupons)
    .set({ redeemedCount: sql`${coupons.redeemedCount} - 1`, updatedAt: new Date() })
    .where(and(eq(coupons.id, r.couponId), sql`${coupons.redeemedCount} > 0`));
}

/** Order paid: the use becomes permanent. Handles late payments after a release. Idempotent. */
export async function confirmCouponForOrder(tx: Tx, orderId: string) {
  const r = await tx.query.couponRedemptions.findFirst({ where: eq(couponRedemptions.orderId, orderId) });
  if (!r || r.status === "CONFIRMED") return;
  if (r.status === "RELEASED") {
    // Late payment: the buyer already paid the discounted price, so the use must be honored.
    const back = await tx
      .update(coupons)
      .set({ redeemedCount: sql`${coupons.redeemedCount} + 1`, updatedAt: new Date() })
      .where(and(eq(coupons.id, r.couponId), sql`(${coupons.maxRedemptions} IS NULL OR ${coupons.redeemedCount} < ${coupons.maxRedemptions})`))
      .returning({ id: coupons.id });
    if (back.length === 0) {
      logger.warn("coupon.late_payment_over_limit", { order_id: orderId, coupon_id: r.couponId });
      await addOrderEvent(tx, orderId, "COUPON_OVER_LIMIT_LATE_PAYMENT", { couponId: r.couponId });
    }
  }
  await tx
    .update(couponRedemptions)
    .set({ status: "CONFIRMED", updatedAt: new Date() })
    .where(eq(couponRedemptions.id, r.id));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface CouponInput {
  organizationId: string;
  eventId?: string;
  code: string;
  description?: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  maxRedemptions?: number;
  perCustomerLimit: number;
  validFrom: Date;
  validUntil?: Date;
  batchIds: string[];
}

export async function createCoupon(input: CouponInput, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const code = normalizeCouponCode(input.code);
    if (input.batchIds.length && !input.eventId) {
      throw new AppError("VALIDATION_ERROR", "Restringir por lote exige escolher o evento.");
    }
    if (input.eventId) {
      const ev = await tx.query.events.findFirst({ where: eq(events.id, input.eventId), columns: { organizationId: true } });
      if (ev?.organizationId !== input.organizationId) throw new AppError("NOT_FOUND", "Evento não encontrado.");
      if (input.batchIds.length) {
        const found = await tx
          .select({ id: ticketBatches.id })
          .from(ticketBatches)
          .where(and(eq(ticketBatches.eventId, input.eventId), inArray(ticketBatches.id, input.batchIds)));
        if (found.length !== new Set(input.batchIds).size) throw new AppError("VALIDATION_ERROR", "Lote não pertence ao evento.");
      }
    }
    let coupon: CouponRow;
    try {
      [coupon] = (await tx
        .insert(coupons)
        .values({
          organizationId: input.organizationId,
          eventId: input.eventId ?? null,
          code,
          description: input.description ?? null,
          type: input.type,
          value: input.value,
          maxRedemptions: input.maxRedemptions ?? null,
          perCustomerLimit: input.perCustomerLimit,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          createdBy: actorUserId,
        })
        .returning()) as [CouponRow];
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === "23505") {
        throw new AppError("CONFLICT", "Já existe um cupom com este código.");
      }
      throw e;
    }
    if (input.batchIds.length) {
      await tx.insert(couponBatches).values(input.batchIds.map((b) => ({ couponId: coupon.id, ticketBatchId: b })));
    }
    await audit(tx, {
      action: "coupon.create",
      entityType: "coupon",
      entityId: coupon.id,
      organizationId: input.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { code, type: input.type, value: input.value, maxRedemptions: input.maxRedemptions, batchIds: input.batchIds },
    });
    return coupon;
  });
}

export async function setCouponActive(couponId: string, active: boolean, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const [c] = await tx.update(coupons).set({ isActive: active, updatedAt: new Date() }).where(eq(coupons.id, couponId)).returning();
    if (!c) throw new AppError("NOT_FOUND", "Cupom não encontrado.");
    await audit(tx, {
      action: "coupon.update",
      entityType: "coupon",
      entityId: c.id,
      organizationId: c.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { isActive: active },
    });
    return c;
  });
}

export async function listCoupons(orgIds: string[]) {
  if (orgIds.length === 0) return [];
  return getDb()
    .select({
      coupon: coupons,
      confirmed: sql<number>`(SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = ${coupons.id} AND r.status = 'CONFIRMED')`,
      discountGiven: sql<number>`(SELECT COALESCE(SUM(r.discount_amount),0)::int FROM coupon_redemptions r WHERE r.coupon_id = ${coupons.id} AND r.status = 'CONFIRMED')`,
      eventName: sql<string | null>`(SELECT name FROM events e WHERE e.id = ${coupons.eventId})`,
    })
    .from(coupons)
    .where(inArray(coupons.organizationId, orgIds))
    .orderBy(desc(coupons.createdAt))
    .limit(200);
}

export async function couponOrganizationId(couponId: string) {
  const c = await getDb().query.coupons.findFirst({ where: eq(coupons.id, couponId), columns: { organizationId: true } });
  return c?.organizationId ?? null;
}
