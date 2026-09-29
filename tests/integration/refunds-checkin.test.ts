import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { auditLogs, checkIns, refunds } from "@/server/db/schema";
import { signTicketQr } from "@/server/lib/tokens";
import { performCheckIn } from "@/server/services/checkin";
import { createOrder } from "@/server/services/orders";
import { createPaymentForOrder } from "@/server/services/payments";
import { requestRefund } from "@/server/services/refunds";
import { captureWebhooks, createFixture, expectDbError, getBatch, getOrder, getPayment, mockPsp, orderInput, ticketsOf } from "../support/factories";

let hooks: ReturnType<typeof captureWebhooks>;
beforeEach(() => {
  hooks = captureWebhooks();
});

async function paidOrder(quantity = 2, opts: Parameters<typeof createFixture>[0] = {}) {
  const f = await createFixture({ price: 5_000, quantity: 20, feeFixed: 500, ...opts });
  const order = await createOrder(orderInput(f, { quantity }));
  const payment = await createPaymentForOrder({ orderId: order.id, method: "PIX" });
  await mockPsp().simulatePixPayment((await getPayment(payment.id)).providerPaymentId!);
  await hooks.deliverAll();
  return { f, order, payment, tickets: await ticketsOf(order.id) };
}

describe("refunds", () => {
  it("full refund goes through the PSP, then invalidates tickets and returns capacity", async () => {
    const { f, order, payment } = await paidOrder(2);
    const refund = await requestRefund({ orderId: order.id, reason: "Cliente desistiu", actorUserId: f.userId });
    expect(refund.status).toBe("SUCCEEDED"); // confirmed by the authoritative PSP read-back
    expect(await getPayment(payment.id)).toMatchObject({ status: "REFUNDED", refundedAmount: 11_000 });
    expect(await getOrder(order.id)).toMatchObject({ status: "REFUNDED", refundedAmount: 11_000 });
    expect((await ticketsOf(order.id)).every((t) => t.status === "REFUNDED")).toBe(true);
    expect((await getBatch(f.batchId)).soldQuantity).toBe(0);
    const trail = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, refund.id));
    expect(trail.map((a) => a.action)).toEqual(expect.arrayContaining(["refund.request", "refund.succeeded"]));
  });

  it("partial refund keeps tickets valid and allows a second partial up to the balance", async () => {
    const { f, order, payment } = await paidOrder(2);
    await requestRefund({ orderId: order.id, amount: 3_000, reason: "Ajuste parcial", actorUserId: f.userId });
    expect(await getPayment(payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmount: 3_000 });
    expect(await getOrder(order.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmount: 3_000 });
    expect((await ticketsOf(order.id)).every((t) => t.status === "VALID")).toBe(true);

    await expect(requestRefund({ orderId: order.id, amount: 9_000, reason: "Excede saldo", actorUserId: f.userId })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await requestRefund({ orderId: order.id, amount: 8_000, reason: "Restante", actorUserId: f.userId });
    expect(await getPayment(payment.id)).toMatchObject({ status: "REFUNDED", refundedAmount: 11_000 });
    expect((await getOrder(order.id)).status).toBe("REFUNDED");
  });

  it("refuses refunds for unpaid orders and full refunds after check-in", async () => {
    const f = await createFixture();
    const unpaid = await createOrder(orderInput(f));
    await expect(requestRefund({ orderId: unpaid.id, reason: "teste", actorUserId: f.userId })).rejects.toMatchObject({ code: "INVALID_STATE" });

    const { order, tickets, f: g } = await paidOrder(1);
    await performCheckIn({ qr: signTicketQr(tickets[0]!.id, 1), eventId: g.eventId, organizationId: g.orgId, operatorUserId: g.userId });
    await expect(requestRefund({ orderId: order.id, reason: "depois do show", actorUserId: g.userId })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await getDb().select().from(refunds).where(eq(refunds.orderId, order.id))).toHaveLength(0);
  });

  it("the audit log is append-only", async () => {
    const [row] = await getDb().select().from(auditLogs).limit(1);
    await expectDbError(getDb().execute(sql`UPDATE audit_logs SET action = 'x' WHERE id = ${row!.id}`), /append-only/);
    await expectDbError(getDb().execute(sql`DELETE FROM audit_logs WHERE id = ${row!.id}`), /append-only/);
  });
});

describe("check-in", () => {
  it("admits a valid ticket once, then reports ALREADY_USED", async () => {
    const { f, tickets } = await paidOrder(1);
    const qr = signTicketQr(tickets[0]!.id, tickets[0]!.qrVersion);
    const ctx = { eventId: f.eventId, organizationId: f.orgId, operatorUserId: f.userId, deviceId: "dev-1" };
    const first = await performCheckIn({ ...ctx, qr });
    expect(first).toMatchObject({ result: "VALID", ticket: { holderName: "Maria Silva" } });
    const second = await performCheckIn({ ...ctx, qr });
    expect(second.result).toBe("ALREADY_USED");
    expect(second.ticket?.checkedInAt).toBeTruthy();
  });

  it("two devices scanning the same ticket at the same time: exactly one VALID", async () => {
    const { f, tickets } = await paidOrder(1);
    const qr = signTicketQr(tickets[0]!.id, 1);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => performCheckIn({ qr, eventId: f.eventId, organizationId: f.orgId, operatorUserId: f.userId, deviceId: `d${i}` })),
    );
    expect(results.filter((r) => r.result === "VALID")).toHaveLength(1);
    expect(results.filter((r) => r.result === "ALREADY_USED")).toHaveLength(11);
    const valid = await getDb().select().from(checkIns).where(sql`${checkIns.ticketId} = ${tickets[0]!.id} AND ${checkIns.result} = 'VALID'`);
    expect(valid).toHaveLength(1);
  });

  it("rejects forged QR codes, tickets of other events, and refunded tickets", async () => {
    const { f, order, tickets } = await paidOrder(1);
    const ctx = { eventId: f.eventId, organizationId: f.orgId, operatorUserId: f.userId };
    expect((await performCheckIn({ ...ctx, qr: "NA1.forged.1.xxxxxxxxxxxxxxxxxxxxxx" })).result).toBe("INVALID");
    expect((await performCheckIn({ ...ctx, qr: signTicketQr(tickets[0]!.id, 2) })).result).toBe("INVALID"); // wrong version

    const other = await createFixture();
    const wrong = await performCheckIn({ eventId: other.eventId, organizationId: other.orgId, operatorUserId: other.userId, qr: signTicketQr(tickets[0]!.id, 1) });
    expect(wrong.result).toBe("WRONG_EVENT");
    expect(wrong.ticket).toBeUndefined(); // no data leaks across events

    await requestRefund({ orderId: order.id, reason: "cancelado", actorUserId: f.userId });
    expect((await performCheckIn({ ...ctx, qr: signTicketQr(tickets[0]!.id, 1) })).result).toBe("REFUNDED");
  });
});
