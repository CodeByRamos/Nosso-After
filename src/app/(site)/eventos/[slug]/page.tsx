import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgeStamp, Chevrons, FlyerDate, LogoLockup } from "@/components/brand/brand";
import { BatchPicker } from "@/components/site/batch-picker";
import { EventPoster } from "@/components/site/event-bits";
import { editionTheme, flyerDate, parseHighlights, parseLineup } from "@/lib/brand";
import { formatBRL, formatTime, formatWeekdayDate } from "@/lib/format";
import { getPublicEventBySlug } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getPublicEventBySlug((await params).slug);
  if (!data) return { title: "Evento não encontrado", robots: { index: false } };
  const { event, venue } = data;
  const description = `${flyerDate(event.startsAt)} · ${formatWeekdayDate(event.startsAt)} · ${venue?.city ?? "Guarujá"}/${venue?.state ?? "SP"}. ${event.description.slice(0, 140)}`;
  const indexable = event.status === "PUBLISHED" || event.status === "SOLD_OUT";
  return {
    title: event.name,
    description,
    alternates: { canonical: `/eventos/${event.slug}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: event.name,
      description,
      type: "website",
      url: `/eventos/${event.slug}`,
      images: event.coverImageUrl ? [{ url: event.coverImageUrl }] : undefined,
    },
    twitter: { card: "summary_large_image", title: event.name, description },
  };
}

export default async function EventPage({ params }: Props) {
  const data = await getPublicEventBySlug((await params).slug);
  if (!data) notFound();
  const { event, venue, batches, sale } = data;
  const onSale = batches.filter((b) => b.state === "ON_SALE");
  const lowest = onSale.length ? Math.min(...onSale.map((b) => b.price)) : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    startDate: event.startsAt.toISOString(),
    endDate: event.endsAt.toISOString(),
    eventStatus:
      event.status === "CANCELLED" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    description: event.description,
    image: event.coverImageUrl ? [event.coverImageUrl] : undefined,
    location: venue
      ? {
          "@type": "Place",
          name: venue.name,
          address: { "@type": "PostalAddress", streetAddress: venue.addressLine ?? undefined, addressLocality: venue.city, addressRegion: venue.state, addressCountry: "BR" },
        }
      : undefined,
    organizer: { "@type": "Organization", name: "Nosso After" },
    offers: batches.map((b) => ({
      "@type": "Offer",
      name: `${b.typeName} · ${b.name}`,
      price: (b.price / 100).toFixed(2),
      priceCurrency: "BRL",
      availability: b.state === "ON_SALE" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      url: `${process.env.APP_URL ?? ""}/eventos/${event.slug}`,
    })),
  };

  const lineup = parseLineup(event.lineup);
  const highlights = parseHighlights(event.highlights);
  const place = venue ? [venue.name, venue.addressLine, `${venue.city}/${venue.state}`].filter(Boolean).join(" • ") : "Local a confirmar";

  return (
    <article style={editionTheme(event.accentColor)}>
      <script
        type="application/ld+json"
        // JSON-LD is data, not executable script; "<" is escaped to prevent tag injection.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      {/* ---- flyer header ---- */}
      <header className="tex-halftone relative overflow-hidden px-4 pb-10 pt-8 sm:pb-16 sm:pt-12">
        <span aria-hidden className="dot-grid absolute right-4 top-5 h-12 w-16" />
        <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
          {event.coverImageUrl ? (
            <div className="relative order-2 mx-auto w-full max-w-xs sm:max-w-sm lg:order-1 lg:max-w-none">
              <span aria-hidden className="absolute inset-0 translate-x-3 translate-y-3 bg-edition" />
              <EventPoster src={event.coverImageUrl} alt={`Arte do evento ${event.name}`} priority className="frame relative" />
            </div>
          ) : (
            <div className="order-2 grid place-items-center border-2 border-fg/15 py-12 lg:order-1">
              <LogoLockup size="lg" tagline="festas" />
            </div>
          )}

          <div className="relative order-1 flex gap-4 lg:order-2">
            <div className="min-w-0 flex-1">
              <p className="type-label text-accent">Nosso After apresenta</p>
              <h1 className="type-display mt-3 break-words text-6xl text-edition sm:text-8xl">{event.name}</h1>
              <div className="mt-6">
                <FlyerDate date={event.startsAt} size="lg" />
              </div>
              <p className="type-label mt-4 leading-relaxed text-fg">
                {venue?.mapsUrl ? (
                  <a href={venue.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-edition decoration-2 underline-offset-4">
                    {place}
                  </a>
                ) : (
                  place
                )}
              </p>
              <p className="mt-2 text-sm text-muted">
                Até {formatTime(event.endsAt)}
                {event.ageRating ? ` · ${event.ageRating}` : ""}
              </p>

              {lineup.length > 0 && (
                <section aria-labelledby="lineup-title" className="mt-8">
                  <h2 id="lineup-title" className="type-label text-edition">Line-up</h2>
                  <ul className="mt-3 space-y-1">
                    {lineup.map((a) => (
                      <li key={a} className="type-headline text-2xl sm:text-3xl">{a}</li>
                    ))}
                  </ul>
                </section>
              )}

              {lowest !== null && (
                <a href="#ingressos" className="btn btn-primary mt-8 w-full text-base sm:w-auto">
                  Ingressos a partir de {formatBRL(lowest)} <Chevrons />
                </a>
              )}
            </div>
            <AgeStamp rating={event.ageRating} className="hidden shrink-0 self-stretch text-center sm:block" />
          </div>
        </div>
      </header>

      {highlights.length > 0 && (
        <section aria-labelledby="perks-title" className="border-y-2 border-fg/10 bg-surface px-4 py-8">
          <div className="mx-auto max-w-6xl">
            <h2 id="perks-title" className="sr-only">Benefícios</h2>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
              {highlights.map((h) => (
                <li key={h.title} className="border-l-2 border-edition pl-3">
                  <p className="type-label text-fg">{h.title}</p>
                  {h.detail && <p className="type-label mt-1 text-[0.6875rem] text-edition">{h.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ---- tickets + about ---- */}
      <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-28 pt-12 lg:grid-cols-[1fr_24rem] lg:pb-20">
        <section id="ingressos" aria-labelledby="tickets-title" className="scroll-mt-20 lg:order-2">
          <div className="lg:sticky lg:top-24">
            <h2 id="tickets-title" className="type-headline text-4xl">Ingressos</h2>
            {sale.ok ? (
              <BatchPicker
                eventSlug={event.slug}
                batches={batches.map((b) => ({
                  id: b.id,
                  label: b.name,
                  typeName: b.typeName,
                  description: b.typeDescription,
                  price: b.price,
                  max: Math.min(b.maxPerCustomer, b.available),
                  state: b.state,
                  lowStock: b.state === "ON_SALE" && b.available <= 10,
                }))}
              />
            ) : (
              <p className="mt-4 border-2 border-fg/15 p-4 text-fg-2">{sale.reason}</p>
            )}
          </div>
        </section>

        <section aria-labelledby="about-title" className="lg:order-1">
          <h2 id="about-title" className="type-label text-edition">Sobre a festa</h2>
          <div className="mt-4 max-w-prose whitespace-pre-line text-lg leading-relaxed text-fg-2">{event.description}</div>
          <div className="mt-10 border-l-4 border-accent bg-surface p-5 text-sm text-fg-2">
            <p className="type-label text-fg">Compra oficial</p>
            <p className="mt-2">
              Pix aprova na hora e o ingresso com QR Code aparece na tela e no seu e-mail. Cada QR vale uma entrada.
            </p>
          </div>
        </section>
      </div>
    </article>
  );
}
