import { AppError } from "@/server/lib/errors";
import { withIdempotency } from "@/server/lib/idempotency";
import { readJson, route } from "@/server/lib/http";
import { hasOrderAccess } from "@/server/lib/order-access";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { createPaymentForOrder } from "@/server/services/payments";
import { createPaymentSchema } from "@/validators/checkout";

/**
 * Starts the payment of an order (Pix or tokenized card). Requires `Idempotency-Key` and the
 * order-access cookie. Card data never reaches this endpoint — only the PSP token.
 */
export const POST = route(async (req, { ip }) => {
  await enforceRateLimit(`payments:ip:${ip ?? "unknown"}`, 20, 60);
  const input = createPaymentSchema.parse(await readJson(req));
  if (!(await hasOrderAccess(input.orderId))) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  // Card testing protection: few attempts per order.
  if (input.method === "CREDIT_CARD") await enforceRateLimit(`payments:card:${input.orderId}`, 5, 3600);

  const result = await withIdempotency(
    { scope: `POST /api/payments:${input.orderId}`, key: req.headers.get("idempotency-key"), request: input },
    async () => ({ status: 201, body: { data: await createPaymentForOrder(input, { ip }) } }),
  );
  return Response.json(result.body, {
    status: result.status,
    headers: result.replayed ? { "idempotent-replayed": "true" } : undefined,
  });
});
