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
  unitFee: Cents;
  lineSubtotal: Cents;
  lineFee: Cents;
}

export interface Quote {
  lines: QuotedLine[];
  subtotal: Cents;
  discount: Cents;
  fee: Cents;
  total: Cents;
  feeRuleId: string | null;
  feeSnapshot: { fixedAmount: number; percentageBps: number; appliesPer: "TICKET" | "ORDER"; name: string } | null;
}

/**
 * Computes the order quote. Per-ticket fees are computed on the unit price so every ticket carries
 * the same fee (predictable for the buyer). Per-order fees are allocated to the first line for storage.
 */
export function computeQuote(lines: QuoteLine[], rule: FeeRuleLike | null): Quote {
  if (lines.length === 0) throw new RangeError("quote requires at least one line");
  const quoted: QuotedLine[] = lines.map((l) => {
    assertCents(l.unitPrice, "unitPrice");
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new RangeError("quantity must be > 0");
    let unitFee = 0;
    if (rule && rule.appliesPer === "TICKET" && l.unitPrice > 0) {
      unitFee = rule.fixedAmount + applyBps(l.unitPrice, rule.percentageBps);
    }
    return {
      ...l,
      unitFee,
      lineSubtotal: l.unitPrice * l.quantity,
      lineFee: unitFee * l.quantity,
    };
  });

  const subtotal = quoted.reduce((s, l) => s + l.lineSubtotal, 0);
  let fee = quoted.reduce((s, l) => s + l.lineFee, 0);
  if (rule && rule.appliesPer === "ORDER" && subtotal > 0) {
    fee += rule.fixedAmount + applyBps(subtotal, rule.percentageBps);
  }
  const discount = 0; // Coupons arrive in phase 2 (schema already carries discount_amount).
  const total = subtotal - discount + fee;
  for (const v of [subtotal, fee, total]) assertCents(v);

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
  };
}
