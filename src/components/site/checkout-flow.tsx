"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { formatBRL, formatWeekdayDate } from "@/lib/format";

interface Item {
  batchId: string;
  label: string;
  unitPrice: number;
  quantity: number;
}
type Method = "PIX" | "CREDIT_CARD";
type Step = "dados" | "pagamento" | "revisao";

interface Quote {
  subtotal: number;
  discount: number;
  fee: number;
  total: number;
  couponCode: string | null;
  lines: { batchId: string; description: string; quantity: number; unitPrice: number; unitDiscount: number; unitFee: number }[];
}

const STEPS: { id: Step; label: string }[] = [
  { id: "dados", label: "Seus dados" },
  { id: "pagamento", label: "Pagamento" },
  { id: "revisao", label: "Revisão" },
];

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}
function maskCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function CheckoutFlow({
  event,
  items,
  methods,
}: {
  event: { id: string; name: string; slug: string; startsAt: string };
  items: Item[];
  methods: { pix: boolean; card: boolean };
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("dados");
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "", document: "", acceptTerms: false, marketingOptIn: false });
  const [method, setMethod] = useState<Method>(methods.pix ? "PIX" : "CREDIT_CARD");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const orderKey = useRef<string | null>(null);

  const payloadItems = items.map((i) => ({ batchId: i.batchId, quantity: i.quantity }));
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  function validateBuyer() {
    const errs: Record<string, string> = {};
    if (buyer.name.trim().split(/\s+/).length < 2) errs.name = "Informe nome e sobrenome";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim())) errs.email = "E-mail inválido";
    if (buyer.phone.replace(/\D/g, "").length < 10) errs.phone = "Telefone inválido";
    const cpf = buyer.document.replace(/\D/g, "");
    if (cpf && cpf.length !== 11) errs.document = "CPF inválido";
    if (!buyer.acceptTerms) errs.acceptTerms = "Aceite os termos para continuar";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function loadQuote(m: Method, couponCode?: string) {
    setBusy(true);
    setError(null);
    setCouponError(null);
    try {
      const res = await api<{ data: Quote }>("/api/orders/quote", {
        method: "POST",
        body: JSON.stringify({ eventId: event.id, items: payloadItems, paymentMethod: m, couponCode }),
      });
      setQuote(res.data);
      setStep("revisao");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Erro ao calcular o total.";
      // A bad coupon must not throw the buyer out of the review step.
      if (couponCode && e instanceof ApiError && e.code === "COUPON_INVALID") setCouponError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    orderKey.current ??= newIdempotencyKey("order");
    try {
      const order = await api<{ data: { id: string } }>("/api/orders", {
        method: "POST",
        idempotencyKey: orderKey.current,
        body: JSON.stringify({
          eventId: event.id,
          items: payloadItems,
          paymentMethod: method,
          couponCode: quote?.couponCode ?? undefined,
          buyer: {
            name: buyer.name.trim(),
            email: buyer.email.trim(),
            phone: buyer.phone,
            document: buyer.document || undefined,
            acceptTerms: buyer.acceptTerms,
            marketingOptIn: buyer.marketingOptIn,
          },
        }),
      });
      // Pix is generated on the order page; card data is typed there, inside the PSP's secure form.
      router.push(`/pedido/${order.data.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        // Definitive answer from the server → a new attempt gets a new key.
        if (e.status !== 0 && e.status < 500) orderKey.current = null;
        setError(e.message);
        if (e.fields?.length) setFieldErrors(Object.fromEntries(e.fields.map((f) => [f.path.replace("buyer.", ""), f.message])));
      } else setError("Erro inesperado.");
      setBusy(false);
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-8">
      <Link href={`/eventos/${event.slug}`} className="text-sm text-mute hover:text-sand">
        ← {event.name}
      </Link>
      <p className="mt-1 text-sm text-sunset first-letter:uppercase">{formatWeekdayDate(event.startsAt)}</p>

      <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s.id} className="text-xs">
            <div className={`h-1 rounded-full ${i <= stepIndex ? "bg-sunset" : "bg-line"}`} />
            <span className={`mt-2 block ${i === stepIndex ? "text-sand" : "text-mute"}`} aria-current={i === stepIndex ? "step" : undefined}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-2xl border border-line bg-ink-2 p-4 text-sm">
        {items.map((i) => (
          <div key={i.batchId} className="flex justify-between py-1">
            <span>
              {i.quantity}× {i.label}
            </span>
            <span className="tabular">{formatBRL(i.unitPrice * i.quantity)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-sand-2">
          <span>Subtotal</span>
          <span className="tabular">{formatBRL(subtotal)}</span>
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {step === "dados" && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validateBuyer()) setStep("pagamento");
          }}
          noValidate
        >
          <Field label="Nome completo" error={fieldErrors.name}>
            <input autoComplete="name" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} className={inputCls} required />
          </Field>
          <Field label="E-mail" hint="Seus ingressos chegam aqui." error={fieldErrors.email}>
            <input type="email" autoComplete="email" inputMode="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} className={inputCls} required />
          </Field>
          <Field label="Celular" error={fieldErrors.phone}>
            <input type="tel" autoComplete="tel-national" inputMode="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: maskPhone(e.target.value) })} className={inputCls} required />
          </Field>
          <Field label="CPF (opcional)" hint="Usado só para identificar o pagador no PSP." error={fieldErrors.document}>
            <input inputMode="numeric" autoComplete="off" value={buyer.document} onChange={(e) => setBuyer({ ...buyer, document: maskCpf(e.target.value) })} className={inputCls} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={buyer.acceptTerms} onChange={(e) => setBuyer({ ...buyer, acceptTerms: e.target.checked })} className="mt-1 size-5 accent-sunset" />
            <span>
              Li e aceito os <Link href="/termos" target="_blank" className="underline">termos de uso</Link> e a{" "}
              <Link href="/privacidade" target="_blank" className="underline">política de privacidade</Link>.
              {fieldErrors.acceptTerms && <span className="block text-danger">{fieldErrors.acceptTerms}</span>}
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-sand-2">
            <input type="checkbox" checked={buyer.marketingOptIn} onChange={(e) => setBuyer({ ...buyer, marketingOptIn: e.target.checked })} className="mt-1 size-5 accent-sunset" />
            <span>Quero receber novidades das próximas datas (opcional).</span>
          </label>
          <PrimaryButton type="submit">Continuar</PrimaryButton>
        </form>
      )}

      {step === "pagamento" && (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-sand-2">Como você quer pagar?</p>
          {methods.pix && (
            <MethodOption selected={method === "PIX"} onSelect={() => setMethod("PIX")} title="Pix" subtitle="Aprovação na hora. QR Code válido durante a reserva." />
          )}
          {methods.card && (
            <MethodOption selected={method === "CREDIT_CARD"} onSelect={() => setMethod("CREDIT_CARD")} title="Cartão de crédito" subtitle="Dados digitados no formulário seguro do processador." />
          )}
          <PrimaryButton onClick={() => loadQuote(method)} disabled={busy}>
            {busy ? "Calculando…" : "Revisar pedido"}
          </PrimaryButton>
          <BackButton onClick={() => setStep("dados")} />
        </div>
      )}

      {step === "revisao" && quote && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-line p-4 text-sm">
            {quote.lines.map((l) => (
              <div key={l.batchId} className="flex justify-between py-1">
                <span>
                  {l.quantity}× {l.description}
                </span>
                <span className="tabular">{formatBRL(l.unitPrice * l.quantity)}</span>
              </div>
            ))}
            {quote.discount > 0 && (
              <div className="flex justify-between py-1 text-sea">
                <span>Cupom {quote.couponCode}</span>
                <span className="tabular">−{formatBRL(quote.discount)}</span>
              </div>
            )}
            <div className="flex justify-between py-1 text-sand-2">
              <span>Taxa de serviço</span>
              <span className="tabular">{formatBRL(quote.fee)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-line pt-3 text-lg font-bold">
              <span>Total</span>
              <span className="tabular">{formatBRL(quote.total)}</span>
            </div>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void loadQuote(method, couponInput.trim() || undefined);
            }}
          >
            <label className="sr-only" htmlFor="coupon">Cupom de desconto</label>
            <input
              id="coupon"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder="Cupom de desconto"
              autoComplete="off"
              maxLength={32}
              className={`${inputCls} py-2.5`}
            />
            {quote.couponCode ? (
              <button type="button" onClick={() => { setCouponInput(""); void loadQuote(method); }} className="shrink-0 rounded-xl border border-line px-4 text-sm">
                Remover
              </button>
            ) : (
              <button type="submit" disabled={busy || !couponInput.trim()} className="shrink-0 rounded-xl border border-line px-4 text-sm disabled:opacity-40">
                Aplicar
              </button>
            )}
          </form>
          {couponError && <p role="alert" className="-mt-2 text-sm text-danger">{couponError}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-mute">Comprador</dt>
            <dd>{buyer.name}</dd>
            <dt className="text-mute">E-mail</dt>
            <dd className="break-all">{buyer.email}</dd>
            <dt className="text-mute">Pagamento</dt>
            <dd>{method === "PIX" ? "Pix" : "Cartão de crédito"}</dd>
          </dl>
          <p className="text-xs text-mute">
            Ao confirmar, seus ingressos ficam reservados por alguns minutos enquanto você paga.
          </p>
          <PrimaryButton onClick={confirm} disabled={busy}>
            {busy ? "Reservando…" : `Confirmar e pagar ${formatBRL(quote.total)}`}
          </PrimaryButton>
          <BackButton onClick={() => setStep("pagamento")} />
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-ink-3 px-4 py-3 text-sand placeholder:text-mute focus:border-sunset focus:outline-none";

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
    </label>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="w-full rounded-full bg-sunset py-4 text-base font-bold uppercase tracking-wider text-ink transition hover:bg-sunset-2 disabled:cursor-wait disabled:opacity-60"
    />
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full py-2 text-sm text-mute hover:text-sand">
      Voltar
    </button>
  );
}

function MethodOption({ selected, onSelect, title, subtitle }: { selected: boolean; onSelect: () => void; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${selected ? "border-sunset bg-sunset/10" : "border-line hover:border-sand-2"}`}
    >
      <span className={`grid size-5 place-items-center rounded-full border-2 ${selected ? "border-sunset" : "border-mute"}`}>
        {selected && <span className="size-2.5 rounded-full bg-sunset" />}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-sand-2">{subtitle}</span>
      </span>
    </button>
  );
}
