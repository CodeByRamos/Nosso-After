import Link from "next/link";
import { env } from "@/server/lib/env";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`display text-2xl tracking-wide ${className}`}>
      Nosso<span className="text-sunset">After</span>
    </span>
  );
}

/** Always tells the buyer when payments are not real (DEMO/SANDBOX). */
export function PaymentEnvBanner() {
  const e = env();
  const mode =
    e.PAYMENT_PROVIDER === "mock" ? "DEMO" : e.MERCADOPAGO_ENVIRONMENT === "sandbox" ? "SANDBOX" : "PRODUCTION";
  if (mode === "PRODUCTION") return null;
  return (
    <div role="status" className="bg-warn px-4 py-1.5 text-center text-xs font-semibold text-ink">
      {mode === "DEMO"
        ? "MODO DEMO — pagamentos simulados localmente. Nenhum valor é cobrado."
        : "SANDBOX — ambiente de testes do PSP. Nenhum valor real é cobrado."}
    </div>
  );
}

export function SiteHeader() {
  return (
    <>
      <PaymentEnvBanner />
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" aria-label="Nosso After — início">
            <Wordmark />
          </Link>
          <span className="text-xs uppercase tracking-[0.2em] text-mute">Guarujá · SP</span>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line/60 py-10 text-sm text-mute">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
        <Wordmark className="text-lg text-sand" />
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/termos" className="hover:text-sand">Termos de uso</Link>
          <Link href="/privacidade" className="hover:text-sand">Privacidade</Link>
          <a href="mailto:contato@nossoafter.com.br" className="hover:text-sand">Contato</a>
        </nav>
      </div>
    </footer>
  );
}
