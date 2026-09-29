/**
 * Transactional check-in (ADR-0006). Every scan — valid or not — is recorded.
 */
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { checkIns, events, tickets, ticketTypes } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { verifyTicketQr } from "@/server/lib/tokens";

export type CheckInResult = "VALID" | "ALREADY_USED" | "INVALID" | "CANCELLED" | "REFUNDED" | "WRONG_EVENT";

export interface CheckInOutcome {
  result: CheckInResult;
  ticket?: { code: string; holderName: string; typeName: string; checkedInAt: string | null };
}

export async function performCheckIn(input: {
  qr: string;
  eventId: string;
  organizationId: string;
  operatorUserId: string;
  sessionId?: string | null;
  deviceId?: string | null;
  ip?: string | null;
}): Promise<CheckInOutcome> {
  const db = getDb();
  const record = (result: CheckInResult, ticketId: string | null) =>
    db.insert(checkIns).values({
      organizationId: input.organizationId,
      eventId: input.eventId,
      ticketId,
      result,
      operatorUserId: input.operatorUserId,
      sessionId: input.sessionId ?? null,
      deviceId: input.deviceId?.slice(0, 64) ?? null,
      ip: input.ip ?? null,
    });

  const parsed = verifyTicketQr(input.qr);
  if (!parsed) {
    await record("INVALID", null);
    return { result: "INVALID" };
  }

  return db.transaction(async (tx) => {
    // Atomic admit: only one concurrent scanner can flip VALID → CHECKED_IN.
    const [admitted] = await tx
      .update(tickets)
      .set({ status: "CHECKED_IN", checkedInAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(tickets.id, parsed.ticketId),
          eq(tickets.eventId, input.eventId),
          eq(tickets.status, "VALID"),
          eq(tickets.qrVersion, parsed.version),
        ),
      )
      .returning();

    const typeName = async (typeId: string) =>
      (await tx.query.ticketTypes.findFirst({ where: eq(ticketTypes.id, typeId) }))?.name ?? "";

    if (admitted) {
      await tx.insert(checkIns).values({
        organizationId: input.organizationId,
        eventId: input.eventId,
        ticketId: admitted.id,
        result: "VALID",
        operatorUserId: input.operatorUserId,
        sessionId: input.sessionId ?? null,
        deviceId: input.deviceId?.slice(0, 64) ?? null,
        ip: input.ip ?? null,
      });
      await audit(tx, {
        action: "checkin.admit",
        entityType: "ticket",
        entityId: admitted.id,
        organizationId: input.organizationId,
        actorType: "USER",
        actorUserId: input.operatorUserId,
        metadata: { eventId: input.eventId, deviceId: input.deviceId },
      });
      return {
        result: "VALID" as const,
        ticket: {
          code: admitted.code,
          holderName: admitted.holderName,
          typeName: await typeName(admitted.ticketTypeId),
          checkedInAt: admitted.checkedInAt?.toISOString() ?? null,
        },
      };
    }

    const ticket = await tx.query.tickets.findFirst({ where: eq(tickets.id, parsed.ticketId) });
    let result: CheckInResult;
    if (!ticket || ticket.qrVersion !== parsed.version) result = "INVALID";
    else if (ticket.eventId !== input.eventId) result = "WRONG_EVENT";
    else if (ticket.status === "CHECKED_IN") result = "ALREADY_USED";
    else if (ticket.status === "REFUNDED") result = "REFUNDED";
    else if (ticket.status === "CANCELLED") result = "CANCELLED";
    else result = "INVALID";

    // Don't reveal data about tickets from other events/organizations.
    const sameEvent = ticket && ticket.eventId === input.eventId && result !== "INVALID";
    await tx.insert(checkIns).values({
      organizationId: input.organizationId,
      eventId: input.eventId,
      ticketId: sameEvent ? ticket.id : null,
      result,
      operatorUserId: input.operatorUserId,
      sessionId: input.sessionId ?? null,
      deviceId: input.deviceId?.slice(0, 64) ?? null,
      ip: input.ip ?? null,
    });
    return {
      result,
      ticket: sameEvent
        ? {
            code: ticket.code,
            holderName: ticket.holderName,
            typeName: await typeName(ticket.ticketTypeId),
            checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
          }
        : undefined,
    };
  });
}

export async function checkInStats(eventId: string) {
  const [row] = await getDb()
    .select({
      checkedIn: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'CHECKED_IN')::int`,
      total: sql<number>`count(*) FILTER (WHERE ${tickets.status} IN ('VALID','CHECKED_IN'))::int`,
    })
    .from(tickets)
    .where(eq(tickets.eventId, eventId));
  const event = await getDb().query.events.findFirst({ where: eq(events.id, eventId) });
  return { checkedIn: Number(row?.checkedIn ?? 0), total: Number(row?.total ?? 0), eventName: event?.name ?? "" };
}

/** Events a door operator can scan for: live or upcoming (ended less than 12h ago). */
export async function listCheckinEvents(organizationIds: string[]) {
  if (organizationIds.length === 0) return [];
  return getDb()
    .select({ id: events.id, name: events.name, startsAt: events.startsAt })
    .from(events)
    .where(
      and(
        inArray(events.organizationId, organizationIds),
        inArray(events.status, ["PUBLISHED", "SOLD_OUT", "PAUSED"]),
        isNull(events.deletedAt),
        gte(events.endsAt, sql`now() - interval '12 hours'`),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(20);
}
