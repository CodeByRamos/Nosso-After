import { cookies } from "next/headers";
import { withIdempotency } from "@/server/lib/idempotency";
import { readJson, route } from "@/server/lib/http";
import { grantOrderAccess } from "@/server/lib/order-access";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { PROMOTER_COOKIE, verifyPromoterRef } from "@/server/lib/tokens";
import { createOrder } from "@/server/services/orders";
import { createOrderSchema } from "@/validators/checkout";

/**
 * Creates an order and reserves inventory. Requires `Idempotency-Key`.
 * Sets the httpOnly order-access cookie (guest checkout, no account needed).
 */
export const POST = route(async (req, { ip }) => {
  await enforceRateLimit(`orders:ip:${ip ?? "unknown"}`, 10, 60);
  const body = await readJson(req);
  const input = createOrderSchema.parse(body);
  await enforceRateLimit(`orders:email:${input.buyer.email}`, 5, 300);
  // Attribution comes only from the server-signed cookie; nothing in the body can set it.
  const promoterId = verifyPromoterRef((await cookies()).get(PROMOTER_COOKIE)?.value);

  const result = await withIdempotency(
    { scope: "POST /api/orders", key: req.headers.get("idempotency-key"), request: input },
    async () => ({ status: 201, body: { data: await createOrder(input, { ip, promoterId }) } }),
  );
  await grantOrderAccess(result.body.data.id);
  return Response.json(result.body, {
    status: result.status,
    headers: result.replayed ? { "idempotent-replayed": "true" } : undefined,
  });
});
