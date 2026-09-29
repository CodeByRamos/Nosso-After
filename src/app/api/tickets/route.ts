import { organizationsWith, requireApiAuth } from "@/server/auth/session";
import { route } from "@/server/lib/http";
import { listTickets } from "@/server/services/admin-queries";
import { listQuerySchema } from "@/validators/admin";

export const dynamic = "force-dynamic";

/** Staff (tickets:read): paginated ticket list scoped to the caller's organizations. */
export const GET = route(async (req) => {
  const auth = await requireApiAuth();
  const q = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const orgIds = (await organizationsWith(auth, "tickets:read")).map((o) => o.organizationId);
  return Response.json({ data: await listTickets(orgIds, q) });
});
