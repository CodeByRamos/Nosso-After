import { eq } from "drizzle-orm";
import { assertCan, requireApiAuth } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { checkIns, tickets } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";

/** Staff (tickets:read): ticket details + scan history. Never returns the QR payload. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const auth = await requireApiAuth();
  const id = uuidSchema.parse((await params).id);
  const db = getDb();
  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, id) });
  if (!ticket) throw new AppError("NOT_FOUND", "Ingresso não encontrado.");
  assertCan(auth, "tickets:read", ticket.organizationId);
  const scans = await db.select().from(checkIns).where(eq(checkIns.ticketId, id));
  const { qrVersion: _omit, ...safe } = ticket;
  return Response.json({ data: { ticket: safe, scans } });
});
