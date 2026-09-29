/**
 * DEVELOPMENT seed. Refuses to run outside APP_ENV=development.
 * Creates the Nosso After organization, a super admin, a check-in operator, one event with the
 * three example batches from the product brief and a global platform fee rule.
 * Event data here is illustrative for local testing — real event data is managed in /admin.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { hashPassword, passwordPolicyError } from "../src/server/auth/password";

async function main() {
  if (process.env.APP_ENV !== "development") throw new Error("Seed only runs with APP_ENV=development");
  const url = process.env.DATABASE_URL;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!url || !adminEmail || !adminPassword) throw new Error("DATABASE_URL, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required");
  const policy = passwordPolicyError(adminPassword);
  if (policy) throw new Error(`SEED_ADMIN_PASSWORD: ${policy}`);

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  await db.transaction(async (tx) => {
    let org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.slug, "nosso-after") });
    if (!org) {
      [org] = await tx
        .insert(schema.organizations)
        .values({ name: "Nosso After", slug: "nosso-after", contactEmail: "contato@nossoafter.local" })
        .returning();
    }

    const upsertUser = async (email: string, name: string, password: string, superAdmin: boolean) => {
      const existing = await tx.query.users.findFirst({ where: eq(schema.users.email, email) });
      if (existing) return existing;
      const [u] = await tx
        .insert(schema.users)
        .values({ email, name, passwordHash: await hashPassword(password), platformRole: superAdmin ? "SUPER_ADMIN" : null })
        .returning();
      return u!;
    };

    const admin = await upsertUser(adminEmail, "Admin Nosso After", adminPassword, true);
    await tx
      .insert(schema.memberships)
      .values({ userId: admin.id, organizationId: org!.id, role: "ORGANIZATION_ADMIN" })
      .onConflictDoNothing();

    const opEmail = process.env.SEED_OPERATOR_EMAIL?.toLowerCase();
    const opPassword = process.env.SEED_OPERATOR_PASSWORD;
    if (opEmail && opPassword) {
      const op = await upsertUser(opEmail, "Operador Portaria", opPassword, false);
      await tx
        .insert(schema.memberships)
        .values({ userId: op.id, organizationId: org!.id, role: "CHECKIN_OPERATOR" })
        .onConflictDoNothing();
    }

    const hasRule = await tx.query.feeRules.findFirst();
    if (!hasRule) {
      await tx.insert(schema.feeRules).values({
        name: "Taxa de serviço padrão (dev)",
        appliesPer: "TICKET",
        fixedAmount: 0,
        percentageBps: 1000,
        activeFrom: new Date(Date.now() - 86_400_000),
        createdBy: admin.id,
      });
    }

    const existingEvent = await tx.query.events.findFirst({ where: eq(schema.events.slug, "nosso-after") });
    if (!existingEvent) {
      const [venue] = await tx
        .insert(schema.venues)
        .values({ organizationId: org!.id, name: "Local a confirmar", city: "Guarujá", state: "SP" })
        .returning();
      const startsAt = new Date(Date.now() + 30 * 86_400_000);
      startsAt.setUTCHours(2, 0, 0, 0); // 23:00 in São Paulo
      const [event] = await tx
        .insert(schema.events)
        .values({
          organizationId: org!.id,
          venueId: venue!.id,
          name: "Nosso After",
          slug: "nosso-after",
          description:
            "Evento de desenvolvimento criado pelo seed. Edite nome, data, local e descrição em /admin/events antes de publicar de verdade.",
          status: "PUBLISHED",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 7 * 3600_000),
          salesStartAt: new Date(Date.now() - 3600_000),
          ageRating: "18+",
          createdBy: admin.id,
        })
        .returning();
      const [pista] = await tx.insert(schema.ticketTypes).values({ eventId: event!.id, name: "Pista", sortOrder: 0 }).returning();
      await tx.insert(schema.ticketBatches).values([
        { eventId: event!.id, ticketTypeId: pista!.id, name: "1º Lote", price: 3000, quantity: 100, status: "ACTIVE", sortOrder: 1, maxPerCustomer: 6 },
        { eventId: event!.id, ticketTypeId: pista!.id, name: "2º Lote", price: 4000, quantity: 200, status: "ACTIVE", sortOrder: 2, maxPerCustomer: 6 },
        { eventId: event!.id, ticketTypeId: pista!.id, name: "3º Lote", price: 5000, quantity: 300, status: "DRAFT", sortOrder: 3, maxPerCustomer: 6 },
      ]);
    }
  });

  await pool.end();
  console.log(`Seed complete. Super admin: ${adminEmail} (password from SEED_ADMIN_PASSWORD in .env.local)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
