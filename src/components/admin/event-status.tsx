"use client";

import { useState, useTransition } from "react";
import { setEventStatusAction } from "@/app/admin/actions";

const OPTIONS: Record<string, { to: string; label: string }[]> = {
  DRAFT: [{ to: "PUBLISHED", label: "Publicar" }, { to: "CANCELLED", label: "Cancelar" }],
  PUBLISHED: [{ to: "PAUSED", label: "Pausar vendas" }, { to: "SOLD_OUT", label: "Marcar esgotado" }, { to: "FINISHED", label: "Encerrar" }, { to: "CANCELLED", label: "Cancelar" }],
  PAUSED: [{ to: "PUBLISHED", label: "Retomar vendas" }, { to: "FINISHED", label: "Encerrar" }, { to: "CANCELLED", label: "Cancelar" }],
  SOLD_OUT: [{ to: "PUBLISHED", label: "Reabrir vendas" }, { to: "FINISHED", label: "Encerrar" }],
  FINISHED: [],
  CANCELLED: [],
};

export function EventStatusControls({ eventId, current }: { eventId: string; current: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(OPTIONS[current] ?? []).map((o) => (
        <button
          key={o.to}
          disabled={pending}
          onClick={() => {
            if (o.to === "CANCELLED" && !confirm("Cancelar o evento? Reembolsos precisam ser feitos pedido a pedido.")) return;
            start(async () => {
              const r = await setEventStatusAction(eventId, o.to);
              setMsg(r?.error ?? r?.ok ?? null);
            });
          }}
          className={`rounded-lg border px-3 py-1.5 text-sm ${o.to === "CANCELLED" ? "border-rose-300 text-rose-700" : "border-stone-300 bg-white"}`}
        >
          {o.label}
        </button>
      ))}
      {msg && <span className="text-sm text-stone-500">{msg}</span>}
    </div>
  );
}
