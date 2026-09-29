import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { emailOutbox, mockPspTransactions, webhookEvents } from "@/server/db/schema";
import { signMockWebhook } from "@/server/payments/providers/mock/mock-provider";
import { expireDueOrders } from "@/server/services/jobs";
import { createOrder } from "@/server/services/orders";
import { createPaymentForOrder, syncPaymentFromProvider } from "@/server/services/payments";
import { receiveWebhook } from "@/server/services/webhooks";
import { captureWebhooks, createFixture, deliver, getBatch, getOrder, getPayment, mockPsp, orderInput, ticketsOf, waitFor } from "../support/factories";

let hooks: ReturnType<typeof captureWebhooks>;
beforeEach(() => {
  hooks = captureWebhooks();
});

async function pixOrder(quantity = 1, fixture?: Awaited<ReturnType<typeof createFixture>>) {
  const f = fixture ?? (await createFixture({ price: 5_000, quantity: 20, feeBps: 1_000 }));
  const order = await createOrder(orderInput(f, { quantity }));
  const payment = await createPaymentForOrder({ orderId: order.id, method: "PIX" });
  return { f, order, payment };
}

describe("Pix payment lifecycle", () => {
  it("creates a pending Pix with QR code — never PAID from the synchronous response", async () => {
    const { order, payment } = await pixOrder(2);
    expect(payment).toMatchObject({ status: "PENDING", method: "PIX", environment: "DEMO", amount: 11_000 });
    expect(payment.pixQrCode).toMatch(/^DEMO-/);
    expect((await getOrder(order.id)).status).toBe("AWAITING_PAYMENT");
    expect(await ticketsOf(order.id)).toHaveLength(0);
  });

  it("re-requesting Pix for the same order returns the same charge (no double charge)", async () => {
    const { order, payment } = await pixOrder();
    const again = await createPaymentForOrder({ orderId: order.id, method: "PIX" });
    expect(again.id).toBe(payment.id);
    const psp = await getDb().select().from(mockPspTransactions).where(eq(mockPspTransactions.externalReference, payment.id));
    expect(psp).toHaveLength(1);
  });

  it("webhook → authoritative sync → PAID → inventory committed → tickets issued → e-mail queued", async () => {
    const { f, order, payment } = await pixOrder(2);
    const p = await getPayment(payment.id);
    await mockPsp().simulatePixPayment(p.providerPaymentId!);
    const [res] = await hooks.deliverAll();
    expect(res).toMatchObject({ status: 200, body: { received: true, processed: true } });

    expect(await getPayment(payment.id)).toMatchObject({ status: "PAID" });
    expect(await getOrder(order.id)).toMatchObject({ status: "PAID", inventoryStatus: "COMMITTED" });
    expect(await getBatch(f.batchId)).toMatchObject({ soldQuantity: 2, reservedQuantity: 0 });
    const tickets = await ticketsOf(order.id);
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.status === "VALID" && t.holderEmail.endsWith("@test.local"))).toBe(true);
    const mails = await getDb().select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, `order_confirmed:${order.id}`));
    expect(mails).toHaveLength(1);
  });

  it("duplicate webhooks are ignored and never issue tickets twice", async () => {
    const { order, payment } = await pixOrder(1);
    await mockPsp().simulatePixPayment((await getPayment(payment.id)).providerPaymentId!);
    const delivery = hooks.queue.shift()!;
    const first = await deliver(delivery);
    const second = await deliver(delivery);
    expect(first.body).toMatchObject({ processed: true });
    expect(second.body).toMatchObject({ duplicate: true });
    // even a *new* notification for the same payment is harmless (idempotent state machine)
    await mockPsp().notify((await getPayment(payment.id)).providerPaymentId!, "payment.updated");
    await hooks.deliverAll();
    expect(await ticketsOf(order.id)).toHaveLength(1);
  });

  it("rejects webhooks with invalid, missing or stale signatures without persisting them", async () => {
    const { payment } = await pixOrder();
    const pspId = (await getPayment(payment.id)).providerPaymentId!;
    const good = mockPsp().buildWebhook(pspId, "payment.updated");
    const before = await getDb().select({ n: sql<number>`count(*)::int` }).from(webhookEvents);

    const tampered = await deliver({ ...good, rawBody: good.rawBody.replace("payment.updated", "payment.approved") });
    const unsigned = await receiveWebhook("mock", { headers: new Headers(), rawBody: good.rawBody, url: new URL("http://x") });
    const staleTs = Math.floor(Date.now() / 1000) - 3600;
    const stale = await deliver({ rawBody: good.rawBody, headers: { "x-mock-signature": signMockWebhook(process.env.MOCK_PSP_WEBHOOK_SECRET!, good.rawBody, staleTs) } });
    const wrongSecret = await deliver({ rawBody: good.rawBody, headers: { "x-mock-signature": signMockWebhook("another-secret-another-secret-123", good.rawBody) } });
    const unknownProvider = await receiveWebhook("stripe", { headers: new Headers(), rawBody: "{}", url: new URL("http://x") });

    for (const r of [tampered, unsigned, stale, wrongSecret]) expect(r.status).toBe(401);
    expect(unknownProvider.status).toBe(404);
    const after = await getDb().select({ n: sql<number>`count(*)::int` }).from(webhookEvents);
    expect(after[0]!.n).toBe(before[0]!.n);
    expect((await getPayment(payment.id)).status).toBe("PENDING");
  });

  it("a forged 'paid' payload cannot confirm a payment the PSP still reports as pending", async () => {
    const { order, payment } = await pixOrder();
    // Correctly signed delivery, but the PSP was never paid: the sync reads the real state.
    await mockPsp().notify((await getPayment(payment.id)).providerPaymentId!, "payment.updated");
    await hooks.deliverAll();
    expect((await getPayment(payment.id)).status).toBe("PENDING");
    expect((await getOrder(order.id)).status).toBe("AWAITING_PAYMENT");
  });

  it("expiry job cancels the stale Pix and releases stock; a late payment is still honored if stock remains", async () => {
    const { f, order, payment } = await pixOrder(1);
    await getDb().execute(sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.id}`);
    await expireDueOrders();
    expect(await getOrder(order.id)).toMatchObject({ status: "EXPIRED", inventoryStatus: "RELEASED" });
    expect((await getPayment(payment.id)).status).toBe("CANCELLED");
    expect((await getBatch(f.batchId)).reservedQuantity).toBe(0);

    // Buyer paid anyway (PSP accepted it): the PSP is the truth, inventory is re-acquired.
    await getDb().update(mockPspTransactions).set({ status: "pending" }).where(eq(mockPspTransactions.externalReference, payment.id));
    await mockPsp().simulatePixPayment((await getPayment(payment.id)).providerPaymentId!);
    await hooks.deliverAll();
    expect(await getOrder(order.id)).toMatchObject({ status: "PAID", inventoryStatus: "COMMITTED" });
    expect(await ticketsOf(order.id)).toHaveLength(1);
  });

  it("late payment without remaining stock goes to REFUND_PENDING and issues no tickets", async () => {
    const f = await createFixture({ quantity: 1 });
    const { order, payment } = await pixOrder(1, f);
    await getDb().execute(sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.id}`);
    await expireDueOrders();
    await createOrder(orderInput(f)); // someone else takes the last ticket
    await getDb().update(mockPspTransactions).set({ status: "pending" }).where(eq(mockPspTransactions.externalReference, payment.id));
    await mockPsp().simulatePixPayment((await getPayment(payment.id)).providerPaymentId!);
    await hooks.deliverAll();
    expect((await getOrder(order.id)).status).toBe("REFUND_PENDING");
    expect(await ticketsOf(order.id)).toHaveLength(0);
    const batch = await getBatch(f.batchId);
    expect(batch.soldQuantity + batch.reservedQuantity).toBe(1);
  });

  it("refuses a PSP object whose amount differs from what we charged", async () => {
    const { order, payment } = await pixOrder();
    await getDb().update(mockPspTransactions).set({ amount: 1, status: "approved" }).where(eq(mockPspTransactions.externalReference, payment.id));
    await expect(syncPaymentFromProvider(payment.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getPayment(payment.id)).toMatchObject({ status: "PENDING", failureCode: "INTEGRITY_MISMATCH" });
    expect((await getOrder(order.id)).status).toBe("AWAITING_PAYMENT");
  });
});

