"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/format";
import type { ClientPaymentConfig } from "@/server/payments/provider";

export interface CardSubmit {
  token: string;
  paymentMethodId: string;
  issuerId?: string | null;
  installments: number;
  document?: string;
}

/**
 * Card entry. PAN/CVV are NEVER handled by our code:
 *  - mercadopago: Card Payment Brick renders PCI-compliant secure fields (iframes) and returns a token.
 *  - mock (DEMO): no card fields at all — the tester picks an outcome and a test token is used.
 */
export function CardPaymentForm(props: {
  config: ClientPaymentConfig;
  amount: number;
  busy: boolean;
  onSubmit: (c: CardSubmit) => Promise<void> | void;
  nonce?: string;
}) {
  if (props.config.provider === "mercadopago") return <MercadoPagoBrick {...props} />;
  return <DemoCardForm {...props} />;
}

function DemoCardForm({ amount, busy, onSubmit }: { amount: number; busy: boolean; onSubmit: (c: CardSubmit) => Promise<void> | void }) {
  const [scenario, setScenario] = useState<"approve" | "decline">("approve");
  const [installments, setInstallments] = useState(1);
  return (
    <div className="rounded-2xl border border-dashed border-warn/60 p-5">
      <p className="font-semibold text-warn">Cartão — modo DEMO</p>
      <p className="mt-1 text-sm text-sand-2">
        Nenhum dado de cartão é digitado ou transmitido. Escolha o resultado que o simulador de PSP deve retornar.
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Resultado simulado</legend>
        {(["approve", "decline"] as const).map((s) => (
          <label key={s} className="flex items-center gap-3 text-sm">
            <input type="radio" name="scenario" checked={scenario === s} onChange={() => setScenario(s)} className="size-4 accent-sunset" />
            {s === "approve" ? "Aprovar pagamento" : "Recusar (saldo insuficiente)"}
          </label>
        ))}
      </fieldset>
      <label className="mt-4 block text-sm">
        Parcelas
        <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-line bg-ink-3 px-3 py-2">
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}× de {formatBRL(Math.ceil(amount / n))}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit({ token: scenario === "approve" ? "mock_tok_approve" : "mock_tok_decline", paymentMethodId: "demo", installments })}
        className="mt-5 w-full rounded-full bg-sunset py-4 font-bold uppercase tracking-wider text-ink disabled:opacity-50"
      >
        {busy ? "Enviando…" : `Pagar ${formatBRL(amount)}`}
      </button>
    </div>
  );
}

// ---- Mercado Pago Card Payment Brick (MercadoPago.js v2) ----

interface MpBrickFormData {
  token: string;
  issuer_id?: string;
  payment_method_id: string;
  installments: number;
  payer?: { identification?: { type?: string; number?: string } };
}
interface MpBricksController {
  unmount: () => void;
}
interface MpInstance {
  bricks: () => {
    create: (
      type: "cardPayment",
      containerId: string,
      settings: {
        initialization: { amount: number };
        customization?: Record<string, unknown>;
        callbacks: {
          onReady: () => void;
          onSubmit: (data: MpBrickFormData) => Promise<void>;
          onError: (err: unknown) => void;
        };
      },
    ) => Promise<MpBricksController>;
  };
}
declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts?: { locale?: string }) => MpInstance;
  }
}

function MercadoPagoBrick({
  config,
  amount,
  onSubmit,
  nonce,
}: {
  config: ClientPaymentConfig;
  amount: number;
  onSubmit: (c: CardSubmit) => Promise<void> | void;
  nonce?: string;
}) {
  const [loaded, setLoaded] = useState(typeof window !== "undefined" && !!window.MercadoPago);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<MpBricksController | null>(null);
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (!loaded || !window.MercadoPago || !config.publicKey) return;
    let cancelled = false;
    const mp = new window.MercadoPago(config.publicKey, { locale: "pt-BR" });
    mp.bricks()
      .create("cardPayment", "mp-card-brick", {
        initialization: { amount: amount / 100 },
        customization: { paymentMethods: { maxInstallments: 12 }, visual: { style: { theme: "dark" } } },
        callbacks: {
          onReady: () => undefined,
          onSubmit: async (data) => {
            const doc = data.payer?.identification?.type === "CPF" ? data.payer.identification.number?.replace(/\D/g, "") : undefined;
            await submitRef.current({
              token: data.token,
              paymentMethodId: data.payment_method_id,
              issuerId: data.issuer_id ?? null,
              installments: data.installments,
              document: doc,
            });
          },
          onError: () => setError("Não foi possível carregar o formulário de cartão."),
        },
      })
      .then((c) => {
        if (cancelled) c.unmount();
        else controller.current = c;
      })
      .catch(() => setError("Não foi possível carregar o formulário de cartão."));
    return () => {
      cancelled = true;
      controller.current?.unmount();
      controller.current = null;
    };
  }, [loaded, config.publicKey, amount]);

  return (
    <div>
      <Script src="https://sdk.mercadopago.com/js/v2" nonce={nonce} strategy="afterInteractive" onLoad={() => setLoaded(true)} />
      {config.environment === "SANDBOX" && (
        <p className="mb-3 text-xs text-warn">SANDBOX: use os cartões de teste do Mercado Pago.</p>
      )}
      <div id="mp-card-brick" />
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
