"use client";

import { useActionState } from "react";
import { anonymizeAction } from "@/app/admin/privacy-actions";
import type { ActionState } from "@/app/admin/action-runner";
import { Notice } from "./ui";

export function AnonymizeForm({ customerId }: { customerId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(anonymizeAction, undefined);
  if (state?.ok) return <Notice tone="ok">{state.ok}</Notice>;
  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="customerId" value={customerId} />
      <input name="reason" required minLength={10} placeholder="Solicitação (protocolo, data, canal)" className="w-full rounded border border-stone-300 px-2 py-1 text-xs" />
      <input name="confirm" required placeholder="Digite ANONIMIZAR" className="w-full rounded border border-stone-300 px-2 py-1 text-xs" />
      <button disabled={pending} className="text-xs font-semibold text-rose-600 underline">{pending ? "…" : "Anonimizar titular"}</button>
      {state?.error && <p className="text-xs text-rose-600">{state.error}</p>}
      {state?.fields && <p className="text-xs text-rose-600">{Object.values(state.fields).join(" · ")}</p>}
    </form>
  );
}
