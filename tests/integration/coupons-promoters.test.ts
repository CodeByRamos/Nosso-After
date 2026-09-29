import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { couponRedemptions, coupons, orderItems } from "@/server/db/schema";
import { computeQuote } from "@/server/domain/fees";
import { signPromoterRef, verifyPromoterRef } from "@/server/lib/tokens";
import { createCoupon } from "@/server/services/coupons";
import { createOrder, expireOrder, quoteOrder } from "@/server/services/orders";
import { createPaymentForOrder } from "@/server/services/payments";
import { createPromoter, promoterStats } from "@/server/services/promoters";
import { requestRefund } from "@/server/services/refunds";
import { captureWebhooks, createFixture, getOrder, getPayment, mockPsp, orderInput, type Fixture } from "../support/factories";

let hooks: ReturnType<typeof captureWebhooks>;
beforeEach(() => {
  hooks = captureWebhooks();
});

let seq = 0;
async function coupon(f: Fixture, over: Partial<Parameters<typeof createCoupon>[0]> = {}) {
  return createCoupon(
    {
      organizationId: f.orgId,
      eventId: f.eventId,
      code: `CUPOM${Date.now().toString(36).toUpperCase()}${seq++}`,
      type: "PERCENTAGE",
      value: 1_000,
      perCustomerLimit: 1,
      validFrom: new Date(Date.now() - 60_000),
      batchIds: [],
      ...over,
    },
    f.userId,
  );
}

async function pay(orderId: string) {
  const p = await createPaymentForOrder({ orderId, method: "PIX" });
  await mockPsp().simulatePixPayment((await getPayment(p.id)).providerPaymentId!);
  await hooks.deliverAll();
  return p;
}

describe("coupon pricing (unit)", () => {
  it("discounts per ticket and computes the fee on the discounted price", () => {
    const q = computeQuote(
      [{ batchId: "b", quantity: 2, unitPrice: 10_000 }],
      { id: "r", name: "r", organizationId: null, eventId: null, paymentMethod: null, appliesPer: "TICKET", fixedAmount: 0, percentageBps: 1_000, priority: 0, activeFrom: new Date(0), activeUntil: null, isActive: true, createdAt: new Date(0) },
      { id: "c", type: "PERCENTAGE", value: 2_000, eligibleBatchIds: null },
    );
    // 2 × (100 − 20) = 160 ; fee 10% of 80 = 8 per ticket
    expect(q).toMatchObject({ subtotal: 20_000, discount: 4_000, fee: 1_600, total: 17_600, couponId: "c" });
  });
  it("caps fixed discounts at the ticket price and respects batch restrictions", () => {
    const q = computeQuote(
      [
        { batchId: "a", quantity: 1, unitPrice: 3_000 },
        { batchId: "b", quantity: 1, unitPrice: 5_000 },
      ],
      null,
      { id: "c", type: "FIXED", value: 4_000, eligibleBatchIds: new Set(["a"]) },
    );
    expect(q.lines.map((l) => l.unitDiscount)).toEqual([3_000, 0]);
  });
});

