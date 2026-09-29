import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { requireApiAuth, type AuthContext } from "@/server/auth/session";
import { isAppError } from "@/server/lib/errors";
import { clientIp } from "@/server/lib/http";
import { withLogContext } from "@/server/lib/logger";

/**
 * Shared plumbing for admin Server Actions. Deliberately NOT a "use server" module:
 * exporting `run` from one would expose it as a callable endpoint.
 */
export type ActionState = { error?: string; ok?: string; fields?: Record<string, string> } | undefined;

/** Runs an admin mutation with auth, request context for the audit trail, and uniform errors. */
export async function run(fn: (auth: AuthContext) => Promise<ActionState | void>): Promise<ActionState> {
  const h = await headers();
  try {
    const auth = await requireApiAuth();
    return await withLogContext(
      { request_id: h.get("x-request-id") ?? undefined, user_id: auth.user.id, ip: clientIp(h) ?? undefined, user_agent: h.get("user-agent") ?? undefined },
      async () => (await fn(auth)) ?? { ok: "Salvo." },
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { error: "Revise os campos destacados.", fields: Object.fromEntries(e.issues.map((i) => [i.path.join("."), i.message])) };
    }
    if (isAppError(e)) return { error: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // let redirect() through
    console.error(e);
    return { error: "Erro inesperado." };
  }
}

export const formObject = (f: FormData) => Object.fromEntries([...f.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));

