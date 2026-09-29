/** Money is always integer cents (BRL). See ADR-0007. */
export type Cents = number;

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer (cents), got ${value}`);
  }
}

/** percentage in basis points (1% = 100 bps), rounded half-up to the cent. */
export function applyBps(amount: Cents, bps: number): Cents {
  assertCents(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError(`invalid bps ${bps}`);
  // Integer arithmetic: (amount * bps + 5000) / 10000 floored == half-up rounding.
  return Math.floor((amount * bps + 5_000) / 10_000);
}

/** Cents → decimal number for PSP APIs that expect reais (e.g. 10790 → 107.9). */
export function centsToDecimal(amount: Cents): number {
  assertCents(amount);
  return Number((amount / 100).toFixed(2));
}

/** Decimal reais from a PSP → cents, robust to float noise (107.9 → 10790). */
export function decimalToCents(value: number): Cents {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`invalid decimal amount ${value}`);
  return Math.round(value * 100);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function formatBRL(amount: Cents): string {
  return brl.format(amount / 100);
}
