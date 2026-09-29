"use client";

import { useActionState, useState, useTransition } from "react";
import { createCouponAction, toggleCouponAction } from "@/app/admin/growth-actions";
import type { ActionState } from "@/app/admin/action-runner";
import { toLocalInput } from "@/lib/format";
import { FormField, Notice, btn, input } from "./ui";

export function CouponForm({
  orgs,
  events,
  batches,
}: {
  orgs: { id: string; name: string }[];
  events: { id: string; name: string; organizationId: string }[];
  batches: { id: string; eventId: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCouponAction, undefined);
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [eventId, setEventId] = useState("");
  const [type, setType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const err = (k: string) => state?.fields?.[k] && <span className="mt-1 block text-xs text-rose-600">{state.fields[k]}</span>;

  return (
    <form action={action} className="space-y-3">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Organização">
          <select name="organizationId" value={orgId} onChange={(e) => { setOrgId(e.target.value); setEventId(""); }} className={input}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </FormField>
        <FormField label="Evento">
          <select name="eventId" value={eventId} onChange={(e) => setEventId(e.target.value)} className={input}>
            <option value="">Todos os eventos da organização</option>
            {events.filter((e) => e.organizationId === orgId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </FormField>
        <FormField label="Código">
          <input name="code" required placeholder="VERAO10" className={`${input} font-mono uppercase`} />
          {err("code")}
        </FormField>
        <FormField label="Tipo">
          <select name="type" value={type} onChange={(e) => setType(e.target.value as "PERCENTAGE" | "FIXED")} className={input}>
            <option value="PERCENTAGE">Percentual por ingresso</option>
            <option value="FIXED">Valor fixo por ingresso</option>
          </select>
        </FormField>
        <FormField label={type === "PERCENTAGE" ? "Percentual (%)" : "Valor (R$)"}>
          <input name="value" required inputMode="decimal" placeholder={type === "PERCENTAGE" ? "10" : "10,00"} className={input} />
          {err("value")}
        </FormField>
        <FormField label="Descrição (interna)">
          <input name="description" className={input} />
        </FormField>
        <FormField label="Usos máximos (vazio = ilimitado)">
          <input name="maxRedemptions" type="number" min={1} className={input} />
        </FormField>
        <FormField label="Limite por comprador">
          <input name="perCustomerLimit" type="number" min={1} max={100} defaultValue={1} className={input} />
        </FormField>
        <div />
        <FormField label="Válido a partir de">
          <input name="validFrom" type="datetime-local" required defaultValue={toLocalInput(new Date())} className={input} />
        </FormField>
        <FormField label="Válido até (opcional)">
          <input name="validUntil" type="datetime-local" className={input} />
          {err("validUntil")}
        </FormField>
      </div>
      {eventId && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-stone-600">Restringir a lotes (nenhum marcado = todos)</legend>
          <div className="flex flex-wrap gap-3">
            {batches.filter((b) => b.eventId === eventId).map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="batchIds" value={b.id} /> {b.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button disabled={pending} className={btn.primary}>{pending ? "Criando…" : "Criar cupom"}</button>
    </form>
  );
}

export function CouponToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(async () => void (await toggleCouponAction(id, !active)))} className="text-xs text-stone-600 underline">
      {active ? "Desativar" : "Ativar"}
    </button>
  );
}
