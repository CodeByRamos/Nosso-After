import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { orders } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { createOrder, expireOrder, quoteOrder } from "@/server/services/orders";
import { createFixture, expectDbError, getBatch, getOrder, orderInput } from "../support/factories";

describe("order creation & inventory reservation", () => {
  it("creates an order, snapshots the fee and reserves stock", async () => {
    const f = await createFixture({ price: 10_000, quantity: 10, feeFixed: 790 });
    const order = await createOrder(orderInput(f, { quantity: 2 }));
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", subtotal: 20_000, fee: 1_580, total: 21_580 });
    const batch = await getBatch(f.batchId);
    expect(batch).toMatchObject({ reservedQuantity: 2, soldQuantity: 0 });
    const quote = await quoteOrder({ eventId: f.eventId, items: [{ batchId: f.batchId, quantity: 1 }], paymentMethod: "PIX" });
    expect(quote).toMatchObject({ subtotal: 10_000, fee: 790, total: 10_790 });
  });

  it("refuses when not enough stock", async () => {
    const f = await createFixture({ quantity: 1 });
    await createOrder(orderInput(f));
    await expect(createOrder(orderInput(f))).rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("enforces max per customer across open orders", async () => {
    const f = await createFixture({ quantity: 50, maxPerCustomer: 3 });
    const email = "same@test.local";
    await createOrder(orderInput(f, { email, quantity: 2 }));
    await expect(createOrder(orderInput(f, { email, quantity: 2 }))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(createOrder(orderInput(f, { email, quantity: 1 }))).resolves.toBeTruthy();
  });

  it("never oversells under concurrency (40 buyers, 7 tickets)", async () => {
    const f = await createFixture({ quantity: 7 });
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => createOrder(orderInput(f))));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(7);
    expect(failed.every((r) => r.reason instanceof AppError && r.reason.code === "SOLD_OUT")).toBe(true);
    const batch = await getBatch(f.batchId);
    expect(batch.reservedQuantity + batch.soldQuantity).toBe(7);
  });

  it("the database CHECK blocks overselling even if the application misbehaves", async () => {
    const f = await createFixture({ quantity: 2 });
    await expectDbError(getDb().execute(sql`UPDATE ticket_batches SET sold_quantity = 3 WHERE id = ${f.batchId}`), /ticket_batches_capacity_ck/);
  });

  it("expiring an unpaid order releases its reservation exactly once", async () => {
    const f = await createFixture({ quantity: 5 });
    const o = await createOrder(orderInput(f, { quantity: 3 }));
    await getDb().execute(sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${o.id}`);
    const [a, b] = await Promise.all([expireOrder(o.id), expireOrder(o.id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await getOrder(o.id)).toMatchObject({ status: "EXPIRED", inventoryStatus: "RELEASED" });
    expect((await getBatch(f.batchId)).reservedQuantity).toBe(0);
  });

  it("rejects closed sales and unknown batches", async () => {
    const f = await createFixture();
    await getDb().execute(sql`UPDATE events SET status = 'PAUSED' WHERE id = ${f.eventId}`);
    await expect(createOrder(orderInput(f))).rejects.toMatchObject({ code: "SALES_CLOSED" });
    const g = await createFixture();
    await expect(
      createOrder({ ...orderInput(g), items: [{ batchId: f.batchId, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("orders keep total = subtotal - discount + fee at the database level", async () => {
    const f = await createFixture();
    const o = await createOrder(orderInput(f));
    await expectDbError(getDb().execute(sql`UPDATE ${orders} SET total_amount = 1 WHERE id = ${o.id}`), /orders_total_ck/);
  });
});