describe("card payments (tokenized)", () => {
  it("approved card: PROCESSING until the PSP notification confirms it", async () => {
    const f = await createFixture({ price: 8_000 });
    const order = await createOrder(orderInput(f, { paymentMethod: "CREDIT_CARD" }));
    const payment = await createPaymentForOrder({
      orderId: order.id,
      method: "CREDIT_CARD",
      card: { token: "mock_tok_approve", paymentMethodId: "demo", installments: 2 },
    });
    expect(payment.status).toBe("PROCESSING");
    expect((await getOrder(order.id)).status).toBe("AWAITING_PAYMENT");
    await waitFor(() => hooks.queue.length > 0);
    await hooks.deliverAll();
    expect(await getPayment(payment.id)).toMatchObject({ status: "PAID", installments: 2, cardLastFour: "0000" });
    expect(await ticketsOf(order.id)).toHaveLength(1);
  });

  it("declined card: FAILED, order keeps its reservation so the buyer can retry", async () => {
    const f = await createFixture({ quantity: 3 });
    const order = await createOrder(orderInput(f, { paymentMethod: "CREDIT_CARD" }));
    const declined = await createPaymentForOrder({
      orderId: order.id,
      method: "CREDIT_CARD",
      card: { token: "mock_tok_decline", paymentMethodId: "demo", installments: 1 },
    });
    expect(declined).toMatchObject({ status: "FAILED" });
    expect(await getOrder(order.id)).toMatchObject({ status: "AWAITING_PAYMENT", inventoryStatus: "RESERVED" });
    expect(await ticketsOf(order.id)).toHaveLength(0);

    const retry = await createPaymentForOrder({
      orderId: order.id,
      method: "CREDIT_CARD",
      card: { token: "mock_tok_approve", paymentMethodId: "demo", installments: 1 },
    });
    expect(retry.id).not.toBe(declined.id);
    await waitFor(() => hooks.queue.length > 0);
    await hooks.deliverAll();
    expect((await getOrder(order.id)).status).toBe("PAID");
  });

  it("rejects a payment method different from the order's", async () => {
    const f = await createFixture();
    const order = await createOrder(orderInput(f, { paymentMethod: "PIX" }));
    await expect(
      createPaymentForOrder({ orderId: order.id, method: "CREDIT_CARD", card: { token: "mock_tok_approve", paymentMethodId: "demo", installments: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
