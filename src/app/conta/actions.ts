"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, type ActionState } from "@/app/admin/action-runner";
import { requireApiAuth } from "@/server/auth/session";
import { mfaPolicy } from "@/server/lib/env";
import { isAppError } from "@/server/lib/errors";
import { changePassword, confirmMfa, disableMfa, startMfaEnrollment } from "@/server/services/account";

const pwSchema = z
  .object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200), confirm: z.string().max(200) })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "As senhas não conferem" });

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(
    async (auth) => {
      const input = pwSchema.parse(formObject(form));
      await changePassword(auth.user.id, auth.sessionId, input.current, input.next);
      revalidatePath("/conta");
      return { ok: "Senha alterada. Outras sessões foram encerradas." };
    },
    { allowPendingSetup: true },
  );
}

export async function startMfaAction(): Promise<{ secret?: string; qrSvg?: string; error?: string }> {
  try {
    const auth = await requireApiAuth({ allowPendingSetup: true });
    return await startMfaEnrollment(auth.user.id);
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Erro inesperado." };
  }
}

export async function confirmMfaAction(code: string): Promise<{ codes?: string[]; error?: string }> {
  try {
    const auth = await requireApiAuth({ allowPendingSetup: true });
    const codes = await confirmMfa(auth.user.id, String(code).slice(0, 12));
    revalidatePath("/conta");
    return { codes };
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Erro inesperado." };
  }
}

export async function disableMfaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const policy = mfaPolicy();
    const isAdmin = auth.user.isSuperAdmin || auth.memberships.some((m) => m.role === "ORGANIZATION_ADMIN");
    const required = policy === "all" || (policy === "admins" && isAdmin);
    await disableMfa(auth.user.id, String(form.get("code") ?? "").slice(0, 12), required);
    revalidatePath("/conta");
    return { ok: "MFA desativado." };
  });
}
