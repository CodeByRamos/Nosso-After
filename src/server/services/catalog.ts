/**
 * Read-side for public event pages + shared sale-eligibility rules.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db/client";
import { events, feeRules, ticketBatches, ticketTypes, venues } from "@/server/db/schema";
import { resolveFeeRule, type PaymentMethodCode } from "@/server/domain/fees";

export type EventRow = typeof events.$inferSelect;
export type BatchRow = typeof ticketBatches.$inferSelect;

export function eventOnSale(event: EventRow, now: Date): { ok: true } | { ok: false; reason: string } {
  if (event.deletedAt) return { ok: false, reason: "Evento indisponível." };
  if (event.status === "SOLD_OUT") return { ok: false, reason: "Ingressos esgotados." };
  if (event.status !== "PUBLISHED") return { ok: false, reason: "Vendas indisponíveis para este evento." };
  if (event.endsAt <= now) return { ok: false, reason: "Este evento já aconteceu." };
  if (event.salesStartAt && event.salesStartAt > now) return { ok: false, reason: "As vendas ainda não começaram." };
  if (event.salesEndAt && event.salesEndAt <= now) return { ok: false, reason: "As vendas foram encerradas." };
  return { ok: true };
}

export function batchOnSale(batch: BatchRow, now: Date): { ok: true } | { ok: false; reason: string } {
  if (batch.status !== "ACTIVE") return { ok: false, reason: `${batch.name} indisponível.` };
  if (batch.salesStart && batch.salesStart > now) return { ok: false, reason: `${batch.name} ainda não abriu.` };
  if (batch.salesEnd && batch.salesEnd <= now) return { ok: false, reason: `${batch.name} encerrado.` };
  return { ok: true };
}

export const availableOf = (b: Pick<BatchRow, "quantity" | "soldQuantity" | "reservedQuantity">) =>
  Math.max(0, b.quantity - b.soldQuantity - b.reservedQuantity);

export async function loadActiveFeeRules(db: DbOrTx, organizationId: string, eventId: string) {
  return db
    .select()
    .from(feeRules)
    .where(
      and(
        eq(feeRules.isActive, true),
        sql`(${feeRules.organizationId} IS NULL OR ${feeRules.organizationId} = ${organizationId})`,
        sql`(${feeRules.eventId} IS NULL OR ${feeRules.eventId} = ${eventId})`,
      ),
    );
}

export async function resolveFeeRuleFor(
  db: DbOrTx,
  ctx: { organizationId: string; eventId: string; paymentMethod: PaymentMethodCode; at: Date },
) {
  const rules = await loadActiveFeeRules(db, ctx.organizationId, ctx.eventId);
  return resolveFeeRule(rules, ctx);
}

export async function listPublishedEvents(limit = 20) {
  return getDb()
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      coverImageUrl: events.coverImageUrl,
      status: events.status,
      venueName: venues.name,
      city: venues.city,
      state: venues.state,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        inArray(events.status, ["PUBLISHED", "SOLD_OUT"]),
        isNull(events.deletedAt),
        sql`${events.endsAt} > now()`,
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(limit);
}

export async function getPublicEventBySlug(slug: string) {
  const db = getDb();
  const [row] = await db
    .select({ event: events, venue: venues })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        eq(events.slug, slug),
        isNull(events.deletedAt),
        inArray(events.status, ["PUBLISHED", "SOLD_OUT", "PAUSED", "FINISHED"]),
      ),
    )
    .limit(1);
  if (!row) return null;

  const batches = await db
    .select({ batch: ticketBatches, type: ticketTypes })
    .from(ticketBatches)
    .innerJoin(ticketTypes, eq(ticketTypes.id, ticketBatches.ticketTypeId))
    .where(and(eq(ticketBatches.eventId, row.event.id), inArray(ticketBatches.status, ["ACTIVE", "PAUSED", "CLOSED"])))
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketBatches.sortOrder));

  const now = new Date();
  return {
    event: row.event,
    venue: row.venue,
    batches: batches.map(({ batch, type }) => {
      const onSale = batchOnSale(batch, now);
      const available = availableOf(batch);
      return {
        id: batch.id,
        name: batch.name,
        typeName: type.name,
        typeDescription: type.description,
        price: batch.price,
        maxPerCustomer: batch.maxPerCustomer,
        available,
        state: !onSale.ok
          ? batch.salesStart && batch.salesStart > now
            ? ("UPCOMING" as const)
            : ("CLOSED" as const)
          : available === 0
            ? ("SOLD_OUT" as const)
            : ("ON_SALE" as const),
        salesStart: batch.salesStart,
        salesEnd: batch.salesEnd,
      };
    }),
    sale: eventOnSale(row.event, now),
  };
}
