import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { events } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { getPublicEventBySlug } from "@/server/services/catalog";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";

/** Public: event details + batch availability (by id). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const id = uuidSchema.parse((await params).id);
  const ev = await getDb().query.events.findFirst({ where: eq(events.id, id), columns: { slug: true } });
  const data = ev ? await getPublicEventBySlug(ev.slug) : null;
  if (!data) throw new AppError("NOT_FOUND", "Evento não encontrado.");
  return Response.json({
    data: {
      id: data.event.id,
      name: data.event.name,
      slug: data.event.slug,
      description: data.event.description,
      startsAt: data.event.startsAt,
      endsAt: data.event.endsAt,
      status: data.event.status,
      venue: data.venue ? { name: data.venue.name, city: data.venue.city, state: data.venue.state } : null,
      onSale: data.sale.ok,
      batches: data.batches,
    },
  });
});
