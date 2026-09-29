"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { anonymizeCustomer, customerOrganizationId } from "@/server/services/privacy";
import { uuidSchema } from "@/validators/common";
import { formObject, run, type ActionState } from "./action-runner";

const schema = z.object({
  customerId: uuidSchema,
  reason: z.string().trim().min(10, "Descreva a solicitação (protocolo, data, canal)").max(500),
  confirm: z.literal("ANONIMIZAR", { message: "Digite ANONIMIZAR para confirmar" }),
});

export async function anonymizeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const input = schema.parse(formObject(form));
    const orgId = await customerOrganizationId(input.customerId);
    if (!orgId) throw new AppError("NOT_FOUND", "Titular não encontrado.");
    assertCan(auth, "privacy:manage", orgId);
    const r = await anonymizeCustomer(input.customerId, auth.user.id, input.reason);
    revalidatePath("/admin/customers");
    return { ok: `Titular anonimizado (${r.orders} pedido(s), ${r.tickets} ingresso(s)). Registros financeiros mantidos.` };
  });
}
