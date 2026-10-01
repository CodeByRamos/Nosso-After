"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Chevrons, Sticker } from "@/components/brand/brand";
import { formatBRL } from "@/lib/format";

export interface PickerBatch {
  id: string;
  label: string;
  typeName: string;
  description: string | null;
  price: number;
  max: number;
  state: "ON_SALE" | "SOLD_OUT" | "UPCOMING" | "CLOSED";
  lowStock: boolean;
}

const STATE_LABEL = { SOLD_OUT: "Esgotado", UPCOMING: "Em breve", CLOSED: "Encerrado", ON_SALE: "Esgotado" } as const;

export function BatchPicker({ eventSlug, batches }: { eventSlug: string; batches: PickerBatch[] }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState(false);
  const selected = useMemo(() => Object.entries(qty).filter(([, n]) => n > 0), [qty]);
  const subtotal = selected.reduce((s, [id, n]) => s + (batches.find((b) => b.id === id)?.price ?? 0) * n, 0);
  const count = selected.reduce((s, [, n]) => s + n, 0);

  const set = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(n, max)) }));

  function goToCheckout() {
    setLeaving(true);
    const items = selected.map(([id, n]) => `${id}:${n}`).join(",");
    router.push(`/eventos/${eventSlug}/checkout?itens=${encodeURIComponent(items)}`);
  }

  const cta = (
    <button type="button" onClick={goToCheckout} disabled={count === 0 || leaving} className="btn btn-primary w-full text-base">
      {leaving ? "Abrindo…" : count === 0 ? "Escolha seu lote" : <>Comprar {formatBRL(subtotal)} <Chevrons /></>}
    </button>
  );

  return (
    <div className="mt-5">
      <ul className="space-y-3">
        {batches.map((b) => {
          const n = qty[b.id] ?? 0;
          const available = b.state === "ON_SALE" && b.max > 0;
          return (
            <li
              key={b.id}
              className={`relative flex items-stretch border-2 ${n > 0 ? "border-edition" : "border-fg/15"} ${available ? "bg-surface" : "bg-bg opacity-70"}`}
            >
              {/* ticket stub: perforated divider */}
              <div className="min-w-0 flex-1 border-r-2 border-dashed border-fg/15 p-4">
                <p className="type-label text-muted">{b.typeName}</p>
                <p className="type-headline mt-1 text-xl">{b.label}</p>
                <p className="type-date mt-2 text-2xl">{formatBRL(b.price)}</p>
                {b.description && <p className="mt-1 text-xs text-muted">{b.description}</p>}
                <div className="mt-2">
                  {!available ? (
                    <Sticker tone="muted">{STATE_LABEL[b.state]}</Sticker>
                  ) : b.lowStock ? (
                    <Sticker tone="accent">Últimos ingressos</Sticker>
                  ) : null}
                </div>
              </div>
              <div className="flex w-28 shrink-0 items-center justify-center p-2">
                {available ? (
                  <div className="flex items-center" role="group" aria-label={`Quantidade — ${b.typeName} ${b.label}`}>
                    <button
                      type="button"
                      onClick={() => set(b.id, n - 1, b.max)}
                      disabled={n === 0}
                      className="grid size-11 place-items-center border-2 border-fg/30 text-xl font-bold hover:border-fg disabled:opacity-30"
                      aria-label="Diminuir"
                    >
                      −
                    </button>
                    <output className="type-date w-7 text-center text-xl" aria-live="polite">{n}</output>
                    <button
                      type="button"
                      onClick={() => set(b.id, n + 1, b.max)}
                      disabled={n >= b.max}
                      className="grid size-11 place-items-center bg-edition text-xl font-bold text-on-edition disabled:opacity-30"
                      aria-label="Aumentar"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <span aria-hidden className="type-display text-3xl text-fg/20">×</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">Taxa de serviço exibida antes do pagamento. Máximo por pessoa indicado em cada lote.</p>

      {/* desktop / inline CTA */}
      <div className="mt-5 hidden lg:block">{cta}</div>

      {/* mobile: thumb-reachable bar, appears once something is selected */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t-2 border-edition bg-bg/95 p-3 backdrop-blur transition-transform lg:hidden ${count > 0 ? "translate-y-0" : "translate-y-full"}`}
        aria-hidden={count === 0}
        inert={count === 0}
      >
        <div className="mx-auto flex max-w-md items-center gap-3">
          <p className="shrink-0 text-sm text-fg-2">
            <span className="type-date block text-lg text-fg">{count}×</span>
            ingresso{count > 1 ? "s" : ""}
          </p>
          {cta}
        </div>
      </div>
    </div>
  );
}
