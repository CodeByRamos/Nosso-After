"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan, canPlatform, requireApiAuth, type AuthContext } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { events, feeRules } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { AppError, isAppError } from "@/server/lib/errors";
import { clientIp } from "@/server/lib/http";
import { withLogContext } from "@/server/lib/logger";
import { saveBatch, saveEvent, setEventStatus } from "@/server/services/admin-events";
import { orderOrganizationId } from "@/server/services/orders";
import { requestRefund } from "@/server/services/refunds";
import { batchFormSchema, eventFormSchema, eventStatusSchema, feeRuleFormSchema, refundFormSchema } from "@/validators/admin";
import { uuidSchema } from "@/validators/common";

export type ActionState = { error?: string; ok?: string; fields?: Record<string, string> } | undefined;

/** Runs an admin mutation with auth, request context for the audit trail, and uniform errors. */
async function run(fn: (auth: AuthContext) => Promise<ActionState | void>): Promise<ActionState> {
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

const formObject = (f: FormData) => Object.fromEntries([...f.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));

export async function saveEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let createdId: string | undefined;
  const res = await run(async (auth) => {
    const input = eventFormSchema.parse(formObject(form));
    assertCan(auth, "events:write", input.organizationId);
    const eventId = uuidSchema.optional().parse(form.get("eventId") || undefined);
    const id = await saveEvent(input, auth.user.id, eventId);
    revalidatePath("/admin/events");
    if (!eventId) createdId = id;
  });
  if (createdId) redirect(`/admin/events/${createdId}`);
  return res;
}

export async function setEventStatusAction(eventId: string, status: string): Promise<ActionState> {
  return run(async (auth) => {
    const id = uuidSchema.parse(eventId);
    const ev = await getDb().query.events.findFirst({ where: eq(events.id, id) });
    if (!ev) throw new AppError("NOT_FOUND", "Evento não encontrado.");
    assertCan(auth, "events:write", ev.organizationId);
    await setEventStatus(id, eventStatusSchema.parse(status), auth.user.id);
    revalidatePath(`/admin/events/${id}`);
    return { ok: "Status atualizado." };
  });
}

export async function saveBatchAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const raw = formObject(form);
    const input = batchFormSchema.parse({ ...raw, batchId: raw.batchId || undefined });
    const ev = await getDb().query.events.findFirst({ where: eq(events.id, input.eventId) });
    if (!ev) throw new AppError("NOT_FOUND", "Evento não encontrado.");
    assertCan(auth, "events:write", ev.organizationId);
    await saveBatch(input, ev.organizationId, auth.user.id);
    revalidatePath(`/admin/events/${ev.id}`);
    return { ok: input.batchId ? "Lote atualizado." : "Lote criado." };
  });
}

export async function createFeeRuleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    if (!canPlatform(auth, "fees:manage")) throw new AppError("FORBIDDEN", "Apenas a administração da plataforma altera taxas.");
    const input = feeRuleFormSchema.parse(formObject(form));
    await getDb().transaction(async (tx) => {
      const [rule] = await tx
        .insert(feeRules)
        .values({
          name: input.name,
          organizationId: input.organizationId ?? null,
          eventId: input.eventId ?? null,
          paymentMethod: input.paymentMethod ?? null,
          appliesPer: input.appliesPer,
          fixedAmount: input.fixedAmount,
          percentageBps: input.percentage,
          priority: input.priority,
          activeFrom: input.activeFrom,
          activeUntil: input.activeUntil ?? null,
          createdBy: auth.user.id,
        })
        .returning();
      await audit(tx, {
        action: "fee_rule.create",
        entityType: "fee_rule",
        entityId: rule!.id,
        organizationId: input.organizationId ?? null,
        actorType: "USER",
        actorUserId: auth.user.id,
        metadata: { ...input, activeFrom: input.activeFrom.toISOString(), activeUntil: input.activeUntil?.toISOString() },
      });
    });
    revalidatePath("/admin/settings");
    return { ok: "Regra de taxa criada." };
  });
}

export async function toggleFeeRuleAction(ruleId: string, active: boolean): Promise<ActionState> {
  return run(async (auth) => {
    if (!canPlatform(auth, "fees:manage")) throw new AppError("FORBIDDEN", "Sem permissão.");
    const id = uuidSchema.parse(ruleId);
    await getDb().transaction(async (tx) => {
      await tx.update(feeRules).set({ isActive: active, updatedAt: new Date() }).where(eq(feeRules.id, id));
      await audit(tx, { action: "fee_rule.update", entityType: "fee_rule", entityId: id, actorType: "USER", actorUserId: auth.user.id, metadata: { isActive: active } });
    });
    revalidatePath("/admin/settings");
    return { ok: active ? "Regra ativada." : "Regra desativada." };
  });
}

export async function refundAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const input = refundFormSchema.parse(formObject(form));
    const orgId = await orderOrganizationId(input.orderId);
    if (!orgId) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    assertCan(auth, "refunds:create", orgId);
    if (input.mode === "PARTIAL" && !input.amount) throw new AppError("VALIDATION_ERROR", "Informe o valor do reembolso parcial.");
    const refund = await requestRefund({
      orderId: input.orderId,
      amount: input.mode === "PARTIAL" ? input.amount : undefined,
      reason: input.reason,
      actorUserId: auth.user.id,
    });
    revalidatePath(`/admin/orders/${input.orderId}`);
    return {
      ok:
        refund.status === "SUCCEEDED"
          ? "Reembolso confirmado pelo PSP."
          : refund.status === "FAILED"
            ? undefined
            : "Reembolso enviado ao PSP; aguardando confirmação.",
      error: refund.status === "FAILED" ? `PSP recusou: ${refund.failureMessage ?? ""}` : undefined,
    };
  });
}
