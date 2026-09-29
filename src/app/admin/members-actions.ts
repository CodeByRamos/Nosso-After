"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { addMember, changeMemberRole, membershipOrganizationId, removeMember } from "@/server/services/members";
import { memberFormSchema } from "@/validators/admin";
import { uuidSchema } from "@/validators/common";
import { formObject, run, type ActionState } from "./action-runner";

export async function addMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const input = memberFormSchema.parse(formObject(form));
    assertCan(auth, "members:manage", input.organizationId);
    await addMember(input, auth.user.id);
    revalidatePath("/admin/members");
    return {
      ok: input.initialPassword
        ? "Membro criado. Passe a senha provisória por um canal seguro; ela será trocada no primeiro acesso."
        : "Membro adicionado.",
    };
  });
}

const roleSchema = z.enum(["ORGANIZATION_ADMIN", "EVENT_MANAGER", "CHECKIN_OPERATOR"]);

async function guard(membershipId: string, actorId: string, auth: Parameters<typeof assertCan>[0]) {
  const id = uuidSchema.parse(membershipId);
  const m = await membershipOrganizationId(id);
  if (!m) throw new AppError("NOT_FOUND", "Membro não encontrado.");
  assertCan(auth, "members:manage", m.organizationId);
  if (m.userId === actorId) throw new AppError("FORBIDDEN", "Você não pode alterar o próprio acesso.");
  return id;
}

export async function changeRoleAction(membershipId: string, role: string): Promise<ActionState> {
  return run(async (auth) => {
    const id = await guard(membershipId, auth.user.id, auth);
    await changeMemberRole(id, roleSchema.parse(role), auth.user.id);
    revalidatePath("/admin/members");
    return { ok: "Papel alterado." };
  });
}

export async function removeMemberAction(membershipId: string): Promise<ActionState> {
  return run(async (auth) => {
    const id = await guard(membershipId, auth.user.id, auth);
    await removeMember(id, auth.user.id);
    revalidatePath("/admin/members");
    return { ok: "Acesso removido." };
  });
}
