import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { base32Encode, currentStep, decryptSecret, encryptSecret, totpAt, verifyTotp } from "@/server/auth/totp";
import { getDb } from "@/server/db/client";
import { auditLogs, customers, emailOutbox, memberships, orders, promoters, tickets, users } from "@/server/db/schema";
import { resetEnvCache } from "@/server/lib/env";
import { confirmMfa, startMfaEnrollment } from "@/server/services/account";
import { applyRetention, deliverEmails } from "@/server/services/jobs";
import { addMember, changeMemberRole, removeMember } from "@/server/services/members";
import { createOrder } from "@/server/services/orders";
import { createPaymentForOrder } from "@/server/services/payments";
import { anonymizeCustomer, exportCustomerData } from "@/server/services/privacy";
import { createPromoter } from "@/server/services/promoters";
import { captureWebhooks, createFixture, getPayment, mockPsp, orderInput } from "../support/factories";

let hooks: ReturnType<typeof captureWebhooks>;
beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
  resetEnvCache();
});
beforeEach(() => {
  hooks = captureWebhooks();
});

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 1)).toBe("287082"); // T = 59 s → 94287082 (last 6 digits)
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });
  it("accepts ±1 step of drift only and rejects malformed codes", () => {
    const secret = base32Encode(randomBytes(20));
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 3), now)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
  });
  it("encrypts secrets at rest with authenticated encryption", () => {
    const key = randomBytes(32).toString("base64url");
    const enc = encryptSecret("SECRET", key);
    expect(enc).not.toContain("SECRET");
    expect(decryptSecret(enc, key)).toBe("SECRET");
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("enrollment only activates after a valid code and returns one-time recovery codes", async () => {
    const f = await createFixture();
    await expect(confirmMfa(f.userId, "000000")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const { secret } = await startMfaEnrollment(f.userId);
    let u = await getDb().query.users.findFirst({ where: eq(users.id, f.userId) });
    expect(u!.mfaEnabledAt).toBeNull();
    expect(u!.mfaSecretEnc).not.toContain(secret);
    await expect(confirmMfa(f.userId, "000000")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const codes = await confirmMfa(f.userId, totpAt(secret, currentStep()));
    expect(codes).toHaveLength(8);
    u = await getDb().query.users.findFirst({ where: eq(users.id, f.userId) });
    expect(u!.mfaEnabledAt).not.toBeNull();
    expect(JSON.stringify(u!.mfaRecoveryHashes)).not.toContain(codes[0]!);
  });
});

describe("members", () => {
  it("creates staff with a provisional password that must be changed", async () => {
    const f = await createFixture();
    const email = `op-${Date.now()}@test.local`;
    await addMember({ organizationId: f.orgId, email, name: "Porteiro", role: "CHECKIN_OPERATOR", initialPassword: "Provisoria123456" }, f.userId);
    const u = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    expect(u!.mustChangePassword).toBe(true);
    expect(await verifyPassword("Provisoria123456", u!.passwordHash)).toBe(true);
    await expect(
      addMember({ organizationId: f.orgId, email, name: "Porteiro", role: "CHECKIN_OPERATOR" }, f.userId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      addMember({ organizationId: f.orgId, email: `weak-${Date.now()}@test.local`, name: "X", role: "EVENT_MANAGER", initialPassword: "curta" }, f.userId),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("never leaves an organization without an admin", async () => {
    const f = await createFixture();
    const [m] = await getDb().insert(memberships).values({ userId: f.userId, organizationId: f.orgId, role: "ORGANIZATION_ADMIN" }).returning();
    await expect(changeMemberRole(m!.id, "EVENT_MANAGER", f.userId)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(removeMember(m!.id, f.userId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("links a promoter login to exactly one promoter of the same organization", async () => {
    const f = await createFixture();
    const other = await createFixture();
    const p = await createPromoter({ organizationId: f.orgId, name: "Ana", code: `ANA${Date.now().toString(36)}`.toUpperCase(), commissionBps: 0, commissionFixedPerTicket: 0 }, f.userId);
    const foreign = await createPromoter({ organizationId: other.orgId, name: "Bia", code: `BIA${Date.now().toString(36)}`.toUpperCase(), commissionBps: 0, commissionFixedPerTicket: 0 }, other.userId);
    await expect(
      addMember({ organizationId: f.orgId, email: `bia-${Date.now()}@test.local`, name: "Bia", role: "PROMOTER", initialPassword: "Provisoria123456", promoterId: foreign.id }, f.userId),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const email = `ana-${Date.now()}@test.local`;
    await addMember({ organizationId: f.orgId, email, name: "Ana", role: "PROMOTER", initialPassword: "Provisoria123456", promoterId: p.id }, f.userId);
    const u = await getDb().query.users.findFirst({ where: eq(users.email, email) });
    expect((await getDb().query.promoters.findFirst({ where: eq(promoters.id, p.id) }))!.userId).toBe(u!.id);
  });
});

describe("LGPD", () => {
  async function paidOrder(email: string) {
    const f = await createFixture();
    const o = await createOrder(orderInput(f, { email }));
    const p = await createPaymentForOrder({ orderId: o.id, method: "PIX" });
    await mockPsp().simulatePixPayment((await getPayment(p.id)).providerPaymentId!);
    await hooks.deliverAll();
    const c = await getDb().query.customers.findFirst({ where: eq(customers.email, email) });
    return { f, order: o, customerId: c!.id };
  }

  it("exports the subject's data without card data or internal ids", async () => {
    const email = `titular-${Date.now()}@test.local`;
    const { f, customerId } = await paidOrder(email);
    const data = await exportCustomerData(customerId, f.userId);
    expect(data.subject.email).toBe(email);
    expect(data.orders).toHaveLength(1);
    expect(data.tickets).toHaveLength(1);
    expect(JSON.stringify(data)).not.toMatch(/"(card_?number|cvv|accessUrl|passwordHash|mfaSecretEnc|ip)"/i);
  });

  it("blocks anonymization while a ticket is valid for a future event, then anonymizes and keeps money records", async () => {
    const email = `apagar-${Date.now()}@test.local`;
    const { f, order, customerId } = await paidOrder(email);
    await expect(anonymizeCustomer(customerId, f.userId, "Solicitação por e-mail #123")).rejects.toMatchObject({ code: "INVALID_STATE" });

    await getDb().execute(sql`UPDATE events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id = ${f.eventId}`);
    const r = await anonymizeCustomer(customerId, f.userId, "Solicitação por e-mail #123");
    expect(r).toEqual({ orders: 1, tickets: 1 });

    const c = await getDb().query.customers.findFirst({ where: eq(customers.id, customerId) });
    expect(c).toMatchObject({ phone: null, document: null, name: "Titular anonimizado" });
    expect(c!.email).not.toBe(email);
    const [t] = await getDb().select().from(tickets).where(eq(tickets.orderId, order.id));
    expect(t!.holderEmail).not.toBe(email);
    const o = await getDb().query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(o).toMatchObject({ status: "PAID", totalAmount: order.total, ip: null });
    const outbox = await getDb().select().from(emailOutbox).where(eq(emailOutbox.toEmail, email));
    expect(outbox).toHaveLength(0);
    const [log] = await getDb().select().from(auditLogs).where(sql`${auditLogs.action} = 'customer.anonymize' AND ${auditLogs.entityId} = ${customerId}`);
    expect(JSON.stringify(log!.metadata)).not.toContain(email);
  });
});

describe("retention", () => {
  it("removes the order access link from delivered e-mails and purges old personal data", async () => {
    const f = await createFixture();
    const o = await createOrder(orderInput(f));
    const p = await createPaymentForOrder({ orderId: o.id, method: "PIX" });
    await mockPsp().simulatePixPayment((await getPayment(p.id)).providerPaymentId!);
    await hooks.deliverAll();
    await deliverEmails(500);
    const [mail] = await getDb().select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, `order_confirmed:${o.id}`));
    expect(mail!.status).toBe("SENT");
    expect(mail!.payload).not.toHaveProperty("accessUrl");

    await getDb().execute(sql`UPDATE orders SET ip = '10.0.0.1', created_at = now() - interval '200 days' WHERE id = ${o.id}`);
    const r = await applyRetention();
    expect(r.orderIps).toBeGreaterThanOrEqual(1);
    expect((await getDb().query.orders.findFirst({ where: eq(orders.id, o.id) }))!.ip).toBeNull();
  });
});
