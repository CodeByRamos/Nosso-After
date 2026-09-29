import { eq } from "drizzle-orm";
import { assertCan, requireApiAuth } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { events } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { readJson, route } from "@/server/lib/http";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { performCheckIn } from "@/server/services/checkin";
import { checkInRequestSchema } from "@/validators/admin";

/** Staff (checkin:perform): validate + admit a ticket QR for an event. Atomic. */
export const POST = route(async (req, { ip }) => {
  const auth = await requireApiAuth();
  const input = checkInRequestSchema.parse(await readJson(req, 2048));
  const event = await getDb().query.events.findFirst({ where: eq(events.id, input.eventId) });
  if (!event) throw new AppError("NOT_FOUND", "Evento não encontrado.");
  assertCan(auth, "checkin:perform", event.organizationId);
  await enforceRateLimit(`checkin:${auth.user.id}`, 240, 60);

  const outcome = await performCheckIn({
    qr: input.qr,
    eventId: event.id,
    organizationId: event.organizationId,
    operatorUserId: auth.user.id,
    sessionId: auth.sessionId,
    deviceId: input.deviceId,
    ip,
  });
  return Response.json({ data: outcome });
});
