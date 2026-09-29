import Link from "next/link";
import { formatWeekdayDate, formatTime } from "@/lib/format";
import { listPublishedEvents } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await listPublishedEvents(12);
  const [featured, ...rest] = events;

  return (
    <div className="grain">
      <section className="mx-auto max-w-5xl px-4 pb-10 pt-14 sm:pt-20">
        <p className="text-xs uppercase tracking-[0.3em] text-sunset">Guarujá · Litoral de SP</p>
        <h1 className="display mt-4 text-[22vw] leading-[0.85] sm:text-[9rem]">
          Nosso
          <br />
          <span className="text-sunset">After</span>
        </h1>
        <p className="mt-6 max-w-md text-base text-sand-2">
          Quando a festa acaba, a gente continua. Ingressos oficiais, direto com a produção. Pix na hora, sem cadastro.
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-20" aria-labelledby="proximos">
        <h2 id="proximos" className="mb-4 text-xs uppercase tracking-[0.3em] text-mute">
          Próximas datas
        </h2>
        {!featured ? (
          <p className="rounded-2xl border border-line p-8 text-sand-2">
            Nenhuma data com vendas abertas agora. Volte em breve.
          </p>
        ) : (
          <div className="grid gap-4">
            <EventCard event={featured} featured />
            {rest.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EventCard({
  event,
  featured = false,
}: {
  event: Awaited<ReturnType<typeof listPublishedEvents>>[number];
  featured?: boolean;
}) {
  return (
    <Link
      href={`/eventos/${event.slug}`}
      className={`group flex flex-col justify-between gap-6 rounded-2xl border border-line bg-ink-2/80 p-6 transition hover:border-sunset sm:flex-row sm:items-end ${featured ? "sm:p-8" : ""}`}
    >
      <div>
        <p className="text-sm text-sunset first-letter:uppercase">
          {formatWeekdayDate(event.startsAt)} · {formatTime(event.startsAt)}
        </p>
        <h3 className={`display mt-2 ${featured ? "text-5xl sm:text-6xl" : "text-3xl"}`}>{event.name}</h3>
        <p className="mt-2 text-sm text-sand-2">
          {[event.venueName, event.city && `${event.city}/${event.state}`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <span className="inline-flex items-center justify-center rounded-full bg-sunset px-6 py-3 text-sm font-bold uppercase tracking-wider text-ink transition group-hover:bg-sunset-2">
        {event.status === "SOLD_OUT" ? "Esgotado" : "Ingressos"}
      </span>
    </Link>
  );
}
