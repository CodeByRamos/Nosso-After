import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { reconciliationIssues, webhookEvents } from "@/server/db/schema";
import { createOrder } from "@/server/services/orders";
import { createPaymentForOrder } from "@/server/services/payments";
import { resolveIssue, runReconciliation } from "@/server/services/reconciliation";
import { csvCell, streamReport } from "@/server/services/reports";
import { captureWebhooks, createFixture, getPayment, mockPsp, orderInput } from "../support/factories";

let hooks: ReturnType<typeof captureWebhooks>;
beforeEach(() => {
  hooks = captureWebhooks();
});

async function paidOrder() {
  const f = await createFixture({ price: 5_000, feeFixed: 500 });
  const order = await createOrder(orderInput(f, { quantity: 2 }));
  const p = await createPaymentForOrder({ orderId: order.id, method: "PIX" });
  await mockPsp().simulatePixPayment((await getPayment(p.id)).providerPaymentId!);
  await hooks.deliverAll();
  return { f, order, paymentId: p.id };
}

const issue = (key: string) => getDb().query.reconciliationIssues.findFirst({ where: eq(reconciliationIssues.dedupeKey, key) });

describe("reconciliation", () => {
  it("a clean paid order produces no issues for it", async () => {
    const { paymentId, order } = await paidOrder();
    await runReconciliation();
    const rows = await getDb()
      .select()
      .from(reconciliationIssues)
      .where(sql`${reconciliationIssues.entityId} IN (${paymentId}, ${order.id}) AND ${reconciliationIssues.status} = 'OPEN'`);
    expect(rows).toHaveLength(0);
  });

  it("detects refund divergence, auto-resolves when fixed", async () => {
    const { paymentId, order } = await paidOrder();
    await getDb().execute(sql`UPDATE orders SET refunded_amount = 100 WHERE id = ${order.id}`);
    await runReconciliation();
    expect(await issue(`REFUND_DIVERGENCE:${paymentId}`)).toMatchObject({ status: "OPEN", severity: "CRITICAL" });

    await getDb().execute(sql`UPDATE orders SET refunded_amount = 0 WHERE id = ${order.id}`);
    await runReconciliation();
    expect(await issue(`REFUND_DIVERGENCE:${paymentId}`)).toMatchObject({ status: "RESOLVED", resolvedBy: null });
  });

  it("detects a PSP payment that has no order and keeps a human acknowledgement sticky", async () => {
    const [w] = await getDb()
      .insert(webhookEvents)
      .values({
        provider: "mock",
        dedupeKey: `evt-${crypto.randomUUID()}`,
        eventType: "payment.updated",
        resourceType: "payment",
        resourceId: `mock_pay_desconhecido_${Date.now()}`,
        payload: {},
        status: "FAILED",
        attempts: 3,
        receivedAt: new Date(Date.now() - 3_600_000),
      })
      .returning();
    await runReconciliation();
    const found = await issue(`PSP_PAYMENT_WITHOUT_ORDER:${w!.id}`);
    expect(found).toMatchObject({ status: "OPEN", organizationId: null });

    const { f } = await paidOrder();
    await resolveIssue(found!.id, "Pagamento de teste do PSP, sem relação com vendas", f.userId);
    await runReconciliation();
    const after = await issue(`PSP_PAYMENT_WITHOUT_ORDER:${w!.id}`);
    expect(after).toMatchObject({ status: "RESOLVED" });
    expect(after!.resolvedBy).toBe(f.userId);
    expect(after!.lastSeenAt.getTime()).toBeGreaterThan(found!.lastSeenAt.getTime());
  });

  it("flags a paid order without an approved payment", async () => {
    const f = await createFixture();
    const o = await createOrder(orderInput(f));
    await getDb().execute(sql`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = ${o.id}`);
    await runReconciliation();
    expect(await issue(`ORDER_PAID_WITHOUT_PAYMENT:${o.id}`)).toMatchObject({ status: "OPEN" });
  });
});

describe("CSV reports", () => {
  it("neutralizes spreadsheet formulas and escapes separators", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+55 13")).toBe("'+55 13");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
  });

  it("exports the organization's orders only, with fee/discount/net columns", async () => {
    const { f, order } = await paidOrder();
    await createFixture(); // another organization must not leak into the export
    const text = await new Response(streamReport("orders", { organizationIds: [f.orgId] })).text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toContain("taxa_servico");
    expect(lines).toHaveLength(2);
    const code = (await getDb().execute<{ code: string }>(sql`SELECT code FROM orders WHERE id = ${order.id}`)).rows[0]!.code;
    expect(lines[1]).toContain(code);
    expect(lines[1]).toContain("110.00"); // total = 2 × (50 + 5)
    expect(lines[1]).toContain("100.00"); // producer net
  });
});
