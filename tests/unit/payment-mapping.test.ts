import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canTransition } from "@/server/domain/payment-status";
import { mapMpRefundStatus, mapMpStatus, mpCollectorFees, sanitizeMpPayment, toMpDate } from "@/server/payments/providers/mercadopago/mapping";
import { MercadoPagoProvider } from "@/server/payments/providers/mercadopago/mercadopago-provider";

describe("payment state machine", () => {
  it("allows forward transitions and rejects regressions", () => {
    expect(canTransition("PENDING", "PAID")).toBe(true);
    expect(canTransition("PROCESSING", "FAILED")).toBe(true);
    expect(canTransition("PAID", "REFUNDED")).toBe(true);
    expect(canTransition("PAID", "PENDING")).toBe(false);
    expect(canTransition("REFUNDED", "PAID")).toBe(false);
    expect(canTransition("PAID", "PAID")).toBe(false);
    // late Pix confirmation after expiry is accepted (PSP is the source of truth)
    expect(canTransition("EXPIRED", "PAID")).toBe(true);
  });
});

describe("Mercado Pago status mapping", () => {
  it.each([
    [{ status: "pending" }, "PENDING"],
    [{ status: "in_process" }, "PROCESSING"],
    [{ status: "authorized" }, "AUTHORIZED"],
    [{ status: "approved", transaction_amount: 100 }, "PAID"],
    [{ status: "approved", transaction_amount: 100, transaction_amount_refunded: 30 }, "PARTIALLY_REFUNDED"],
    [{ status: "in_mediation", transaction_amount: 100 }, "PAID"],
    [{ status: "rejected" }, "FAILED"],
    [{ status: "cancelled" }, "CANCELLED"],
    [{ status: "cancelled", status_detail: "expired" }, "EXPIRED"],
    [{ status: "refunded", transaction_amount: 100, transaction_amount_refunded: 100 }, "REFUNDED"],
    [{ status: "charged_back" }, "CHARGEBACK"],
  ] as const)("%o → %s", (input, expected) => {
    expect(mapMpStatus(input)).toBe(expected);
  });
  it("fails loudly on unknown statuses", () => {
    expect(() => mapMpStatus({ status: "weird" })).toThrow();
  });
  it("maps refunds and fees", () => {
    expect(mapMpRefundStatus("approved")).toBe("SUCCEEDED");
    expect(mapMpRefundStatus("in_process")).toBe("PROCESSING");
    expect(mapMpRefundStatus("rejected")).toBe("FAILED");
    expect(mpCollectorFees({ fee_details: [{ amount: 4.99, fee_payer: "collector" }, { amount: 1, fee_payer: "payer" }] })).toBe(499);
  });
  it("never keeps payer data in snapshots", () => {
    const snap = sanitizeMpPayment({ id: 1, status: "approved", payer: { email: "x@y.z" } } as never);
    expect(JSON.stringify(snap)).not.toContain("x@y.z");
  });
  it("formats dates with the São Paulo offset", () => {
    expect(toMpDate(new Date("2026-09-28T15:00:00.000Z"))).toBe("2026-09-28T12:00:00.000-03:00");
  });
});

describe("Mercado Pago webhook signature (official SDK validator)", () => {
  const secret = "mp-test-secret";
  const provider = new MercadoPagoProvider({
    accessToken: "TEST-not-used",
    publicKey: "TEST-pk",
    webhookSecret: secret,
    environment: "SANDBOX",
    statementDescriptor: "TEST",
  });
  const body = JSON.stringify({ id: 12345, type: "payment", action: "payment.updated", data: { id: "999" } });
  const sign = (dataId: string, requestId: string, ts: string) =>
    createHmac("sha256", secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");

  it("accepts a correctly signed notification", async () => {
    const ts = "1790000000";
    const res = await provider.verifyWebhook({
      rawBody: body,
      url: new URL("https://x/api/webhooks/mercadopago?data.id=999&type=payment"),
      headers: new Headers({ "x-signature": `ts=${ts},v1=${sign("999", "req-1", ts)}`, "x-request-id": "req-1" }),
    });
    expect(res).toMatchObject({ ok: true, resourceType: "payment", resourceId: "999", dedupeKey: "12345" });
  });
  it("rejects a forged or tampered notification", async () => {
    const ts = "1790000000";
    const forged = await provider.verifyWebhook({
      rawBody: body,
      url: new URL("https://x/api/webhooks/mercadopago?data.id=1000&type=payment"),
      headers: new Headers({ "x-signature": `ts=${ts},v1=${sign("999", "req-1", ts)}`, "x-request-id": "req-1" }),
    });
    expect(forged.ok).toBe(false);
    const missing = await provider.verifyWebhook({ rawBody: body, url: new URL("https://x/?data.id=999"), headers: new Headers() });
    expect(missing.ok).toBe(false);
  });
});
