/**
 * Pure Mercado Pago ↔ internal mappings (unit-tested, no SDK import).
 * Reference: Payments API `/v1/payments` status + status_detail values.
 */
import type { PaymentStatus } from "@/server/domain/payment-status";
import { decimalToCents } from "@/server/domain/money";

export interface MpPaymentLike {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  external_reference?: string;
  installments?: number;
  date_approved?: string;
  date_of_expiration?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  live_mode?: boolean;
  date_created?: string;
  fee_details?: { type?: string; amount?: number; fee_payer?: string }[];
  transaction_details?: { net_received_amount?: number };
  card?: { last_four_digits?: string };
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
  };
}

/**
 * MP status → internal status.
 * - Partial refunds keep MP status "approved" with transaction_amount_refunded > 0.
 * - "in_mediation" (buyer dispute opened) keeps the payment PAID; the caller flags it as disputed.
 * - "cancelled" with detail "expired" means the Pix/boleto expired unpaid.
 */
export function mapMpStatus(p: MpPaymentLike): PaymentStatus {
  const amount = p.transaction_amount ?? 0;
  const refunded = p.transaction_amount_refunded ?? 0;
  switch (p.status) {
    case "pending":
      return "PENDING";
    case "in_process":
      return "PROCESSING";
    case "authorized":
      return "AUTHORIZED";
    case "approved":
    case "in_mediation":
      if (refunded > 0 && refunded < amount) return "PARTIALLY_REFUNDED";
      if (refunded > 0 && refunded >= amount) return "REFUNDED";
      return "PAID";
    case "rejected":
      return "FAILED";
    case "cancelled":
      return p.status_detail === "expired" ? "EXPIRED" : "CANCELLED";
    case "refunded":
      return refunded > 0 && refunded < amount ? "PARTIALLY_REFUNDED" : "REFUNDED";
    case "charged_back":
      return "CHARGEBACK";
    default:
      throw new Error(`Unknown Mercado Pago payment status: ${String(p.status)}`);
  }
}

export function mapMpRefundStatus(status: string | undefined): "PROCESSING" | "SUCCEEDED" | "FAILED" {
  switch (status) {
    case "approved":
      return "SUCCEEDED";
    case "in_process":
    case "pending":
    case "authorized":
      return "PROCESSING";
    default:
      return "FAILED";
  }
}

/** Sum of MP fees charged to the collector (our side), in cents. */
export function mpCollectorFees(p: MpPaymentLike): number {
  return (p.fee_details ?? [])
    .filter((f) => f.fee_payer === "collector" && typeof f.amount === "number")
    .reduce((s, f) => s + decimalToCents(f.amount ?? 0), 0);
}

/** Only non-personal, non-sensitive fields are kept for reconciliation snapshots. */
export function sanitizeMpPayment(p: MpPaymentLike): Record<string, unknown> {
  return {
    id: p.id,
    status: p.status,
    status_detail: p.status_detail,
    transaction_amount: p.transaction_amount,
    transaction_amount_refunded: p.transaction_amount_refunded,
    net_received_amount: p.transaction_details?.net_received_amount,
    fee_details: p.fee_details,
    payment_method_id: p.payment_method_id,
    payment_type_id: p.payment_type_id,
    installments: p.installments,
    external_reference: p.external_reference,
    date_created: p.date_created,
    date_approved: p.date_approved,
    live_mode: p.live_mode,
    card_last_four: p.card?.last_four_digits,
  };
}

/** MP expects ISO-8601 with offset; Brazil (São Paulo) is fixed UTC-03:00 since 2019. */
export function toMpDate(d: Date): string {
  const shifted = new Date(d.getTime() - 3 * 3600_000);
  return shifted.toISOString().replace("Z", "-03:00");
}

export function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/);
  const first = parts.shift() ?? full;
  return { first_name: first, last_name: parts.join(" ") || first };
}
