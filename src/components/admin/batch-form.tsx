"use client";

import { useActionState, useState } from "react";
import { saveBatchAction, type ActionState } from "@/app/admin/actions";
import { centsToInput, toLocalInput } from "@/lib/format";
import { FormField, Notice, btn, input } from "./ui";

interface BatchValues {
  id: string;
  typeName: string;
  name: string;
  price: number;
  quantity: number;
  maxPerCustomer: number;
  salesStart: string | null;
  salesEnd: string | null;
  sortOrder: number;
  status: string;
}

export function BatchForm({ eventId, title, batches }: { eventId: string; title: string; batches?: BatchValues[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBatchAction, undefined);
  const [selectedId, setSelectedId] = useState(batches?.[0]?.id ?? "");
  const b = batches?.find((x) => x.id === selectedId);
  const err = (k: string) => state?.fields?.[k] && <span className="mt-1 block text-xs text-rose-600">{state.fields[k]}</span>;

  return (
    <form action={action} key={b?.id ?? "new"} className="space-y-3 rounded-lg border border-stone-200 p-4">
      <p className="text-sm font-semibold">{title}</p>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <input type="hidden" name="eventId" value={eventId} />
      {batches && (
        <FormField label="Lote">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={input}>
            {batches.map((x) => (
              <option key={x.id} value={x.id}>{x.typeName} · {x.name}</option>
            ))}
          </select>
          <input type="hidden" name="batchId" value={selectedId} />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Tipo de ingresso" hint="Ex.: Pista, Camarote">
          <input name="ticketTypeName" defaultValue={b?.typeName ?? "Pista"} required className={input} />
        </FormField>
        <FormField label="Nome do lote">
          <input name="name" defaultValue={b?.name ?? ""} placeholder="1º Lote" required className={input} />
        </FormField>
        <FormField label="Preço (R$)">
          <input name="price" defaultValue={b ? centsToInput(b.price) : ""} placeholder="30,00" inputMode="decimal" required className={input} />
          {err("price")}
        </FormField>
        <FormField label="Quantidade">
          <input name="quantity" type="number" min={0} defaultValue={b?.quantity ?? 100} required className={input} />
          {err("quantity")}
        </FormField>
        <FormField label="Máx. por comprador">
          <input name="maxPerCustomer" type="number" min={1} max={100} defaultValue={b?.maxPerCustomer ?? 6} required className={input} />
        </FormField>
        <FormField label="Ordem">
          <input name="sortOrder" type="number" min={0} defaultValue={b?.sortOrder ?? 0} className={input} />
        </FormField>
        <FormField label="Início das vendas">
          <input name="salesStart" type="datetime-local" defaultValue={toLocalInput(b?.salesStart)} className={input} />
        </FormField>
        <FormField label="Fim das vendas">
          <input name="salesEnd" type="datetime-local" defaultValue={toLocalInput(b?.salesEnd)} className={input} />
          {err("salesEnd")}
        </FormField>
      </div>
      <FormField label="Status">
        <select name="status" defaultValue={b?.status ?? "DRAFT"} className={input}>
          <option value="DRAFT">Rascunho</option>
          <option value="ACTIVE">Ativo (à venda)</option>
          <option value="PAUSED">Pausado</option>
          <option value="CLOSED">Encerrado</option>
        </select>
      </FormField>
      <button disabled={pending} className={btn.primary}>{pending ? "Salvando…" : "Salvar lote"}</button>
    </form>
  );
}
