/**
 * DEMO payment provider — a local PSP simulator for development and automated tests.
 *
 * It exists so the full pipeline (create → webhook with HMAC → authoritative getPayment → order
 * confirmation → tickets → refund) can run without PSP credentials. It NEVER moves money, it is
 * labeled DEMO end-to-end, and env validation forbids it in production.
 *
 * Its state lives in `mock_psp_transactions` (conceptually "the PSP's database"); the core never
 * reads that table directly — only through this adapter, exactly like a real PSP.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { mockPspTransactions } from "@/server/db/schema";
import { hmacSha256, randomToken, safeEqual } from "@/server/lib/crypto";
import type { PaymentStatus } from "@/server/domain/payment-status";
import {
  ProviderError,
  type ClientPaymentConfig,
  type CreatePaymentInput,
  type OperationContext,
  type PaymentProvider,
  type ProviderPaymentSnapshot,
  type ProviderRefundResult,
  type RefundInput,
  type WebhookRequest,
  type WebhookVerification,
} from "../../provider";

/** Test "card tokens" the DEMO card form produces. No card data is ever typed or transmitted. */
export const MOCK_CARD_TOKENS = {
  approve: "mock_tok_approve",
  decline: "mock_tok_decline",
} as const;

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
const SIGNATURE_TOLERANCE_SECONDS = 300;

type MockRow = typeof mockPspTransactions.$inferSelect;

export function mapMockStatus(raw: string): PaymentStatus {
  switch (raw) {
    case "pending":
      return "PENDING";
    case "in_process":
      return "PROCESSING";
    case "approved":
      return "PAID";
    case "rejected":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    case "refunded":
      return "REFUNDED";
    case "partially_refunded":
      return "PARTIALLY_REFUNDED";
    case "charged_back":
      return "CHARGEBACK";
    default:
      throw new ProviderError(`unknown mock status ${raw}`, "UNKNOWN_STATUS", false);
  }
}

export type WebhookDispatcher = (delivery: { rawBody: string; headers: Record<string, string> }) => Promise<void>;

/** Default dispatcher: real HTTP POST to our own webhook endpoint (same path a real PSP would use). */
const httpDispatcher: WebhookDispatcher = async ({ rawBody, headers }) => {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const res = await fetch(new URL("/api/webhooks/mock", base), { method: "POST", body: rawBody, headers });
  if (!res.ok) throw new Error(`mock webhook delivery failed with ${res.status}`);
};

let dispatcher: WebhookDispatcher = httpDispatcher;
/** Tests inject a dispatcher that calls the route handler in-process. */
export function setMockWebhookDispatcher(d: WebhookDispatcher | null) {
  dispatcher = d ?? httpDispatcher;
}

