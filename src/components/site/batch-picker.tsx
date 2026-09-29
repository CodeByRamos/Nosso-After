"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatBRL } from "@/lib/format";

export interface PickerBatch {
  id: string;
  label: string;
  description: string | null;
  price: number;
  max: number;
  state: "ON_SALE" | "SOLD_OUT" | "UPCOMING" | "CLOSED";
}

const STATE_LABEL = { SOLD_OUT: "Esgotado", UPCOMING: "Em breve", CLOSED: "Encerrado" } as const;

export function BatchPicker({ eventSlug, batches }: { eventSlug: string; batches: PickerBatch[] }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const selected = useMemo(() => Object.entries(qty).filter(([, n]) => n > 0), [qty]);
  const subtotal = selected.reduce((s, [id, n]) => s + (batches.find((b) => b.id === id)?.price ?? 0) * n, 0);
  const count = selected.reduce((s, [, n]) => s + n, 0);

  const set = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(n, max)) }));

  function goToCheckout() {
    const items = selected.map(([id, n]) => `${id}:${n}`).join(",");
    router.push(`/eventos/${eventSlug}/checkout?itens=${encodeURIComponent(items)}`);
  }

  return (
    <div className="mt-4">
      <ul className="divide-y divide-line">
        {batches.map((b) => {
          const n = qty[b.id] ?? 0;
          const available = b.state === "ON_SALE" && b.max > 0;
          return (
            <li key={b.id} className="flex items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <p className={`font-semibold ${available ? "" : "text-mute line-through decoration-1"}`}>{b.label}</p>
                <p className="tabular text-sm text-sand-2">
                  {formatBRL(b.price)}
                  {!available && <span className="ml-2 text-xs uppercase tracking-wider text-mute no-underline">{b.state === "ON_SALE" ? "Esgotado" : STATE_LABEL[b.state]}</span>}
                </p>
                {b.description && <p className="mt-1 text-xs text-mute">{b.description}</p>}
              </div>
              {available && (
                <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Quantidade de ${b.label}`}>
                  <button
                    type="button"
                    onClick={() => set(b.id, n - 1, b.max)}
                    disabled={n === 0}
                    className="grid size-10 place-items-center rounded-full border border-line text-xl disabled:opacity-30"
                    aria-label="Diminuir"
                  >
                    −
                  </button>
                  <span className="tabular w-8 text-center text-lg font-semibold" aria-live="polite">{n}</span>
                  <button
                    type="button"
                    onClick={() => set(b.id, n + 1, b.max)}
                    disabled={n >= b.max}
                    className="grid size-10 place-items-center rounded-full border border-line text-xl disabled:opacity-30"
                    aria-label="Aumentar"
                  >
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-sand-2">{count > 0 ? `${count} ingresso${count > 1 ? "s" : ""}` : "Selecione seus ingressos"}</span>
        <span className="tabular text-lg font-semibold">{formatBRL(subtotal)}</span>
      </div>
      <p className="mt-1 text-right text-xs text-mute">+ taxa de serviço, exibida antes de pagar</p>
      <button
        type="button"
        onClick={goToCheckout}
        disabled={count === 0}
        className="mt-4 w-full rounded-full bg-sunset py-4 text-base font-bold uppercase tracking-wider text-ink transition hover:bg-sunset-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Comprar
      </button>
    </div>
  );
}
