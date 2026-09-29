import { describe, expect, it } from "vitest";
import { AppError } from "@/server/lib/errors";
import { withIdempotency } from "@/server/lib/idempotency";

const key = () => `test_${crypto.randomUUID()}`;

describe("idempotency keys", () => {
  it("replays the stored response and does not run the handler twice", async () => {
    const k = key();
    let runs = 0;
    const handler = async () => ({ status: 201, body: { n: ++runs } });
    const first = await withIdempotency({ scope: "t", key: k, request: { a: 1 } }, handler);
    const second = await withIdempotency({ scope: "t", key: k, request: { a: 1 } }, handler);
    expect(first).toMatchObject({ status: 201, body: { n: 1 }, replayed: false });
    expect(second).toMatchObject({ status: 201, body: { n: 1 }, replayed: true });
    expect(runs).toBe(1);
  });

  it("treats key order in the payload as the same request", async () => {
    const k = key();
    await withIdempotency({ scope: "t", key: k, request: { a: 1, b: 2 } }, async () => ({ status: 200, body: {} }));
    await expect(withIdempotency({ scope: "t", key: k, request: { b: 2, a: 1 } }, async () => ({ status: 200, body: {} }))).resolves.toMatchObject({ replayed: true });
  });

  it("rejects the same key with a different payload", async () => {
    const k = key();
    await withIdempotency({ scope: "t", key: k, request: { a: 1 } }, async () => ({ status: 200, body: {} }));
    await expect(withIdempotency({ scope: "t", key: k, request: { a: 2 } }, async () => ({ status: 200, body: {} }))).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("blocks a concurrent duplicate while the first is in flight", async () => {
    const k = key();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withIdempotency({ scope: "t", key: k, request: {} }, async () => {
      await gate;
      return { status: 200, body: { ok: true } };
    });
    await new Promise((r) => setTimeout(r, 50));
    await expect(withIdempotency({ scope: "t", key: k, request: {} }, async () => ({ status: 200, body: {} }))).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    release();
    await expect(first).resolves.toMatchObject({ body: { ok: true } });
  });

  it("stores business errors but releases the key on unexpected failures", async () => {
    const k1 = key();
    const biz = () => withIdempotency({ scope: "t", key: k1, request: {} }, async () => { throw new AppError("SOLD_OUT", "x"); });
    await expect(biz()).rejects.toMatchObject({ code: "SOLD_OUT" });
    await expect(withIdempotency({ scope: "t", key: k1, request: {} }, async () => ({ status: 200, body: {} }))).resolves.toMatchObject({ status: 409, replayed: true });

    const k2 = key();
    await expect(withIdempotency({ scope: "t", key: k2, request: {} }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withIdempotency({ scope: "t", key: k2, request: {} }, async () => ({ status: 200, body: { retried: true } }))).resolves.toMatchObject({ body: { retried: true }, replayed: false });
  });

  it("requires a well-formed key", async () => {
    await expect(withIdempotency({ scope: "t", key: null, request: {} }, async () => ({ status: 200, body: {} }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(withIdempotency({ scope: "t", key: "short", request: {} }, async () => ({ status: 200, body: {} }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
