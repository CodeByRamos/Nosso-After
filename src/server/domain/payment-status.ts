/**
 * Normalized payment status + transition rules (ADR-0004).
 * The PSP is the source of truth, but webhooks can arrive out of order: a transition that would move
 * a payment "backwards" (e.g. PAID → PENDING) is ignored instead of applied.
 */
export const PAYMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
  "EXPIRED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PROCESSING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "EXPIRED"],
  PROCESSING: ["AUTHORIZED", "PAID", "FAILED", "CANCELLED", "EXPIRED"],
  AUTHORIZED: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK"],
  PARTIALLY_REFUNDED: ["REFUNDED", "CHARGEBACK"],
  // The PSP confirmed money arrived after we considered the attempt dead (e.g. late Pix).
  // We must follow the PSP; the order layer decides whether it can still be fulfilled.
  FAILED: ["PAID"],
  CANCELLED: ["PAID"],
  EXPIRED: ["PAID"],
  REFUNDED: [],
  CHARGEBACK: ["PAID", "REFUNDED"], // dispute resolved in the seller's favor / refunded
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

/** Statuses that hold the order's single "active" payment slot. */
export const ACTIVE_PAYMENT_STATUSES: readonly PaymentStatus[] = ["PENDING", "PROCESSING", "AUTHORIZED", "PAID"];

export const isSettledSuccess = (s: PaymentStatus) => s === "PAID" || s === "PARTIALLY_REFUNDED";
export const isTerminalFailure = (s: PaymentStatus) => s === "FAILED" || s === "CANCELLED" || s === "EXPIRED";
