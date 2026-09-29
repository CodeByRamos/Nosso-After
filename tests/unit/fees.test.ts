import { describe, expect, it } from "vitest";
import { computeQuote, resolveFeeRule, type FeeRuleLike } from "@/server/domain/fees";
import { applyBps, centsToDecimal, decimalToCents } from "@/server/domain/money";

const base = (over: Partial<FeeRuleLike>): FeeRuleLike => ({
  id: over.id ?? "r",
  name: "r",
  organizationId: null,
  eventId: null,
  paymentMethod: null,
  appliesPer: "TICKET",
  fixedAmount: 0,
  percentageBps: 0,
  priority: 0,
  activeFrom: new Date("2020-01-01"),
  activeUntil: null,
  isActive: true,
  createdAt: new Date("2020-01-01"),
  ...over,
});
const ctx = { organizationId: "org", eventId: "ev", paymentMethod: "PIX" as const, at: new Date("2026-09-28") };

describe("money", () => {
  it("rounds basis points half-up in integer cents", () => {
    expect(applyBps(10_000, 790)).toBe(790); // 7.90% of R$100
    expect(applyBps(3_333, 1_000)).toBe(333); // 333.3 → 333
    expect(applyBps(3_335, 1_000)).toBe(334); // 333.5 → 334 (half-up)
    expect(() => applyBps(100, 10_001)).toThrow();
    expect(() => applyBps(1.5, 10)).toThrow();
  });
  it("converts cents ↔ decimal without float drift", () => {
    expect(centsToDecimal(10_790)).toBe(107.9);
    expect(decimalToCents(107.9)).toBe(10_790);
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
  });
});

describe("fee rule resolution", () => {
  it("prefers event > organization > global, then method-specific", () => {
    const rules = [
      base({ id: "global" }),
      base({ id: "org", organizationId: "org" }),
      base({ id: "org-pix", organizationId: "org", paymentMethod: "PIX" }),
      base({ id: "event", organizationId: "org", eventId: "ev" }),
    ];
    expect(resolveFeeRule(rules, ctx)?.id).toBe("event");
    expect(resolveFeeRule(rules.slice(0, 3), ctx)?.id).toBe("org-pix");
    expect(resolveFeeRule(rules.slice(0, 3), { ...ctx, paymentMethod: "CREDIT_CARD" })?.id).toBe("org");
  });
  it("ignores inactive, future, expired and foreign rules", () => {
    const rules = [
      base({ id: "off", isActive: false, eventId: "ev" }),
      base({ id: "future", activeFrom: new Date("2030-01-01"), eventId: "ev" }),
      base({ id: "expired", activeUntil: new Date("2026-01-01"), eventId: "ev" }),
      base({ id: "other-org", organizationId: "x" }),
      base({ id: "global" }),
    ];
    expect(resolveFeeRule(rules, ctx)?.id).toBe("global");
    expect(resolveFeeRule([], ctx)).toBeNull();
  });
  it("breaks ties by priority then recency", () => {
    const rules = [
      base({ id: "old", createdAt: new Date("2021-01-01") }),
      base({ id: "new", createdAt: new Date("2022-01-01") }),
      base({ id: "prio", priority: 5, createdAt: new Date("2020-06-01") }),
    ];
    expect(resolveFeeRule(rules, ctx)?.id).toBe("prio");
    expect(resolveFeeRule(rules.slice(0, 2), ctx)?.id).toBe("new");
  });
});

describe("quote", () => {
  it("matches the product brief example: R$100 ticket + R$7,90 fee = R$107,90", () => {
    const q = computeQuote([{ batchId: "b", quantity: 1, unitPrice: 10_000 }], base({ fixedAmount: 790 }));
    expect(q).toMatchObject({ subtotal: 10_000, fee: 790, total: 10_790 });
  });
  it("applies per-ticket fee to every unit and per-order fee once", () => {
    const perTicket = computeQuote([{ batchId: "b", quantity: 3, unitPrice: 3_000 }], base({ fixedAmount: 100, percentageBps: 1_000 }));
    expect(perTicket.lines[0]!.unitFee).toBe(400);
    expect(perTicket).toMatchObject({ subtotal: 9_000, fee: 1_200, total: 10_200 });
    const perOrder = computeQuote(
      [
        { batchId: "a", quantity: 2, unitPrice: 3_000 },
        { batchId: "b", quantity: 1, unitPrice: 4_000 },
      ],
      base({ appliesPer: "ORDER", fixedAmount: 500, percentageBps: 500 }),
    );
    expect(perOrder).toMatchObject({ subtotal: 10_000, fee: 1_000, total: 11_000 });
  });
  it("charges no fee without a rule", () => {
    expect(computeQuote([{ batchId: "b", quantity: 2, unitPrice: 5_000 }], null)).toMatchObject({ fee: 0, total: 10_000, feeRuleId: null });
  });
});