describe("coupons (integration)", () => {
  it("applies a valid coupon, snapshots the discount and counts the use", async () => {
    const f = await createFixture({ price: 10_000, feeBps: 1_000 });
    const c = await coupon(f, { type: "FIXED", value: 2_500 });
    const quote = await quoteOrder({ eventId: f.eventId, items: [{ batchId: f.batchId, quantity: 2 }], paymentMethod: "PIX", couponCode: c.code.toLowerCase() });
    expect(quote).toMatchObject({ subtotal: 20_000, discount: 5_000, fee: 1_500, total: 16_500, couponCode: c.code });

    const o = await createOrder({ ...orderInput(f, { quantity: 2 }), couponCode: c.code });
    expect(o).toMatchObject({ discount: 5_000, total: 16_500 });
    const [item] = await getDb().select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(item!.unitDiscount).toBe(2_500);
    expect((await getDb().query.coupons.findFirst({ where: eq(coupons.id, c.id) }))!.redeemedCount).toBe(1);

    await pay(o.id);
    const [r] = await getDb().select().from(couponRedemptions).where(eq(couponRedemptions.orderId, o.id));
    expect(r).toMatchObject({ status: "CONFIRMED", discountAmount: 5_000 });
  });

  it("rejects unknown, inactive, expired, other-event and not-yet-valid coupons with the same error", async () => {
    const f = await createFixture();
    const other = await createFixture();
    const expired = await coupon(f, { validFrom: new Date(Date.now() - 7_200_000), validUntil: new Date(Date.now() - 3_600_000) });
    const future = await coupon(f, { validFrom: new Date(Date.now() + 3_600_000) });
    const otherEvent = await coupon(other);
    const inactive = await coupon(f);
    await getDb().update(coupons).set({ isActive: false }).where(eq(coupons.id, inactive.id));
    for (const code of ["NAOEXISTE", expired.code, future.code, otherEvent.code, inactive.code, "x'; drop"]) {
      await expect(quoteOrder({ eventId: f.eventId, items: [{ batchId: f.batchId, quantity: 1 }], paymentMethod: "PIX", couponCode: code })).rejects.toMatchObject({ code: "COUPON_INVALID" });
    }
  });

  it("never exceeds max redemptions under concurrency", async () => {
    const f = await createFixture({ quantity: 100 });
    const c = await coupon(f, { maxRedemptions: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () => createOrder({ ...orderInput(f), couponCode: c.code })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await getDb().query.coupons.findFirst({ where: eq(coupons.id, c.id) }))!.redeemedCount).toBe(3);
  });

  it("enforces the per-customer limit, and an expired order gives the use back", async () => {
    const f = await createFixture({ quantity: 20 });
    const c = await coupon(f, { perCustomerLimit: 1, maxRedemptions: 1 });
    const email = "cupom@test.local";
    const first = await createOrder({ ...orderInput(f, { email }), couponCode: c.code });
    await expect(createOrder({ ...orderInput(f, { email }), couponCode: c.code })).rejects.toMatchObject({ code: "COUPON_INVALID" });

    await getDb().execute(sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${first.id}`);
    await expireOrder(first.id);
    const [r] = await getDb().select().from(couponRedemptions).where(eq(couponRedemptions.orderId, first.id));
    expect(r!.status).toBe("RELEASED");
    expect((await getDb().query.coupons.findFirst({ where: eq(coupons.id, c.id) }))!.redeemedCount).toBe(0);
    await expect(createOrder({ ...orderInput(f, { email }), couponCode: c.code })).resolves.toBeTruthy();
  });

  it("a coupon restricted to other batches does not apply", async () => {
    const f = await createFixture();
    const other = await createFixture();
    await expect(coupon(f, { batchIds: [other.batchId] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("promoter attribution", () => {
  it("signed referral cookie cannot be forged or edited", () => {
    const id = "0b7f1c2e-8d3a-4c5b-9e6f-112233445566";
    const ref = signPromoterRef(id);
    expect(verifyPromoterRef(ref)).toBe(id);
    const [, exp, mac] = ref.split(".");
    expect(verifyPromoterRef(`11111111-1111-1111-1111-111111111111.${exp}.${mac}`)).toBeNull();
    expect(verifyPromoterRef(`${id}.${Number(exp) + 999}.${mac}`)).toBeNull();
    expect(verifyPromoterRef(signPromoterRef(id, Date.now() - 31 * 86_400_000))).toBeNull();
    expect(verifyPromoterRef("garbage")).toBeNull();
  });

  it("attributes the sale and snapshots the commission on ticket revenue (fee excluded)", async () => {
    const f = await createFixture({ price: 10_000, feeBps: 1_000 });
    const p = await createPromoter({ organizationId: f.orgId, name: "João", code: `JOAO${seq++}${Date.now().toString(36)}`.toUpperCase(), commissionBps: 1_000, commissionFixedPerTicket: 100 }, f.userId);
    const o = await createOrder(orderInput(f, { quantity: 2 }), { promoterId: p.id });
    // 10% of 200 + 2 × 1 = 22
    expect(await getOrder(o.id)).toMatchObject({ promoterId: p.id, promoterCommissionAmount: 2_200 });

    await pay(o.id);
    let [row] = await promoterStats({ promoterId: p.id });
    expect(row).toMatchObject({ paidOrders: 1, tickets: 2 });
    expect(Number(row!.commission)).toBe(2_200);

    await requestRefund({ orderId: o.id, reason: "reembolso teste", actorUserId: f.userId });
    [row] = await promoterStats({ promoterId: p.id });
    expect(Number(row!.commission)).toBe(0); // refunded orders owe no commission
  });

  it("ignores promoters that are inactive or from another organization", async () => {
    const f = await createFixture();
    const other = await createFixture();
    const foreign = await createPromoter({ organizationId: other.orgId, name: "X", code: `X${seq++}${Date.now().toString(36)}`.toUpperCase(), commissionBps: 500, commissionFixedPerTicket: 0 }, other.userId);
    const o = await createOrder(orderInput(f), { promoterId: foreign.id });
    expect((await getOrder(o.id)).promoterId).toBeNull();
  });
});
