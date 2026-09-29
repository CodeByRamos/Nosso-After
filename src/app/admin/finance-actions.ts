"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan, canPlatform } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { issueOrganizationId, resolveIssue, runReconciliation } from "@/server/services/reconciliation";
import { uuidSchema } from "@/validators/common";
import { formObject, run, type ActionState } from "./action-runner";

export async function runReconciliationAction(): Promise<ActionState> {
  return run(async (auth) => {
    const allowed = canPlatform(auth, "platform:admin") || auth.memberships.some((m) => m.role === "ORGANIZATION_ADMIN");
    if (!allowed) throw new AppError("FORBIDDEN", "Sem permissão.");
    await enforceRateLimit(`recon:${auth.user.id}`, 6, 60);
    const r = await runReconciliation();
    revalidatePath("/admin/reports");
    return { ok: `${r.open} divergência(s) encontrada(s), ${r.autoResolved} fechada(s) automaticamente.` };
  });
}

const resolveSchema = z.object({ issueId: uuidSchema, note: z.string().trim().min(5, "Descreva a resolução").max(500) });

export async function resolveIssueAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async (auth) => {
    const input = resolveSchema.parse(formObject(form));
    const orgId = await issueOrganizationId(input.issueId);
    if (orgId === undefined) throw new AppError("NOT_FOUND", "Pendência não encontrada.");
    // Platform-level issues (no organization) can only be handled by the platform.
    if (orgId === null) {
      if (!canPlatform(auth, "platform:admin")) throw new AppError("FORBIDDEN", "Sem permissão.");
    } else {
      assertCan(auth, "reconciliation:manage", orgId);
    }
    await resolveIssue(input.issueId, input.note, auth.user.id);
    revalidatePath("/admin/reports");
    return { ok: "Resolvida." };
  });
}
