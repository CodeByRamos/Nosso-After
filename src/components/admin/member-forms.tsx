"use client";

import { useActionState, useState, useTransition } from "react";
import { addMemberAction, changeRoleAction, removeMemberAction } from "@/app/admin/members-actions";
import type { ActionState } from "@/app/admin/action-runner";
import { formatDateTime } from "@/lib/format";
import { FormField, Notice, Td, btn, input } from "./ui";

export const ROLE_LABEL: Record<string, string> = {
  ORGANIZATION_ADMIN: "Admin da organização",
  EVENT_MANAGER: "Gerente de evento",
  CHECKIN_OPERATOR: "Portaria",
  PROMOTER: "Promoter",
};

export function AddMemberForm({ organizationId, promoters }: { organizationId: string; promoters: { id: string; name: string; code: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMemberAction, undefined);
  const [role, setRole] = useState("CHECKIN_OPERATOR");
  return (
    <form action={action} className="space-y-3">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome"><input name="name" required className={input} /></FormField>
        <FormField label="E-mail"><input name="email" type="email" required className={input} /></FormField>
        <FormField label="Papel">
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={input}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        {role === "PROMOTER" && (
          <FormField label="Promoter vinculado">
            <select name="promoterId" required className={input}>
              <option value="">Escolha…</option>
              {promoters.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </FormField>
        )}
        <FormField label="Senha provisória (só para usuário novo)" hint="Mín. 12 caracteres, letras e números. Troca obrigatória no 1º acesso.">
          <input name="initialPassword" type="password" autoComplete="new-password" className={input} />
        </FormField>
      </div>
      <button disabled={pending} className={btn.primary}>{pending ? "Adicionando…" : "Adicionar"}</button>
    </form>
  );
}

interface Member {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  mfa: boolean;
  lastLoginAt: string | null;
  promoterCode: string | null;
  self: boolean;
}

export function MemberRow({ member: m }: { member: Member }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const act = (fn: () => Promise<ActionState>) => start(async () => { const r = await fn(); setMsg(r?.error ?? r?.ok ?? null); });
  return (
    <tr>
      <Td className="font-medium">{m.name}{m.self && <span className="ml-1 text-xs text-stone-400">(você)</span>}</Td>
      <Td>{m.email}</Td>
      <Td>
        {m.self || m.role === "PROMOTER" ? (
          <span>{ROLE_LABEL[m.role]}{m.promoterCode ? ` · ${m.promoterCode}` : ""}</span>
        ) : (
          <select
            defaultValue={m.role}
            disabled={pending}
            onChange={(e) => act(() => changeRoleAction(m.membershipId, e.target.value))}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            {["ORGANIZATION_ADMIN", "EVENT_MANAGER", "CHECKIN_OPERATOR"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        )}
      </Td>
      <Td>{m.mfa ? "✓" : "—"}</Td>
      <Td className="text-xs text-stone-500">{m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "nunca"}</Td>
      <Td>
        {!m.self && (
          <button
            disabled={pending}
            onClick={() => confirm(`Remover o acesso de ${m.name}?`) && act(() => removeMemberAction(m.membershipId))}
            className="text-xs text-rose-600 underline"
          >
            Remover
          </button>
        )}
        {msg && <span className="ml-2 text-xs text-stone-500">{msg}</span>}
      </Td>
    </tr>
  );
}
