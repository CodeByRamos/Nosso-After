"use client";

import { useActionState } from "react";
import { saveEventAction, type ActionState } from "@/app/admin/actions";
import { toLocalInput } from "@/lib/format";
import { FormField, Notice, btn, input } from "./ui";

export interface EventFormValues {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  startsAt: string;
  endsAt: string;
  salesStartAt: string | null;
  salesEndAt: string | null;
  ageRating: string | null;
  venueName: string;
  venueAddress: string | null;
  venueCity: string;
  venueState: string;
}

export function EventForm({ orgs, initial }: { orgs: { id: string; name: string }[]; initial?: EventFormValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveEventAction, undefined);
  const err = (k: string) => state?.fields?.[k] && <span className="mt-1 block text-xs text-rose-600">{state.fields[k]}</span>;

  return (
    <form action={action} className="space-y-5 rounded-xl border border-stone-200 bg-white p-5">
      {initial && <input type="hidden" name="eventId" value={initial.id} />}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}

      <FormField label="Organização">
        <select name="organizationId" defaultValue={initial?.organizationId ?? orgs[0]?.id} className={input} disabled={!!initial}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {initial && <input type="hidden" name="organizationId" value={initial.organizationId} />}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nome">
          <input name="name" defaultValue={initial?.name} required className={input} />
          {err("name")}
        </FormField>
        <FormField label="Slug (URL)" hint="/eventos/<slug>">
          <input name="slug" defaultValue={initial?.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" className={input} />
          {err("slug")}
        </FormField>
      </div>

      <FormField label="Descrição">
        <textarea name="description" defaultValue={initial?.description} rows={5} className={input} />
      </FormField>
      <FormField label="Imagem de capa (URL https)">
        <input name="coverImageUrl" defaultValue={initial?.coverImageUrl ?? ""} className={input} />
        {err("coverImageUrl")}
      </FormField>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Data (horário de Brasília)</legend>
        <FormField label="Início">
          <input type="datetime-local" name="startsAt" defaultValue={toLocalInput(initial?.startsAt)} required className={input} />
          {err("startsAt")}
        </FormField>
        <FormField label="Término">
          <input type="datetime-local" name="endsAt" defaultValue={toLocalInput(initial?.endsAt)} required className={input} />
          {err("endsAt")}
        </FormField>
        <FormField label="Início das vendas (opcional)">
          <input type="datetime-local" name="salesStartAt" defaultValue={toLocalInput(initial?.salesStartAt)} className={input} />
        </FormField>
        <FormField label="Fim das vendas (opcional)">
          <input type="datetime-local" name="salesEndAt" defaultValue={toLocalInput(initial?.salesEndAt)} className={input} />
          {err("salesEndAt")}
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-[2fr_2fr_1fr]">
        <legend className="mb-2 text-sm font-semibold">Local</legend>
        <FormField label="Nome do local">
          <input name="venueName" defaultValue={initial?.venueName} required className={input} />
        </FormField>
        <FormField label="Cidade">
          <input name="venueCity" defaultValue={initial?.venueCity ?? "Guarujá"} required className={input} />
        </FormField>
        <FormField label="UF">
          <input name="venueState" defaultValue={initial?.venueState ?? "SP"} maxLength={2} required className={input} />
        </FormField>
        <div className="sm:col-span-3">
          <FormField label="Endereço (opcional)">
            <input name="venueAddress" defaultValue={initial?.venueAddress ?? ""} className={input} />
          </FormField>
        </div>
      </fieldset>

      <FormField label="Classificação etária (opcional)">
        <input name="ageRating" defaultValue={initial?.ageRating ?? ""} placeholder="18+" className={input} />
      </FormField>

      <button disabled={pending} className={btn.primary}>{pending ? "Salvando…" : "Salvar evento"}</button>
    </form>
  );
}