export function signMockWebhook(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = hmacSha256(secret, `${timestamp}.${rawBody}`).toString("hex");
  return `t=${timestamp},v1=${v1}`;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock" as const;
  readonly environment = "DEMO" as const;
  readonly capabilities = { pix: true, creditCard: true, installments: true, split: false, partialRefund: true };

  constructor(private readonly webhookSecret: string) {}

  clientConfig(): ClientPaymentConfig {
    return { provider: this.id, environment: this.environment, capabilities: this.capabilities };
  }

  async createPayment(input: CreatePaymentInput, ctx: OperationContext): Promise<ProviderPaymentSnapshot> {
    const db = getDb();
    const existing = await db.query.mockPspTransactions.findFirst({
      where: eq(mockPspTransactions.idempotencyKey, ctx.idempotencyKey),
    });
    if (existing) return this.snapshot(existing);

    let status = "pending";
    let statusDetail: string | null = "pending_waiting_transfer";
    let cardScenario: string | null = null;
    if (input.method === "CREDIT_CARD") {
      if (!input.card) throw new ProviderError("card data missing", "INVALID_REQUEST", false, 400);
      if (input.card.token === MOCK_CARD_TOKENS.approve) {
        status = "approved";
        statusDetail = "accredited";
        cardScenario = "approve";
      } else if (input.card.token === MOCK_CARD_TOKENS.decline) {
        status = "rejected";
        statusDetail = "cc_rejected_insufficient_amount";
        cardScenario = "decline";
      } else {
        throw new ProviderError("invalid card token", "INVALID_CARD_TOKEN", false, 400);
      }
    }

    const [row] = await db
      .insert(mockPspTransactions)
      .values({
        id: `mock_pay_${randomToken(12)}`,
        method: input.method,
        status,
        statusDetail,
        amount: input.amount,
        externalReference: input.paymentId,
        idempotencyKey: ctx.idempotencyKey,
        cardScenario,
        expiresAt: input.method === "PIX" ? (input.expiresAt ?? new Date(Date.now() + 15 * 60_000)) : null,
      })
      .onConflictDoNothing({ target: mockPspTransactions.idempotencyKey })
      .returning();
    const created =
      row ??
      (await db.query.mockPspTransactions.findFirst({ where: eq(mockPspTransactions.idempotencyKey, ctx.idempotencyKey) }));
    if (!created) throw new ProviderError("mock create failed", "INTERNAL", true);

    // A real PSP notifies card results asynchronously as well.
    if (created.method === "CREDIT_CARD") this.notifyLater(created.id, "payment.created");
    return this.snapshot(created);
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentSnapshot> {
    const row = await this.load(providerPaymentId);
    // Pix QR codes expire at the PSP side.
    if (row.status === "pending" && row.expiresAt && row.expiresAt < new Date()) {
      const [updated] = await getDb()
        .update(mockPspTransactions)
        .set({ status: "expired", statusDetail: "expired", updatedAt: new Date() })
        .where(sql`${mockPspTransactions.id} = ${row.id} AND ${mockPspTransactions.status} = 'pending'`)
        .returning();
      return this.snapshot(updated ?? (await this.load(providerPaymentId)));
    }
    return this.snapshot(row);
  }

  async cancelPayment(providerPaymentId: string): Promise<ProviderPaymentSnapshot> {
    const row = await this.load(providerPaymentId);
    if (row.status !== "pending" && row.status !== "in_process") {
      throw new ProviderError(`cannot cancel payment in status ${row.status}`, "INVALID_STATE", false, 400);
    }
    const [updated] = await getDb()
      .update(mockPspTransactions)
      .set({ status: "cancelled", statusDetail: "by_collector", updatedAt: new Date() })
      .where(eq(mockPspTransactions.id, row.id))
      .returning();
    return this.snapshot(updated!);
  }

  async refundPayment(input: RefundInput): Promise<ProviderRefundResult> {
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(mockPspTransactions)
        .where(eq(mockPspTransactions.id, input.providerPaymentId))
        .for("update");
      if (!row) throw new ProviderError("payment not found", "NOT_FOUND", false, 404);
      if (row.status !== "approved" && row.status !== "partially_refunded") {
        throw new ProviderError(`cannot refund payment in status ${row.status}`, "INVALID_STATE", false, 400);
      }
      const remaining = row.amount - row.refundedAmount;
      const amount = input.amount ?? remaining;
      if (amount <= 0 || amount > remaining) {
        throw new ProviderError("refund amount exceeds refundable balance", "INVALID_AMOUNT", false, 400);
      }
      const refunded = row.refundedAmount + amount;
      await tx
        .update(mockPspTransactions)
        .set({
          refundedAmount: refunded,
          status: refunded === row.amount ? "refunded" : "partially_refunded",
          statusDetail: refunded === row.amount ? "refunded" : "partially_refunded",
          updatedAt: new Date(),
        })
        .where(eq(mockPspTransactions.id, row.id));
      return { amount };
    });
    this.notifyLater(input.providerPaymentId, "payment.updated");
    return {
      providerRefundId: `mock_ref_${randomToken(9)}`,
      status: "SUCCEEDED",
      amount: result.amount,
      rawStatus: "approved",
    };
  }

  async verifyWebhook(req: WebhookRequest): Promise<WebhookVerification> {
    const header = req.headers.get(MOCK_SIGNATURE_HEADER);
    if (!header) return { ok: false, reason: "missing signature" };
    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    const t = Number(parts.t);
    if (!Number.isInteger(t) || !parts.v1) return { ok: false, reason: "malformed signature" };
    // Replay protection: the timestamp is signed, so an old capture cannot be re-sent later.
    if (Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale timestamp" };
    const expected = hmacSha256(this.webhookSecret, `${t}.${req.rawBody}`).toString("hex");
    if (!safeEqual(expected, parts.v1)) return { ok: false, reason: "signature mismatch" };

    let body: { id?: string; type?: string; action?: string; data?: { id?: string } };
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      return { ok: false, reason: "invalid json" };
    }
    if (!body.id || !body.data?.id || body.type !== "payment") return { ok: false, reason: "unexpected payload" };
    return {
      ok: true,
      dedupeKey: body.id,
      eventType: body.action ?? "payment.updated",
      resourceType: "payment",
      resourceId: body.data.id,
      payload: body as Record<string, unknown>,
    };
  }

  // ---- DEMO-only simulation controls (not part of PaymentProvider) ----

  /** Simulates the buyer paying the Pix QR code in their bank app. */
  async simulatePixPayment(providerPaymentId: string) {
    const [updated] = await getDb()
      .update(mockPspTransactions)
      .set({ status: "approved", statusDetail: "accredited", updatedAt: new Date() })
      .where(
        sql`${mockPspTransactions.id} = ${providerPaymentId} AND ${mockPspTransactions.method} = 'PIX' AND ${mockPspTransactions.status} IN ('pending','expired')`,
      )
      .returning();
    if (!updated) throw new ProviderError("pix payment not payable", "INVALID_STATE", false, 400);
    await this.notify(updated.id, "payment.updated");
    return this.snapshot(updated);
  }

  async simulateChargeback(providerPaymentId: string) {
    const [updated] = await getDb()
      .update(mockPspTransactions)
      .set({ status: "charged_back", statusDetail: "chargeback", updatedAt: new Date() })
      .where(sql`${mockPspTransactions.id} = ${providerPaymentId} AND ${mockPspTransactions.status} = 'approved'`)
      .returning();
    if (!updated) throw new ProviderError("payment not eligible for chargeback", "INVALID_STATE", false, 400);
    await this.notify(updated.id, "payment.updated");
    return this.snapshot(updated);
  }

  /** Builds + signs a webhook delivery exactly like the real PSP would. */
  buildWebhook(providerPaymentId: string, action: string) {
    const rawBody = JSON.stringify({
      id: `mock_evt_${randomToken(12)}`,
      type: "payment",
      action,
      data: { id: providerPaymentId },
      live_mode: false,
    });
    return {
      rawBody,
      headers: {
        "content-type": "application/json",
        [MOCK_SIGNATURE_HEADER]: signMockWebhook(this.webhookSecret, rawBody),
      },
    };
  }

  async notify(providerPaymentId: string, action: string) {
    await dispatcher(this.buildWebhook(providerPaymentId, action));
  }

  private notifyLater(providerPaymentId: string, action: string) {
    // Fire-and-forget like a real PSP; failures are covered by the sync-pending-payments job.
    setTimeout(() => {
      this.notify(providerPaymentId, action).catch(() => undefined);
    }, 250).unref?.();
  }

  private async load(id: string): Promise<MockRow> {
    const row = await getDb().query.mockPspTransactions.findFirst({ where: eq(mockPspTransactions.id, id) });
    if (!row) throw new ProviderError("payment not found", "NOT_FOUND", false, 404);
    return row;
  }

  private snapshot(row: MockRow): ProviderPaymentSnapshot {
    const status = mapMockStatus(row.status);
    return {
      providerPaymentId: row.id,
      status,
      rawStatus: row.status,
      rawStatusDetail: row.statusDetail,
      amount: row.amount,
      refundedAmount: row.refundedAmount,
      providerFeeAmount: 0,
      netAmount: row.amount - row.refundedAmount,
      installments: null, // not tracked by the simulator
      paidAt: status === "PAID" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED" ? row.updatedAt : null,
      pix:
        row.method === "PIX"
          ? {
              // Deliberately NOT a valid EMV/BR Code: a bank app must never accept a DEMO charge.
              qrCode: `DEMO-NOSSOAFTER-NAO-PAGAR-${row.id}`,
              expiresAt: row.expiresAt,
            }
          : undefined,
      card: row.method === "CREDIT_CARD" ? { brand: "demo", lastFour: "0000" } : undefined,
      failure: status === "FAILED" ? { code: row.statusDetail ?? "rejected", message: "Pagamento recusado (DEMO)" } : null,
      externalReference: row.externalReference,
      sanitized: { id: row.id, status: row.status, status_detail: row.statusDetail, amount: row.amount, refunded: row.refundedAmount },
    };
  }
}
