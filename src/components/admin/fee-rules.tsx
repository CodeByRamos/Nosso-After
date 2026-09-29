"use client";

import { useActionState, useTransition } from "react";
import { createFeeRuleAction, toggleFeeRuleAction, type ActionState } from "@/app/admin/actions";
import { toLocalInput } from "@/lib/format";
import { FormField, Notice, btn, input } from "./ui";

export function FeeRuleForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createFeeRuleAction, undefined);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-stone-200 p-4">
      <p className="text-sm font-semibold">Nova regra de taxa</p>
      <p className="text-xs text-stone-500">
        A regra mais específica vence (evento &gt; organização &gt; global; método específico &gt; qualquer). Pedidos já
        criados guardam a taxa calculada e não mudam.
      </p>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Nome">
          <input name="name" required className={input} />
        </FormField>
        <FormField label="Organização">
          <select name="organizationId" className={input} defaultValue="">
            <option value="">Todas (global)</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="ID do evento (opcional)">
          <input name="eventId" className={input} placeholder="uuid" />
        </FormField>
        <FormField label="Método">
          <select name="paymentMethod" className={input} defaultValue="">
            <option value="">Todos</option>
            <option value="PIX">Pix</option>
            <option value="CREDIT_CARD">Cartão</option>
          </select>
        </FormField>
        <FormField label="Base">
          <select name="appliesPer" className={input} defaultValue="TICKET">
            <option value="TICKET">Por ingresso</option>
            <option value="ORDER">Por pedido</option>
          </select>
        </FormField>
        <FormField label="Prioridade">
          <input name="priority" type="number" defaultValue={0} className={input} />
        </FormField>
        <FormField label="Valor fixo (R$)">
          <input name="fixedAmount" defaultValue="0,00" inputMode="decimal" required className={input} />
        </FormField>
        <FormField label="Percentual (%)">
          <input name="percentage" defaultValue="0" inputMode="decimal" required className={input} />
        </FormField>
        <div />
        <FormField label="Vigente a partir de">
          <input name="activeFrom" type="datetime-local" defaultValue={toLocalInput(new Date())} required className={input} />
        </FormField>
        <FormField label="Até (opcional)">
          <input name="activeUntil" type="datetime-local" className={input} />
        </FormField>
      </div>
      <button disabled={pending} className={btn.primary}>{pending ? "Salvando…" : "Criar regra"}</button>
    </form>
  );
}

export function FeeRuleToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => void (await toggleFeeRuleAction(id, !active)))}
      className="text-xs text-stone-600 underline"
    >
      {active ? "Desativar" : "Ativar"}
    </button>
  );
}
