"use client";

import { useActionState, useTransition } from "react";
import { createPromoterAction, togglePromoterAction } from "@/app/admin/growth-actions";
import type { ActionState } from "@/app/admin/action-runner";
import { FormField, Notice, btn, input } from "./ui";

export function PromoterForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createPromoterAction, undefined);
  const err = (k: string) => state?.fields?.[k] && <span className="mt-1 block text-xs text-rose-600">{state.fields[k]}</span>;
  return (
    <form action={action} className="space-y-3">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Organização">
          <select name="organizationId" className={input}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </FormField>
        <FormField label="Nome">
          <input name="name" required className={input} />
          {err("name")}
        </FormField>
        <FormField label="Código do link" hint="nossoafter.com/r/CODIGO">
          <input name="code" required placeholder="JOAO" className={`${input} font-mono uppercase`} />
          {err("code")}
        </FormField>
        <FormField label="Comissão (%) sobre ingressos">
          <input name="commissionPercent" defaultValue="0" inputMode="decimal" className={input} />
          {err("commissionPercent")}
        </FormField>
        <FormField label="Comissão fixa por ingresso (R$)">
          <input name="commissionFixed" defaultValue="0,00" inputMode="decimal" className={input} />
          {err("commissionFixed")}
        </FormField>
      </div>
      <button disabled={pending} className={btn.primary}>{pending ? "Criando…" : "Criar promoter"}</button>
    </form>
  );
}

export function PromoterToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(async () => void (await togglePromoterAction(id, !active)))} className="text-xs text-stone-600 underline">
      {active ? "Desativar" : "Ativar"}
    </button>
  );
}
