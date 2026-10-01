import Link from "next/link";
import { InstagramIcon, LogoLockup } from "@/components/brand/brand";
import { BRAND } from "@/lib/brand";
import { env } from "@/server/lib/env";

/** Compact text mark for dense places (admin, login fallback). */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`type-display text-2xl tracking-wide ${className}`}>
      Nosso <span className="text-primary">After</span>
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
    <div role="status" className="bg-accent px-4 py-1.5 text-center text-xs font-bold text-on-accent">
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
      <header className="sticky top-0 z-30 border-b-2 border-fg/10 bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" aria-label="Nosso After — início" className="-ml-1 py-1">
            <LogoLockup size="sm" tagline="none" />
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-3">
            <Link href="/#agenda" className="type-label hidden px-3 py-3 text-fg-2 hover:text-fg sm:inline-block">
              Agenda
            </Link>
            <a
              href={BRAND.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Instagram ${BRAND.instagramHandle} (abre em nova aba)`}
              className="grid size-11 place-items-center text-fg-2 hover:text-fg"
            >
              <InstagramIcon />
            </a>
            <Link href="/#agenda" className="btn btn-primary min-h-10 px-4 py-2 text-xs">
              Ingressos
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="tex-halftone border-t-2 border-fg/10 bg-bg">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-[auto_1fr] sm:items-end">
        <div>
          <LogoLockup size="md" tagline="festas" />
          <p className="type-label mt-4 text-accent">{BRAND.claim}</p>
        </div>
        <div className="flex flex-col gap-6 sm:items-end">
          <a
            href={BRAND.instagram}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 text-fg hover:text-edition"
          >
            <InstagramIcon className="size-6" />
            <span className="type-headline text-xl">{BRAND.instagramHandle}</span>
            <span className="sr-only">(abre em nova aba)</span>
          </a>
          <nav aria-label="Institucional" className="type-label flex flex-wrap gap-x-6 gap-y-3 text-muted">
            <Link href="/termos" className="hover:text-fg">Termos de uso</Link>
            <Link href="/privacidade" className="hover:text-fg">Privacidade</Link>
            <Link href="/login" className="hover:text-fg">Produção</Link>
          </nav>
          <p className="text-xs text-muted">Eventos para maiores de 18 anos. Beba com moderação.</p>
        </div>
      </div>
    </footer>
  );
}
