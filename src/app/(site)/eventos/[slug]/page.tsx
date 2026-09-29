import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BatchPicker } from "@/components/site/batch-picker";
import { formatTime, formatWeekdayDate } from "@/lib/format";
import { getPublicEventBySlug } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getPublicEventBySlug((await params).slug);
  if (!data) return { title: "Evento não encontrado", robots: { index: false } };
  const { event, venue } = data;
  const description = `${formatWeekdayDate(event.startsAt)} · ${venue?.city ?? "Guarujá"}/${venue?.state ?? "SP"}. ${event.description.slice(0, 140)}`;
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

  return (
    <article className="grain">
      <script
        type="application/ld+json"
        // JSON-LD is data, not executable script; "<" is escaped to prevent tag injection.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="mx-auto max-w-5xl px-4 pb-8 pt-10 sm:pt-16">
        <p className="text-sm text-sunset first-letter:uppercase">
          {formatWeekdayDate(event.startsAt)} · {formatTime(event.startsAt)} às {formatTime(event.endsAt)}
        </p>
        <h1 className="display mt-3 text-6xl sm:text-8xl">{event.name}</h1>
        <p className="mt-4 text-sand-2">
          {venue ? `${venue.name} · ${venue.city}/${venue.state}` : "Local a confirmar"}
          {event.ageRating ? ` · ${event.ageRating}` : ""}
        </p>
        {lowest !== null && (
          <p className="mt-2 text-sm text-mute">
            A partir de <strong className="text-sand">{(lowest / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong> + taxa de serviço
          </p>
        )}
      </header>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 pb-20 lg:grid-cols-[1fr_380px]">
        <section className="order-2 lg:order-1">
          <h2 className="mb-3 text-xs uppercase tracking-[0.3em] text-mute">Sobre</h2>
          <div className="whitespace-pre-line leading-relaxed text-sand-2">{event.description}</div>
          {venue?.mapsUrl && (
            <a href={venue.mapsUrl} className="mt-6 inline-block text-sm text-sea underline" rel="noopener noreferrer" target="_blank">
              Ver no mapa
            </a>
          )}
        </section>

        <aside className="order-1 lg:order-2" aria-label="Ingressos">
          <div className="rounded-2xl border border-line bg-ink-2 p-5 lg:sticky lg:top-20">
            <h2 className="display text-3xl">Ingressos</h2>
            {sale.ok ? (
              <BatchPicker
                eventSlug={event.slug}
                batches={batches.map((b) => ({
                  id: b.id,
                  label: `${b.typeName} · ${b.name}`,
                  description: b.typeDescription,
                  price: b.price,
                  max: Math.min(b.maxPerCustomer, b.available),
                  state: b.state,
                }))}
              />
            ) : (
              <p className="mt-4 rounded-xl bg-ink-3 p-4 text-sand-2">{sale.reason}</p>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}
