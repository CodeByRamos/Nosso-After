import { describe, expect, it } from "vitest";
import { signTicketQr, verifyTicketQr, orderAccessToken, verifyOrderAccessToken } from "@/server/lib/tokens";
import { isValidCpf } from "@/validators/common";
import { redact } from "@/server/lib/logger";

const TICKET = "0b7f1c2e-8d3a-4c5b-9e6f-112233445566";

describe("ticket QR payload", () => {
  it("round-trips and contains no personal data", () => {
    const qr = signTicketQr(TICKET, 1);
    expect(qr.startsWith("NA1.")).toBe(true);
    expect(qr).not.toMatch(/@|maria/i);
    expect(verifyTicketQr(qr)).toEqual({ ticketId: TICKET, version: 1 });
  });
  it("rejects tampering, other versions and garbage", () => {
    const qr = signTicketQr(TICKET, 1);
    const [p, id, , mac] = qr.split(".");
    expect(verifyTicketQr(`${p}.${id}.2.${mac}`)).toBeNull(); // version bump without new MAC
    expect(verifyTicketQr(qr.slice(0, -2) + "AA")).toBeNull();
    expect(verifyTicketQr("hello")).toBeNull();
    expect(verifyTicketQr("NA1.x.1.y")).toBeNull();
    expect(verifyTicketQr("A".repeat(500))).toBeNull();
  });
});

describe("order access token", () => {
  it("only validates for its own order", () => {
    const t = orderAccessToken(TICKET);
    expect(verifyOrderAccessToken(TICKET, t)).toBe(true);
    expect(verifyOrderAccessToken("11111111-1111-1111-1111-111111111111", t)).toBe(false);
    expect(verifyOrderAccessToken(TICKET, null)).toBe(false);
  });
});

describe("validation & redaction", () => {
  it("validates CPF check digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });
  it("redacts secrets and card-like numbers from logs", () => {
    const out = JSON.stringify(redact({ password: "p", token: "t", cvv: "123", note: "card 4111 1111 1111 1111", cpf: "52998224725" }));
    expect(out).not.toContain("4111");
    expect(out).not.toContain('"p"');
    expect(out).not.toContain("52998224725");
  });
});
