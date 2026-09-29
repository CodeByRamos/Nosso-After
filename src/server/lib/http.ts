import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, isAppError } from "./errors";
import { logger, withLogContext } from "./logger";

/**
 * Client IP. Only the first X-Forwarded-For hop is used, which is trustworthy ONLY behind a proxy that
 * overwrites the header (Vercel, Cloudflare, a configured nginx). See DEPLOYMENT.md.
 */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = xff || headers.get("x-real-ip") || null;
  if (!ip) return null;
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

export function requestIdFrom(headers: Headers) {
  const incoming = headers.get("x-request-id");
  return incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
}

export function errorResponse(e: unknown, requestId: string) {
  if (e instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          fields: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        requestId,
      },
      { status: 400 },
    );
  }
  if (isAppError(e)) {
    if (e.status >= 500) logger.error("request.app_error", { err: e, code: e.code });
    return Response.json({ error: { code: e.code, message: e.message }, requestId }, { status: e.status });
  }
  logger.error("request.unhandled_error", { err: e });
  return Response.json(
    { error: { code: "INTERNAL", message: "Erro inesperado. Tente novamente." }, requestId },
    { status: 500 },
  );
}

type Handler<C> = (req: Request, ctx: C & { requestId: string; ip: string | null }) => Promise<Response>;

/** Wraps a route handler with request id, structured log context, and uniform error mapping. */
export function route<C = unknown>(handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const requestId = requestIdFrom(req.headers);
    const ip = clientIp(req.headers);
    return withLogContext(
      { request_id: requestId, ip: ip ?? undefined, user_agent: req.headers.get("user-agent") ?? undefined },
      async () => {
        try {
          const res = await handler(req, { ...ctx, requestId, ip });
          res.headers.set("x-request-id", requestId);
          if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
          return res;
        } catch (e) {
          return errorResponse(e, requestId);
        }
      },
    );
  };
}

export async function readJson(req: Request, maxBytes = 32_768): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError("VALIDATION_ERROR", "Corpo da requisição muito grande.");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("VALIDATION_ERROR", "Corpo da requisição muito grande.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "JSON inválido.");
  }
}
