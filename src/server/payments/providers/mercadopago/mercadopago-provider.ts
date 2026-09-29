/**
 * Mercado Pago adapter — Payments API (`/v1/payments`) via the official `mercadopago` SDK.
 *
 * STATUS: implemented against the official docs + SDK 3.6.1 types; NOT yet validated against a live
 * sandbox account (credentials pending). See docs/PAYMENTS.md → "Checklist para SANDBOX/PRODUCTION".
 *
 * PCI: card data is tokenized in the browser by the Card Payment Brick (MercadoPago.js v2).
 * This adapter only ever receives the opaque `token`.
 */
import {
  MercadoPagoConfig,
  MercadoPagoError,
  Payment,
  PaymentRefund,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
} from "mercadopago";
import { centsToDecimal, decimalToCents } from "@/server/domain/money";
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
import {
  mapMpRefundStatus,
  mapMpStatus,
  mpCollectorFees,
  sanitizeMpPayment,
  splitName,
  toMpDate,
  type MpPaymentLike,
} from "./mapping";

export interface MercadoPagoOptions {
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
  environment: "SANDBOX" | "PRODUCTION";
  statementDescriptor: string;
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly id = "mercadopago" as const;
  readonly environment: "SANDBOX" | "PRODUCTION";
  // split: false until the marketplace OAuth flow is built (ADR-0001).
  readonly capabilities = { pix: true, creditCard: true, installments: true, split: false, partialRefund: true };

  private readonly payments: Payment;
  private readonly refunds: PaymentRefund;

  constructor(private readonly opts: MercadoPagoOptions) {
    this.environment = opts.environment;
    const config = new MercadoPagoConfig({ accessToken: opts.accessToken, options: { timeout: 10_000 } });
    this.payments = new Payment(config);
    this.refunds = new PaymentRefund(config);
  }

  clientConfig(): ClientPaymentConfig {
    return {
      provider: this.id,
      environment: this.environment,
      publicKey: this.opts.publicKey,
      capabilities: this.capabilities,
    };
  }

