import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { idempotencyKeys } from "@/server/db/schema";
import { sha256Hex } from "./crypto";
import { AppError, isAppError } from "./errors";
import { logger } from "./logger";

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;
const LOCK_SECONDS = 60;
const RETENTION_HOURS = 48;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Stripe-style idempotency for financial endpoints.
 *
 * - Same key + same payload → the stored response is replayed, the handler does NOT run again.
 * - Same key + different payload → 422 IDEMPOTENCY_MISMATCH.
 * - Same key while the first request is still running → 409 IDEMPOTENCY_IN_PROGRESS.
 * - Business errors (4xx) are stored (deterministic); unexpected failures release the key so the
 *   client can safely retry.
 */
export async function withIdempotency<T>(
  opts: { scope: string; key: string | null; request: unknown },
  handler: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (!opts.key || !KEY_PATTERN.test(opts.key)) {
    throw new AppError("VALIDATION_ERROR", "Header Idempotency-Key ausente ou inválido (8-128 caracteres).");
  }
  const db = getDb();
  const requestHash = sha256Hex(stableStringify(opts.request));
  const now = new Date();

  const [claimed] = await db
    .insert(idempotencyKeys)
    .values({
      scope: opts.scope,
      key: opts.key,
      requestHash,
      lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000),
      expiresAt: new Date(now.getTime() + RETENTION_HOURS * 3600_000),
    })
    .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
    .returning({ id: idempotencyKeys.id });

  let recordId = claimed?.id;
  if (!recordId) {
    const existing = await db.query.idempotencyKeys.findFirst({
      where: and(eq(idempotencyKeys.scope, opts.scope), eq(idempotencyKeys.key, opts.key)),
    });
    if (!existing) throw new AppError("IDEMPOTENCY_IN_PROGRESS", "Tente novamente em instantes.");
    if (existing.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_MISMATCH", "Idempotency-Key já usada com outro conteúdo.");
    }
    if (existing.status === "COMPLETED") {
      return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true };
    }
    // IN_PROGRESS: take over only if the previous holder's lock expired (crashed mid-request).
    const [takeover] = await db
      .update(idempotencyKeys)
      .set({ lockedUntil: new Date(Date.now() + LOCK_SECONDS * 1000) })
      .where(and(eq(idempotencyKeys.id, existing.id), eq(idempotencyKeys.status, "IN_PROGRESS"), lt(idempotencyKeys.lockedUntil, new Date())))
      .returning({ id: idempotencyKeys.id });
    if (!takeover) throw new AppError("IDEMPOTENCY_IN_PROGRESS", "Requisição idêntica em processamento.");
    recordId = takeover.id;
  }

  try {
    const result = await handler();
    await db
      .update(idempotencyKeys)
      .set({ status: "COMPLETED", responseStatus: result.status, responseBody: result.body as object })
      .where(eq(idempotencyKeys.id, recordId));
    return { ...result, replayed: false };
  } catch (e) {
    if (isAppError(e) && e.status < 500 && e.code !== "RATE_LIMITED") {
      const body = { error: { code: e.code, message: e.message } };
      await db
        .update(idempotencyKeys)
        .set({ status: "COMPLETED", responseStatus: e.status, responseBody: body })
        .where(eq(idempotencyKeys.id, recordId));
    } else {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, recordId)).catch((err) => {
        logger.error("idempotency.release_failed", { err });
      });
    }
    throw e;
  }
}

export async function purgeExpiredIdempotencyKeys() {
  const res = await getDb().delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, sql`now()`));
  return res.rowCount ?? 0;
}
