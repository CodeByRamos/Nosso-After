"use client";

import { useActionState, useState } from "react";
import { refundAction, type ActionState } from "@/app/admin/actions";
import { formatBRL } from "@/lib/format";
import { FormField, Notice, btn, input } from "./ui";

export function RefundForm({ orderId, refundable }: { orderId: string; refundable: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(refundAction, undefined);
  const [mode, setMode] = useState<"FULL" | "PARTIAL">("FULL");
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(mode === "FULL" ? `Reembolsar ${formatBRL(refundable)} e cancelar os ingressos?` : "Enviar reembolso parcial ao PSP?")) e.preventDefault();
      }}
      className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-4"
    >
      <p className="text-sm font-semibold">Solicitar reembolso</p>
      <p className="text-xs text-stone-500">
        O pedido de reembolso vai para o PSP. O pedido e os ingressos só mudam quando o PSP confirma a devolução.
      </p>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="FULL" checked={mode === "FULL"} onChange={() => setMode("FULL")} /> Total ({formatBRL(refundable)})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="PARTIAL" checked={mode === "PARTIAL"} onChange={() => setMode("PARTIAL")} /> Parcial
        </label>
      </div>
      {mode === "PARTIAL" && (
        <FormField label="Valor (R$)" hint="Reembolso parcial não cancela ingressos automaticamente.">
          <input name="amount" inputMode="decimal" placeholder="10,00" className={`${input} max-w-[160px]`} required />
        </FormField>
      )}
      <FormField label="Motivo (fica na auditoria)">
        <input name="reason" required minLength={5} className={input} />
      </FormField>
      <button disabled={pending} className={btn.danger}>{pending ? "Enviando ao PSP…" : "Reembolsar"}</button>
    </form>
  );
}
