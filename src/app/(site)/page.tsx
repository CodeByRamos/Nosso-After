import Link from "next/link";
import { BrandMarquee, Chevrons, FlyerDate, InstagramIcon, LogoLockup } from "@/components/brand/brand";
import { availabilitySticker, EventPoster } from "@/components/site/event-bits";
import { BRAND, editionTheme, parseLineup } from "@/lib/brand";
import { formatBRL } from "@/lib/format";
import { listPublishedEvents } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

type EventItem = Awaited<ReturnType<typeof listPublishedEvents>>[number];

export default async function HomePage() {
  const events = await listPublishedEvents(12);
  const [next] = events;

  return (
    <>
      <Hero next={next} />
      <BrandMarquee items={[BRAND.tagline, BRAND.claim]} />

      <section id="agenda" aria-labelledby="agenda-title" className="scroll-mt-20 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-end justify-between gap-4">
            <h2 id="agenda-title" className="type-headline text-4xl sm:text-5xl">
              Agenda
            </h2>
            <span aria-hidden className="dot-grid hidden h-9 w-24 sm:block" />
          </div>
          {events.length === 0 ? (
            <div className="mt-8 border-2 border-fg/15 p-8">
              <p className="type-headline text-2xl">Nenhuma data aberta agora.</p>
              <p className="mt-2 text-fg-2">As próximas festas são anunciadas primeiro no Instagram.</p>
              <a href={BRAND.instagram} target="_blank" rel="noopener noreferrer" className="btn btn-ghost mt-6">
                Seguir {BRAND.instagramHandle} <Chevrons />
              </a>
            </div>
          ) : (
            <ul className="mt-8 grid gap-4">
              {events.map((e) => (
                <li key={e.id}>
                  <EventRow event={e} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <HowItWorks />

      <section aria-labelledby="ig-title" className="border-t-2 border-fg/10 px-4 py-16">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="type-label text-muted">Line-ups, lotes e novidades saem primeiro lá</p>
            <h2 id="ig-title" className="type-headline mt-2 text-3xl sm:text-4xl">
              Acompanhe no Instagram
            </h2>
          </div>
          <a href={BRAND.instagram} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            <InstagramIcon /> {BRAND.instagramHandle} <span className="sr-only">(abre em nova aba)</span>
          </a>
        </div>
      </section>
    </>
  );
}

function Hero({ next }: { next?: EventItem }) {
  return (
    <section
      aria-label="Nosso After"
      className="tex-halftone relative overflow-hidden px-4 pb-14 pt-8 sm:pb-20 sm:pt-14"
    >
      <span aria-hidden className="hazard absolute bottom-6 left-4 h-4 w-28 sm:w-40" />
      <span aria-hidden className="dot-grid absolute right-4 top-6 h-12 w-16 opacity-80" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col items-start">
          <LogoLockup size="xl" tagline="festas" className="self-center lg:self-start" />
          <p className="type-headline mt-6 -rotate-1 self-center bg-accent px-3 py-1.5 text-xl text-on-accent lg:self-start">
            {BRAND.claim}
          </p>

          {next ? (
            <div className="mt-10 w-full" style={editionTheme(next.accentColor)}>
              <p className="type-label text-edition">Próxima data</p>
              <div className="mt-3">
                <FlyerDate date={next.startsAt} size="lg" />
              </div>
              <h1 className="type-headline mt-5 text-4xl sm:text-5xl">{next.name}</h1>
              <p className="type-label mt-3 text-fg-2">
                {[next.venueName, next.city && `${next.city}/${next.state}`].filter(Boolean).join(" • ")}
              </p>
              {parseLineup(next.lineup).length > 0 && (
                <p className="mt-3 text-fg-2">{parseLineup(next.lineup).slice(0, 3).join(" · ")}</p>
              )}
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href={`/eventos/${next.slug}`} className="btn btn-primary w-full text-base sm:w-auto">
                  Garantir ingresso <Chevrons />
                </Link>
                {next.minPrice !== null && (
                  <span className="text-sm text-fg-2">
                    a partir de <strong className="tabular text-fg">{formatBRL(next.minPrice)}</strong> + taxa
                  </span>
                )}
              </div>
            </div>
          ) : (
            <h1 className="sr-only">Nosso After — {BRAND.tagline}</h1>
          )}
        </div>

        {next?.coverImageUrl && (
          <Link
            href={`/eventos/${next.slug}`}
            style={editionTheme(next.accentColor)}
            className="group relative mx-auto block w-full max-w-md"
          >
            <span aria-hidden className="absolute inset-0 translate-x-3 translate-y-3 bg-edition" />
            <EventPoster src={next.coverImageUrl} alt={`Arte do evento ${next.name}`} priority className="frame relative" />
          </Link>
        )}
      </div>
    </section>
  );
}

function EventRow({ event: e }: { event: EventItem }) {
  const lineup = parseLineup(e.lineup);
  return (
    <Link
      href={`/eventos/${e.slug}`}
      style={editionTheme(e.accentColor)}
      className="group grid gap-5 border-2 border-fg/15 bg-surface p-5 transition-colors hover:border-edition sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-8 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4 sm:block">
        <FlyerDate date={e.startsAt} size="sm" />
        <span className="sm:hidden">{availabilitySticker(e)}</span>
      </div>
      <div className="min-w-0">
        <span className="hidden sm:inline-block">{availabilitySticker(e)}</span>
        <h3 className="type-headline mt-2 text-3xl text-fg group-hover:text-edition sm:text-4xl">{e.name}</h3>
        <p className="type-label mt-2 text-fg-2">
          {[e.venueName, e.city && `${e.city}/${e.state}`].filter(Boolean).join(" • ")}
        </p>
        {lineup.length > 0 && <p className="mt-2 truncate text-sm text-muted">{lineup.join(" · ")}</p>}
      </div>
      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
        {e.minPrice !== null && (
          <p className="text-sm text-fg-2">
            a partir de <span className="type-date block text-2xl text-fg">{formatBRL(e.minPrice)}</span>
          </p>
        )}
        <span className="type-label inline-flex items-center gap-2 text-edition">
          Ingressos <Chevrons />
        </span>
      </div>
    </Link>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Escolha o lote", d: "Preço, taxa e total aparecem antes de pagar." },
    { n: "02", t: "Pix ou cartão", d: "Pix aprova na hora. Sem cadastro, sem senha." },
    { n: "03", t: "QR no celular", d: "O ingresso chega na tela e no seu e-mail. É só mostrar na entrada." },
  ];
  return (
    <section aria-labelledby="how-title" className="border-t-2 border-fg/10 bg-surface px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <h2 id="how-title" className="type-headline text-3xl sm:text-4xl">
          Compra oficial, <span className="text-primary">direto com a produção</span>
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-4 border-l-4 border-accent bg-bg p-4 sm:block sm:p-5">
              <span className="type-date text-3xl text-accent">{s.n}</span>
              <div>
                <p className="type-headline text-xl sm:mt-3">{s.t}</p>
                <p className="mt-1 text-sm text-fg-2 sm:mt-2">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
