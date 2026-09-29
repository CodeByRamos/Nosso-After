import { applyBps, assertCents, type Cents } from "./money";

export type PaymentMethodCode = "PIX" | "CREDIT_CARD";

export interface FeeRuleLike {
  id: string;
  name: string;
  organizationId: string | null;
  eventId: string | null;
  paymentMethod: PaymentMethodCode | null;
  appliesPer: "TICKET" | "ORDER";
  fixedAmount: number;
  percentageBps: number;
  priority: number;
  activeFrom: Date;
  activeUntil: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface FeeContext {
  organizationId: string;
  eventId: string;
  paymentMethod: PaymentMethodCode;
  at: Date;
}

function specificity(rule: FeeRuleLike): number {
  // event > organization > global; a specific payment method breaks ties within a level.
  let score = 0;
  if (rule.eventId) score += 100;
  else if (rule.organizationId) score += 10;
  if (rule.paymentMethod) score += 1;
  return score;
}

export function ruleApplies(rule: FeeRuleLike, ctx: FeeContext): boolean {
  if (!rule.isActive) return false;
  if (rule.activeFrom > ctx.at) return false;
  if (rule.activeUntil && rule.activeUntil <= ctx.at) return false;
  if (rule.organizationId && rule.organizationId !== ctx.organizationId) return false;
  if (rule.eventId && rule.eventId !== ctx.eventId) return false;
  if (rule.paymentMethod && rule.paymentMethod !== ctx.paymentMethod) return false;
  return true;
}

/** Picks the single most specific active rule (ADR-0007). Returns null when none applies. */
export function resolveFeeRule<R extends FeeRuleLike>(rules: R[], ctx: FeeContext): R | null {
  const candidates = rules.filter((r) => ruleApplies(r, ctx));
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      b.priority - a.priority ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return candidates[0] ?? null;
}

export interface QuoteLine {
  batchId: string;
  quantity: number;
  unitPrice: Cents;
}

export interface QuotedLine extends QuoteLine {
  /** Coupon discount per unit (0 when no coupon applies to this batch). */
  unitDiscount: Cents;
  unitFee: Cents;
  lineSubtotal: Cents;
  lineDiscount: Cents;
  lineFee: Cents;
}

/**
 * Coupon as seen by the pricing rules (ADR-0008):
 *  - PERCENTAGE: `value` in basis points off each eligible ticket;
 *  - FIXED: `value` in cents off each eligible ticket, capped at the ticket price.
 * `eligibleBatchIds = null` means every batch of the event.
 */
export interface CouponLike {
  id: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  eligibleBatchIds: ReadonlySet<string> | null;
}

export interface Quote {
  lines: QuotedLine[];
  subtotal: Cents;
  discount: Cents;
  fee: Cents;
  total: Cents;
  feeRuleId: string | null;
  feeSnapshot: { fixedAmount: number; percentageBps: number; appliesPer: "TICKET" | "ORDER"; name: string } | null;
  couponId: string | null;
}

export function unitDiscountFor(coupon: CouponLike | null, batchId: string, unitPrice: Cents): Cents {
  if (!coupon || unitPrice === 0) return 0;
  if (coupon.eligibleBatchIds && !coupon.eligibleBatchIds.has(batchId)) return 0;
  const raw = coupon.type === "PERCENTAGE" ? applyBps(unitPrice, coupon.value) : coupon.value;
  return Math.min(unitPrice, raw);
}

/**
 * Computes the order quote.
 * - The coupon discount is per ticket, so every ticket of a line has the same price.
 * - The service fee is computed on what the buyer actually pays for the ticket (price − discount);
 *   per-order fees use the discounted subtotal.
 */
export function computeQuote(lines: QuoteLine[], rule: FeeRuleLike | null, coupon: CouponLike | null = null): Quote {
  if (lines.length === 0) throw new RangeError("quote requires at least one line");
  const quoted: QuotedLine[] = lines.map((l) => {
    assertCents(l.unitPrice, "unitPrice");
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new RangeError("quantity must be > 0");
    const unitDiscount = unitDiscountFor(coupon, l.batchId, l.unitPrice);
    const effective = l.unitPrice - unitDiscount;
    let unitFee = 0;
    if (rule && rule.appliesPer === "TICKET" && effective > 0) {
      unitFee = rule.fixedAmount + applyBps(effective, rule.percentageBps);
    }
    return {
      ...l,
      unitDiscount,
      unitFee,
      lineSubtotal: l.unitPrice * l.quantity,
      lineDiscount: unitDiscount * l.quantity,
      lineFee: unitFee * l.quantity,
    };
  });

  const subtotal = quoted.reduce((s, l) => s + l.lineSubtotal, 0);
  const discount = quoted.reduce((s, l) => s + l.lineDiscount, 0);
  let fee = quoted.reduce((s, l) => s + l.lineFee, 0);
  if (rule && rule.appliesPer === "ORDER" && subtotal - discount > 0) {
    fee += rule.fixedAmount + applyBps(subtotal - discount, rule.percentageBps);
  }
  const total = subtotal - discount + fee;
  for (const v of [subtotal, discount, fee, total]) assertCents(v);

  return {
    lines: quoted,
    subtotal,
    discount,
    fee,
    total,
    feeRuleId: rule?.id ?? null,
    feeSnapshot: rule
      ? { fixedAmount: rule.fixedAmount, percentageBps: rule.percentageBps, appliesPer: rule.appliesPer, name: rule.name }
      : null,
    couponId: discount > 0 ? (coupon?.id ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Promoter commission (ADR-0008)
// ---------------------------------------------------------------------------

export interface CommissionRule {
  commissionBps: number;
  commissionFixedPerTicket: Cents;
}

/** Commission over ticket revenue actually paid (subtotal − discount); the service fee is excluded. */
export function computeCommission(rule: CommissionRule, ticketRevenue: Cents, tickets: number): Cents {
  assertCents(ticketRevenue);
  const value = rule.commissionFixedPerTicket * tickets + applyBps(ticketRevenue, rule.commissionBps);
  return Math.min(value, ticketRevenue);
}
