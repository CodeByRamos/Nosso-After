"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatBRL } from "@/lib/format";
import type { PaymentEnvironment } from "@/server/payments/provider";
import type { OrderView } from "@/server/services/orders";
import { Expiry, StatusBox } from "./order-ui";

export function PixPanel({
  order,
  environment,
  busy,
  onRetry,
  onSimulated,
}: {
  order: OrderView;
  environment: PaymentEnvironment;
  busy: boolean;
  onRetry: () => void;
  onSimulated: () => Promise<void>;
}) {
  const p = order.payment;
  const code = p && p.status === "PENDING" ? p.pixQrCode : null;
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (code) {
      QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => alive && setSvg(s));
    }
    return () => {
      alive = false;
    };
  }, [code]);

  if (!p || busy) return <StatusBox tone="info" title="Gerando Pix…" text="Um instante." />;
  if (["FAILED", "CANCELLED", "EXPIRED"].includes(p.status)) {
    return (
      <StatusBox tone="error" title="Não foi possível gerar o Pix" text={p.failureMessage ?? "Tente novamente."}>
        <button type="button" onClick={onRetry} className="mt-3 rounded-full bg-sunset px-5 py-2 font-bold text-ink">
          Gerar novo Pix
        </button>
      </StatusBox>
    );
  }
  if (p.status !== "PENDING") return <StatusBox tone="info" title="Confirmando pagamento…" text="Recebemos a notificação e estamos confirmando com o processador." />;

  async function copy() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function simulate() {
    if (!p) return;
    setSimulating(true);
    setSimError(null);
    try {
      await api(`/api/dev/mock-psp/${p.id}`, { method: "POST", body: JSON.stringify({ action: "pay_pix" }) });
      await onSimulated();
    } catch (e) {
      setSimError(e instanceof ApiError ? e.message : "Falha na simulação");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-ink-2 p-5 text-center">
      <p className="text-sm text-sand-2">Pague {formatBRL(order.total)} com Pix</p>
      <div className="mx-auto mt-4 w-64 max-w-full rounded-xl bg-white p-3">
        {svg ? <div role="img" aria-label="QR Code Pix" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="aspect-square animate-pulse bg-sand-2/30" />}
      </div>
      <ol className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm text-sand-2">
        <li>1. Abra o app do seu banco e escolha Pix.</li>
        <li>2. Escaneie o QR Code ou use o copia e cola.</li>
        <li>3. Confirme. A aprovação aparece aqui automaticamente.</li>
      </ol>
      <div className="mt-4 rounded-xl bg-ink-3 p-3 text-left">
        <p className="break-all font-mono text-xs text-sand-2">{code}</p>
      </div>
      <button type="button" onClick={copy} className="mt-3 w-full rounded-full bg-sunset py-3.5 font-bold uppercase tracking-wider text-ink">
        {copied ? "Copiado!" : "Copiar código Pix"}
      </button>
      <p className="mt-4 flex items-center justify-center gap-2 text-sm text-sand-2">
        <span className="size-2 animate-pulse rounded-full bg-warn" aria-hidden /> Aguardando pagamento
      </p>
      <Expiry expiresAt={p.pixExpiresAt ?? order.expiresAt} />

      {environment === "DEMO" && (
        <div className="mt-6 rounded-xl border border-dashed border-warn/60 p-4 text-left text-sm">
          <p className="font-semibold text-warn">Modo DEMO</p>
          <p className="mt-1 text-sand-2">
            Este Pix é simulado e não pode ser pago num banco. O botão abaixo faz o simulador de PSP aprovar a cobrança e
            enviar um webhook assinado, que passa pelo mesmo fluxo de confirmação usado em produção.
          </p>
          <button type="button" onClick={simulate} disabled={simulating} className="mt-3 rounded-full border border-warn px-4 py-2 font-semibold text-warn disabled:opacity-50">
            {simulating ? "Simulando…" : "Simular pagamento do Pix"}
          </button>
          {simError && <p className="mt-2 text-danger">{simError}</p>}
        </div>
      )}
    </section>
  );
}
