import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { events, ticketBatches, ticketTypes, venues } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";
import type { EventFormInput } from "@/validators/admin";
import type { z } from "zod";
import type { batchFormSchema, eventStatusSchema } from "@/validators/admin";
import { isUniqueViolation } from "./payments";

export async function listEventsForOrgs(organizationIds: string[]) {
  if (organizationIds.length === 0) return [];
  return getDb()
    .select({
      id: events.id,
      organizationId: events.organizationId,
      name: events.name,
      slug: events.slug,
      status: events.status,
      startsAt: events.startsAt,
      sold: sql<number>`COALESCE((SELECT SUM(${ticketBatches.soldQuantity}) FROM ${ticketBatches} WHERE ${ticketBatches.eventId} = ${events.id}),0)::int`,
      capacity: sql<number>`COALESCE((SELECT SUM(${ticketBatches.quantity}) FROM ${ticketBatches} WHERE ${ticketBatches.eventId} = ${events.id}),0)::int`,
    })
    .from(events)
    .where(and(inArray(events.organizationId, organizationIds), isNull(events.deletedAt)))
    .orderBy(desc(events.startsAt))
    .limit(200);
}

export async function getEventAdmin(eventId: string) {
  const db = getDb();
  const [row] = await db
    .select({ event: events, venue: venues })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)));
  if (!row) return null;
  const batches = await db
    .select({ batch: ticketBatches, typeName: ticketTypes.name })
    .from(ticketBatches)
    .innerJoin(ticketTypes, eq(ticketTypes.id, ticketBatches.ticketTypeId))
    .where(eq(ticketBatches.eventId, eventId))
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketBatches.sortOrder), asc(ticketBatches.createdAt));
  return { ...row, batches };
}

export async function saveEvent(input: EventFormInput, actorUserId: string, eventId?: string) {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const existing = eventId ? await tx.query.events.findFirst({ where: eq(events.id, eventId) }) : null;
      if (eventId && (!existing || existing.organizationId !== input.organizationId)) {
        throw new AppError("NOT_FOUND", "Evento não encontrado.");
      }
      let venueId = existing?.venueId ?? null;
      const venueValues = {
        organizationId: input.organizationId,
        name: input.venueName,
        addressLine: input.venueAddress ?? null,
        city: input.venueCity,
        state: input.venueState,
        updatedAt: new Date(),
      };
      if (venueId) await tx.update(venues).set(venueValues).where(eq(venues.id, venueId));
      else venueId = (await tx.insert(venues).values(venueValues).returning({ id: venues.id }))[0]!.id;

      const values = {
        organizationId: input.organizationId,
        venueId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        coverImageUrl: input.coverImageUrl ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        salesStartAt: input.salesStartAt ?? null,
        salesEndAt: input.salesEndAt ?? null,
        ageRating: input.ageRating ?? null,
        updatedAt: new Date(),
      };
      let id = eventId;
      if (existing) {
        await tx.update(events).set(values).where(eq(events.id, existing.id));
      } else {
        id = (await tx.insert(events).values({ ...values, createdBy: actorUserId }).returning({ id: events.id }))[0]!.id;
      }
      await audit(tx, {
        action: existing ? "event.update" : "event.create",
        entityType: "event",
        entityId: id,
        organizationId: input.organizationId,
        actorType: "USER",
        actorUserId,
        metadata: { name: input.name, slug: input.slug },
      });
      return id!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe um evento com este slug.");
    throw e;
  }
}

export async function setEventStatus(eventId: string, status: z.infer<typeof eventStatusSchema>, actorUserId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!ev) throw new AppError("NOT_FOUND", "Evento não encontrado.");
    if (status === "PUBLISHED") {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ticketBatches)
        .where(and(eq(ticketBatches.eventId, eventId), eq(ticketBatches.status, "ACTIVE")));
      if (Number(n) === 0) throw new AppError("INVALID_STATE", "Crie ao menos um lote ativo antes de publicar.");
    }
    await tx.update(events).set({ status, updatedAt: new Date() }).where(eq(events.id, eventId));
    await audit(tx, {
      action: "event.status_change",
      entityType: "event",
      entityId: eventId,
      organizationId: ev.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { from: ev.status, to: status },
    });
  });
}

export async function saveBatch(input: z.infer<typeof batchFormSchema>, organizationId: string, actorUserId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const ev = await tx.query.events.findFirst({ where: eq(events.id, input.eventId) });
    if (!ev || ev.organizationId !== organizationId) throw new AppError("NOT_FOUND", "Evento não encontrado.");

    let type = await tx.query.ticketTypes.findFirst({
      where: and(eq(ticketTypes.eventId, ev.id), eq(ticketTypes.name, input.ticketTypeName)),
    });
    if (!type) {
      type = (await tx.insert(ticketTypes).values({ eventId: ev.id, name: input.ticketTypeName }).returning())[0]!;
    }
    const values = {
      ticketTypeId: type.id,
      name: input.name,
      price: input.price,
      quantity: input.quantity,
      maxPerCustomer: input.maxPerCustomer,
      salesStart: input.salesStart ?? null,
      salesEnd: input.salesEnd ?? null,
      sortOrder: input.sortOrder,
      status: input.status,
      updatedAt: new Date(),
    };

    if (input.batchId) {
      const [batch] = await tx.select().from(ticketBatches).where(eq(ticketBatches.id, input.batchId)).for("update");
      if (!batch || batch.eventId !== ev.id) throw new AppError("NOT_FOUND", "Lote não encontrado.");
      if (input.quantity < batch.soldQuantity + batch.reservedQuantity) {
        throw new AppError("VALIDATION_ERROR", "Quantidade menor que o total já vendido/reservado.");
      }
      // Price changes never affect existing orders (prices are snapshotted); the change is audited below.
      await tx.update(ticketBatches).set(values).where(eq(ticketBatches.id, batch.id));
      await audit(tx, {
        action: "batch.update",
        entityType: "ticket_batch",
        entityId: batch.id,
        organizationId,
        actorType: "USER",
        actorUserId,
        amount: input.price,
        metadata: { before: { price: batch.price, quantity: batch.quantity, status: batch.status }, after: { price: input.price, quantity: input.quantity, status: input.status } },
      });
      return batch.id;
    }
    const [created] = await tx.insert(ticketBatches).values({ ...values, eventId: ev.id }).returning({ id: ticketBatches.id });
    await audit(tx, {
      action: "batch.create",
      entityType: "ticket_batch",
      entityId: created!.id,
      organizationId,
      actorType: "USER",
      actorUserId,
      amount: input.price,
      metadata: { name: input.name, quantity: input.quantity },
    });
    return created!.id;
  });
}
