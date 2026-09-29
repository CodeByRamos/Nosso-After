/**
 * PaymentProvider — the only contract the core knows about a PSP.
 *
 * Adapters live in ./providers/<id>/ and are the ONLY place allowed to import a PSP SDK.
 * All amounts are integer cents. All statuses are normalized (see domain/payment-status.ts).
 * Adapters never receive raw card data: card payments take an opaque token produced in the
 * buyer's browser by the PSP's own tokenization library.
 */
import type { PaymentStatus } from "@/server/domain/payment-status";

export type ProviderId = "mock" | "mercadopago";
export type PaymentEnvironment = "DEMO" | "SANDBOX" | "PRODUCTION";
export type PaymentMethodCode = "PIX" | "CREDIT_CARD";

export interface ProviderCapabilities {
  pix: boolean;
  creditCard: boolean;
  installments: boolean;
  /** Official split (platform commission retained by the PSP). */
  split: boolean;
  partialRefund: boolean;
}

export interface PayerInfo {
  name: string;
  email: string;
  /** CPF digits. */
  document?: string | null;
  phone?: string | null;
}

export interface CardPaymentData {
  /** Opaque token created client-side by the PSP library (never a PAN). */
  token: string;
  /** PSP method/brand id (e.g. "visa", "master") as returned by the PSP tokenizer. */
  paymentMethodId: string;
  issuerId?: string | null;
  installments: number;
}

export interface SplitInstruction {
  /** Platform commission retained via the PSP's official split mechanism. */
  platformFeeAmount: number;
  /** Provider-specific reference to the seller account (e.g. OAuth-connected seller). */
  sellerAccountRef: string;
}

export interface CreatePaymentInput {
  /** Our payment id — sent as external reference for reconciliation. */
  paymentId: string;
  orderCode: string;
  method: PaymentMethodCode;
  amount: number;
  description: string;
  payer: PayerInfo;
  card?: CardPaymentData;
  /** Pix: when the QR code must stop accepting payments. */
  expiresAt?: Date;
  split?: SplitInstruction;
  notificationUrl?: string;
  /** Line items for PSP anti-fraud scoring (no personal data). */
  items?: { id: string; title: string; quantity: number; unitPrice: number }[];
  /** Buyer IP, forwarded for anti-fraud when the PSP supports it. */
  buyerIp?: string | null;
}

export interface ProviderPaymentSnapshot {
  providerPaymentId: string;
  status: PaymentStatus;
  rawStatus: string;
  rawStatusDetail?: string | null;
  amount: number;
  refundedAmount: number;
  /** PSP processing fee, when reported. */
  providerFeeAmount?: number | null;
  netAmount?: number | null;
  installments?: number | null;
  paidAt?: Date | null;
  pix?: { qrCode: string; qrCodeBase64?: string | null; ticketUrl?: string | null; expiresAt?: Date | null };
  card?: { brand?: string | null; lastFour?: string | null };
  failure?: { code: string; message: string } | null;
  /** Echo of our external reference (payment id) for cross-checking. */
  externalReference?: string | null;
  /** Sanitized raw object for provider_transactions.snapshot. */
  sanitized: Record<string, unknown>;
}

export interface RefundInput {
  providerPaymentId: string;
  /** Omit for full refund. */
  amount?: number;
  refundId: string;
}

export interface ProviderRefundResult {
  providerRefundId: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
  amount: number;
  rawStatus: string;
}

export interface OperationContext {
  idempotencyKey: string;
}

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
  url: URL;
}

export type WebhookVerification =
  | {
      ok: true;
      /** Unique per delivery (used for dedupe). */
      dedupeKey: string;
      eventType: string;
      resourceType: "payment" | "refund" | "chargeback" | "other";
      resourceId: string;
      payload: Record<string, unknown>;
    }
  | { ok: false; reason: string };

export interface ClientPaymentConfig {
  provider: ProviderId;
  environment: PaymentEnvironment;
  publicKey?: string;
  capabilities: ProviderCapabilities;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  readonly environment: PaymentEnvironment;
  readonly capabilities: ProviderCapabilities;

  createPayment(input: CreatePaymentInput, ctx: OperationContext): Promise<ProviderPaymentSnapshot>;
  /** Authoritative read — the only way a payment becomes PAID. */
  getPayment(providerPaymentId: string): Promise<ProviderPaymentSnapshot>;
  cancelPayment(providerPaymentId: string, ctx: OperationContext): Promise<ProviderPaymentSnapshot>;
  refundPayment(input: RefundInput, ctx: OperationContext): Promise<ProviderRefundResult>;
  /** Verifies authenticity (signature) and extracts identifiers. MUST NOT trust payload state. */
  verifyWebhook(req: WebhookRequest): Promise<WebhookVerification>;
  /** Public, non-secret configuration for the checkout frontend. */
  clientConfig(): ClientPaymentConfig;
}

/** Error thrown by adapters; `retryable` distinguishes network/5xx from business declines. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
