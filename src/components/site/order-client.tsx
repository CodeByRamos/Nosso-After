"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { formatBRL, formatDateTime, formatWeekdayDate, TICKET_STATUS_LABEL } from "@/lib/format";
import type { ClientPaymentConfig } from "@/server/payments/provider";
import type { OrderView } from "@/server/services/orders";
import { CardPaymentForm, type CardSubmit } from "./card-payment-form";
import { Expiry, StatusBox } from "./order-ui";
import { PixPanel } from "./pix-panel";

export interface TicketView {
  id: string;
  code: string;
  status: string;
  holderName: string;
  typeName: string;
  batchName: string;
  checkedInAt: string | null;
  qrSvg: string | null;
}

type FullOrder = OrderView & { tickets: TicketView[] };

const TERMINAL = ["PAID", "EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"];

export function OrderClient({ initial, payment, nonce }: { initial: FullOrder; payment: ClientPaymentConfig; nonce?: string }) {
  const [order, setOrder] = useState<FullOrder>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pixRequested = useRef(false);
  const payKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ data: FullOrder }>(`/api/orders/${initial.id}`, { cache: "no-store" });
      setOrder(res.data);
    } catch {
      /* transient; next poll retries */
    }
  }, [initial.id]);

  // Poll while the outcome depends on the PSP (webhook-driven state).
  useEffect(() => {
    if (TERMINAL.includes(order.status)) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [order.status, refresh]);

  const startPayment = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      payKey.current ??= newIdempotencyKey("pay");
      try {
        await api(`/api/payments`, { method: "POST", idempotencyKey: payKey.current, body: JSON.stringify({ orderId: initial.id, ...body }) });
        payKey.current = null;
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && e.status !== 0 && e.status < 500) payKey.current = null;
        setError(e instanceof ApiError ? e.message : "Erro inesperado.");
      } finally {
        setBusy(false);
      }
    },
    [initial.id, refresh],
  );

  // Pix: generate automatically when arriving on the page.
  const p = order.payment;
  const needsPix = order.status === "AWAITING_PAYMENT" && order.paymentMethod === "PIX" && (!p || ["FAILED", "CANCELLED", "EXPIRED"].includes(p.status));
  useEffect(() => {
    if (needsPix && !pixRequested.current) {
      pixRequested.current = true;
      void startPayment({ method: "PIX" });
    }
  }, [needsPix, startPayment]);

  const onCard = (c: CardSubmit) => startPayment({ method: "CREDIT_CARD", card: c });

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-8">
      <p className="text-xs uppercase tracking-[0.3em] text-mute">Pedido {order.code}</p>
      <h1 className="display mt-2 text-5xl">{order.event?.name}</h1>
      {order.event && <p className="mt-1 text-sm text-sunset first-letter:uppercase">{formatWeekdayDate(order.event.startsAt)}</p>}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {order.status === "AWAITING_PAYMENT" && order.paymentMethod === "PIX" && (
        <PixPanel order={order} environment={payment.environment} busy={busy} onRetry={() => startPayment({ method: "PIX" })} onSimulated={refresh} />
      )}

      {order.status === "AWAITING_PAYMENT" && order.paymentMethod === "CREDIT_CARD" && (
        <section className="mt-6">
          {p && ["PROCESSING", "AUTHORIZED"].includes(p.status) ? (
            <StatusBox tone="info" title="Processando pagamento…" text="Estamos aguardando a confirmação do processador. Esta página atualiza sozinha." />
          ) : (
            <>
              {p?.status === "FAILED" && (
                <StatusBox tone="error" title="Pagamento recusado" text={p.failureMessage ?? "Tente outro cartão."} />
              )}
              <CardPaymentForm config={payment} amount={order.total} busy={busy} onSubmit={onCard} nonce={nonce} />
            </>
          )}
          <Expiry expiresAt={order.expiresAt} />
        </section>
      )}

      {order.status === "PAID" || order.status === "PARTIALLY_REFUNDED" ? (
        <section className="mt-6">
          <StatusBox tone="ok" title="Pagamento confirmado!" text={`Enviamos os ingressos para ${order.buyer?.email}. Apresente o QR Code na entrada.`} />
          <Tickets tickets={order.tickets} />
        </section>
      ) : null}

      {order.status === "EXPIRED" && (
        <StatusBox tone="error" title="Reserva expirada" text="O tempo para pagamento acabou e os ingressos voltaram para venda.">
          {order.event && <Link href={`/eventos/${order.event.slug}`} className="mt-3 inline-block font-semibold text-sunset underline">Comprar novamente</Link>}
        </StatusBox>
      )}
      {order.status === "REFUNDED" && <StatusBox tone="info" title="Pedido reembolsado" text="O valor foi devolvido pelo processador de pagamento e os ingressos foram cancelados." />}
      {order.status === "REFUND_PENDING" && (
        <StatusBox tone="info" title="Pagamento recebido após o prazo" text="Os ingressos esgotaram antes da confirmação. Seu reembolso será processado pela produção." />
      )}
      {order.status === "CANCELLED" && <StatusBox tone="error" title="Pedido cancelado" text="Este pedido foi cancelado." />}

      <Summary order={order} />
    </div>
  );
}

function Summary({ order }: { order: FullOrder }) {
  return (
    <section className="mt-8 rounded-2xl border border-line p-4 text-sm">
      {order.items.map((i, idx) => (
        <div key={idx} className="flex justify-between py-1">
          <span>
            {i.quantity}× {i.description}
          </span>
          <span className="tabular">{formatBRL(i.unitPrice * i.quantity)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1 text-sand-2">
        <span>Taxa de serviço</span>
        <span className="tabular">{formatBRL(order.fee)}</span>
      </div>
      <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
        <span>Total</span>
        <span className="tabular">{formatBRL(order.total)}</span>
      </div>
      {order.refunded > 0 && (
        <div className="flex justify-between pt-1 text-sea">
          <span>Reembolsado</span>
          <span className="tabular">−{formatBRL(order.refunded)}</span>
        </div>
      )}
    </section>
  );
}

function Tickets({ tickets }: { tickets: TicketView[] }) {
  if (tickets.length === 0) return <p className="mt-4 text-sm text-sand-2">Emitindo ingressos…</p>;
  return (
    <ul className="mt-6 space-y-4">
      {tickets.map((t) => (
        <li key={t.id} className="overflow-hidden rounded-2xl bg-sand text-ink">
          <div className="flex items-center justify-between bg-sunset px-4 py-2 text-xs font-bold uppercase tracking-wider">
            <span>{t.typeName} · {t.batchName}</span>
            <span>{TICKET_STATUS_LABEL[t.status] ?? t.status}</span>
          </div>
          <div className="flex flex-col items-center gap-3 p-5">
            {t.qrSvg ? (
              // SVG generated server-side by our own QR encoder from the signed payload.
              <div className="w-60 max-w-full" aria-label={`QR Code do ingresso ${t.code}`} role="img" dangerouslySetInnerHTML={{ __html: t.qrSvg }} />
            ) : (
              <p className="py-10 text-center text-sm">
                {t.status === "CHECKED_IN" && t.checkedInAt ? `Utilizado em ${formatDateTime(t.checkedInAt)}` : "Ingresso indisponível"}
              </p>
            )}
            <p className="text-lg font-bold">{t.holderName}</p>
            <p className="tabular font-mono text-sm tracking-widest">{t.code}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
