"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { couponOrganizationId, createCoupon, setCouponActive } from "@/server/services/coupons";
import { createPromoter, promoterOrganizationId, setPromoterActive } from "@/server/services/promoters";
import { couponFormSchema, promoterFormSchema } from "@/validators/admin";
import { uuidSchema } from "@/validators/common";
import { formObject, run, type ActionState } from "./action-runner";

export async function createCouponAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const input = couponFormSchema.parse({
      ...formObject(form),
      batchIds: form.getAll("batchIds").filter((v): v is string => typeof v === "string" && v.length > 0),
    });
    assertCan(auth, "events:write", input.organizationId);
    await createCoupon(
      {
        organizationId: input.organizationId,
        eventId: input.eventId,
        code: input.code,
        description: input.description,
        type: input.type,
        value: input.value,
        maxRedemptions: input.maxRedemptions,
        perCustomerLimit: input.perCustomerLimit,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        batchIds: input.batchIds,
      },
      auth.user.id,
    );
    revalidatePath("/admin/coupons");
    return { ok: `Cupom ${input.code} criado.` };
  });
}

export async function toggleCouponAction(couponId: string, active: boolean): Promise<ActionState> {
  return run(async (auth) => {
    const id = uuidSchema.parse(couponId);
    const orgId = await couponOrganizationId(id);
    if (!orgId) throw new AppError("NOT_FOUND", "Cupom não encontrado.");
    assertCan(auth, "events:write", orgId);
    await setCouponActive(id, active, auth.user.id);
    revalidatePath("/admin/coupons");
    return { ok: active ? "Cupom ativado." : "Cupom desativado." };
  });
}

export async function createPromoterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const input = promoterFormSchema.parse(formObject(form));
    assertCan(auth, "events:write", input.organizationId);
    const p = await createPromoter(
      {
        organizationId: input.organizationId,
        name: input.name,
        code: input.code,
        commissionBps: input.commissionPercent,
        commissionFixedPerTicket: input.commissionFixed,
      },
      auth.user.id,
    );
    revalidatePath("/admin/promoters");
    return { ok: `Promoter criado. Link: /r/${p.code}` };
  });
}

export async function togglePromoterAction(promoterId: string, active: boolean): Promise<ActionState> {
  return run(async (auth) => {
    const id = uuidSchema.parse(promoterId);
    const orgId = await promoterOrganizationId(id);
    if (!orgId) throw new AppError("NOT_FOUND", "Promoter não encontrado.");
    assertCan(auth, "events:write", orgId);
    await setPromoterActive(id, active, auth.user.id);
    revalidatePath("/admin/promoters");
    return { ok: active ? "Promoter ativado." : "Promoter desativado." };
  });
}