  async createPayment(input: CreatePaymentInput, ctx: OperationContext): Promise<ProviderPaymentSnapshot> {
    if (input.split) {
      throw new ProviderError("Mercado Pago marketplace split is not enabled yet", "NOT_SUPPORTED", false);
    }
    const { first_name, last_name } = splitName(input.payer.name);
    const payer = {
      email: input.payer.email,
      first_name,
      last_name,
      ...(input.payer.document ? { identification: { type: "CPF", number: input.payer.document } } : {}),
    };
    const common = {
      transaction_amount: centsToDecimal(input.amount),
      description: input.description.slice(0, 250),
      external_reference: input.paymentId,
      notification_url: input.notificationUrl,
      additional_info: {
        items: input.items?.map((i) => ({
          id: i.id,
          title: i.title,
          quantity: i.quantity,
          unit_price: centsToDecimal(i.unitPrice),
          category_id: "tickets",
        })),
        ...(input.buyerIp ? { ip_address: input.buyerIp } : {}),
      },
    };

    const body =
      input.method === "PIX"
        ? {
            ...common,
            payment_method_id: "pix",
            payer,
            ...(input.expiresAt ? { date_of_expiration: toMpDate(input.expiresAt) } : {}),
          }
        : {
            ...common,
            token: requireCard(input).token,
            payment_method_id: requireCard(input).paymentMethodId,
            installments: requireCard(input).installments,
            ...(input.card?.issuerId ? { issuer_id: Number(input.card.issuerId) } : {}),
            statement_descriptor: this.opts.statementDescriptor,
            payer,
          };

    const created = await this.call(() =>
      this.payments.create({ body, requestOptions: { idempotencyKey: ctx.idempotencyKey } }),
    );
    return this.toSnapshot(created as MpPaymentLike);
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentSnapshot> {
    const p = await this.call(() => this.payments.get({ id: providerPaymentId }));
    return this.toSnapshot(p as MpPaymentLike);
  }

  async cancelPayment(providerPaymentId: string, ctx: OperationContext): Promise<ProviderPaymentSnapshot> {
    const p = await this.call(() =>
      this.payments.cancel({ id: providerPaymentId, requestOptions: { idempotencyKey: ctx.idempotencyKey } }),
    );
    return this.toSnapshot(p as MpPaymentLike);
  }

  async refundPayment(input: RefundInput, ctx: OperationContext): Promise<ProviderRefundResult> {
    const r = await this.call(() =>
      this.refunds.create({
        payment_id: input.providerPaymentId,
        body: input.amount !== undefined ? { amount: centsToDecimal(input.amount) } : undefined,
        requestOptions: { idempotencyKey: ctx.idempotencyKey },
      }),
    );
    if (r.id === undefined || r.id === null) {
      throw new ProviderError("refund response without id", "INVALID_RESPONSE", true);
    }
    return {
      providerRefundId: String(r.id),
      status: mapMpRefundStatus(r.status),
      amount: decimalToCents(r.amount ?? 0),
      rawStatus: r.status ?? "unknown",
    };
  }

  /**
   * Validates `x-signature` with the SDK's WebhookSignatureValidator.
   * Manifest: `id:{data.id};request-id:{x-request-id};ts:{ts};` (HMAC-SHA256, hex).
   * No timestamp tolerance is enforced because MP retries (every 15 min) may re-send the original
   * signature; replay is harmless anyway: deliveries are deduplicated and state always comes from
   * an authoritative GET /v1/payments/{id}.
   */
  async verifyWebhook(req: WebhookRequest): Promise<WebhookVerification> {
    let body: { id?: number | string; type?: string; action?: string; data?: { id?: string | number } };
    try {
      body = JSON.parse(req.rawBody || "{}");
    } catch {
      return { ok: false, reason: "invalid json" };
    }
    const dataId = req.url.searchParams.get("data.id") ?? (body.data?.id !== undefined ? String(body.data.id) : null);
    const type = req.url.searchParams.get("type") ?? body.type ?? null;
    try {
      WebhookSignatureValidator.validate({
        xSignature: req.headers.get("x-signature"),
        xRequestId: req.headers.get("x-request-id"),
        dataId,
        secret: this.opts.webhookSecret,
      });
    } catch (e) {
      if (e instanceof InvalidWebhookSignatureError) return { ok: false, reason: e.reason };
      return { ok: false, reason: "signature validation error" };
    }
    if (!dataId) return { ok: false, reason: "missing data.id" };
    const resourceType = type === "payment" ? "payment" : type === "chargebacks" ? "chargeback" : "other";
    return {
      ok: true,
      dedupeKey: body.id !== undefined ? String(body.id) : `${type}:${dataId}:${req.headers.get("x-request-id") ?? ""}`,
      eventType: body.action ?? type ?? "unknown",
      resourceType,
      resourceId: dataId,
      payload: body as Record<string, unknown>,
    };
  }

  private toSnapshot(p: MpPaymentLike): ProviderPaymentSnapshot {
    if (p.id === undefined) throw new ProviderError("payment response without id", "INVALID_RESPONSE", true);
    const status = mapMpStatus(p);
    const tx = p.point_of_interaction?.transaction_data;
    const amount = decimalToCents(p.transaction_amount ?? 0);
    return {
      providerPaymentId: String(p.id),
      status,
      rawStatus: p.status ?? "unknown",
      rawStatusDetail: p.status_detail ?? null,
      amount,
      refundedAmount: decimalToCents(p.transaction_amount_refunded ?? 0),
      providerFeeAmount: mpCollectorFees(p),
      netAmount:
        p.transaction_details?.net_received_amount !== undefined
          ? decimalToCents(p.transaction_details.net_received_amount)
          : null,
      installments: p.installments ?? null,
      paidAt: p.date_approved ? new Date(p.date_approved) : null,
      pix: tx?.qr_code
        ? {
            qrCode: tx.qr_code,
            qrCodeBase64: tx.qr_code_base64 ?? null,
            ticketUrl: tx.ticket_url ?? null,
            expiresAt: p.date_of_expiration ? new Date(p.date_of_expiration) : null,
          }
        : undefined,
      card: p.card ? { brand: p.payment_method_id ?? null, lastFour: p.card.last_four_digits ?? null } : undefined,
      failure:
        status === "FAILED" ? { code: p.status_detail ?? "rejected", message: describeRejection(p.status_detail) } : null,
      externalReference: p.external_reference ?? null,
      sanitized: sanitizeMpPayment(p),
    };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof MercadoPagoError) {
        const retryable = e.status >= 500 || e.status === 429;
        throw new ProviderError(`Mercado Pago API error (${e.status}): ${e.error}`, e.error || "MP_ERROR", retryable, e.status);
      }
      throw new ProviderError(
        `Mercado Pago request failed: ${e instanceof Error ? e.message : "unknown"}`,
        "NETWORK_ERROR",
        true,
      );
    }
  }
}

function requireCard(input: CreatePaymentInput) {
  if (!input.card) throw new ProviderError("card token missing", "INVALID_REQUEST", false, 400);
  return input.card;
}

/** Buyer-facing messages for common card rejections (status_detail from MP docs). */
function describeRejection(detail?: string): string {
  switch (detail) {
    case "cc_rejected_insufficient_amount":
      return "Cartão sem limite suficiente.";
    case "cc_rejected_bad_filled_security_code":
    case "cc_rejected_bad_filled_date":
    case "cc_rejected_bad_filled_other":
    case "cc_rejected_bad_filled_card_number":
      return "Confira os dados do cartão e tente novamente.";
    case "cc_rejected_call_for_authorize":
      return "O emissor pediu autorização. Ligue para o banco e tente de novo.";
    case "cc_rejected_high_risk":
      return "Pagamento recusado pela análise de segurança. Tente Pix ou outro cartão.";
    case "cc_rejected_duplicated_payment":
      return "Pagamento duplicado detectado pelo emissor.";
    default:
      return "Pagamento recusado. Tente outro cartão ou pague com Pix.";
  }
}
