import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { setMockWebhookDispatcher } from "@/server/payments/providers/mock/mock-provider";
import { getProvider } from "@/server/payments/registry";
import type { MockPaymentProvider } from "@/server/payments/providers/mock/mock-provider";
import { receiveWebhook } from "@/server/services/webhooks";
import type { CreateOrderInput } from "@/validators/checkout";

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface Fixture {
  orgId: string;
  eventId: string;
  batchId: string;
  typeId: string;
  userId: string;
}

/** Fresh, isolated organization + published event + one active batch + event-scoped fee rule. */
export async function createFixture(opts: { price?: number; quantity?: number; maxPerCustomer?: number; feeBps?: number; feeFixed?: number } = {}): Promise<Fixture> {
  const db = getDb();
  const id = uid();
  const [org] = await db.insert(s.organizations).values({ name: `Org ${id}`, slug: `org-${id}` }).returning();
  const [user] = await db
    .insert(s.users)
    .values({ email: `admin-${id}@test.local`, name: "Test Admin", passwordHash: "x", platformRole: "SUPER_ADMIN" })
    .returning();
  const start = new Date(Date.now() + 7 * 86_400_000);
  const [event] = await db
    .insert(s.events)
    .values({
      organizationId: org!.id,
      name: `Evento ${id}`,
      slug: `evento-${id}`,
      status: "PUBLISHED",
      startsAt: start,
      endsAt: new Date(start.getTime() + 6 * 3600_000),
    })
    .returning();
  const [type] = await db.insert(s.ticketTypes).values({ eventId: event!.id, name: "Pista" }).returning();
  const [batch] = await db
    .insert(s.ticketBatches)
    .values({
      eventId: event!.id,
      ticketTypeId: type!.id,
      name: "1º Lote",
      price: opts.price ?? 10_000,
      quantity: opts.quantity ?? 100,
      maxPerCustomer: opts.maxPerCustomer ?? 10,
      status: "ACTIVE",
    })
    .returning();
  if (opts.feeBps !== undefined || opts.feeFixed !== undefined) {
    await db.insert(s.feeRules).values({
      name: "Taxa teste",
      organizationId: org!.id,
      eventId: event!.id,
      fixedAmount: opts.feeFixed ?? 0,
      percentageBps: opts.feeBps ?? 0,
      activeFrom: new Date(Date.now() - 60_000),
    });
  }
  return { orgId: org!.id, eventId: event!.id, batchId: batch!.id, typeId: type!.id, userId: user!.id };
}

export function orderInput(f: Fixture, overrides: Partial<CreateOrderInput> & { email?: string; quantity?: number } = {}): CreateOrderInput {
  return {
    eventId: f.eventId,
    items: [{ batchId: f.batchId, quantity: overrides.quantity ?? 1 }],
    paymentMethod: overrides.paymentMethod ?? "PIX",
    buyer: {
      name: "Maria Silva",
      email: overrides.email ?? `buyer-${uid()}@test.local`,
      phone: "13999990000",
      acceptTerms: true,
      marketingOptIn: false,
    },
  };
}

export async function getBatch(batchId: string) {
  return (await getDb().query.ticketBatches.findFirst({ where: eq(s.ticketBatches.id, batchId) }))!;
}

export async function getOrder(orderId: string) {
  return (await getDb().query.orders.findFirst({ where: eq(s.orders.id, orderId) }))!;
}

export async function getPayment(paymentId: string) {
  return (await getDb().query.payments.findFirst({ where: eq(s.payments.id, paymentId) }))!;
}

export async function ticketsOf(orderId: string) {
  return getDb().select().from(s.tickets).where(eq(s.tickets.orderId, orderId));
}

/**
 * Captures webhooks the mock PSP would send, so tests decide when (and how often) they arrive.
 */
export function captureWebhooks() {
  const queue: { rawBody: string; headers: Record<string, string> }[] = [];
  setMockWebhookDispatcher(async (d) => {
    queue.push(d);
  });
  return {
    queue,
    async deliverAll() {
      const results = [];
      while (queue.length) {
        const d = queue.shift()!;
        results.push(await deliver(d));
      }
      return results;
    },
  };
}

export function deliver(d: { rawBody: string; headers: Record<string, string> }) {
  return receiveWebhook("mock", { headers: new Headers(d.headers), rawBody: d.rawBody, url: new URL("http://localhost/api/webhooks/mock") });
}

export const mockPsp = () => getProvider("mock") as MockPaymentProvider;

export async function waitFor(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Drizzle wraps driver errors ("Failed query: …"); the Postgres message lives in `cause`. */
export async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    const msg = `${(e as Error).message} ${((e as { cause?: Error }).cause?.message ?? "")}`;
    if (!pattern.test(msg)) throw new Error(`expected DB error ${pattern}, got: ${msg}`);
    return;
  }
  throw new Error(`expected DB error ${pattern}, but the query succeeded`);
}
