import { z } from "zod";
import { assertCan, requireApiAuth } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { withIdempotency } from "@/server/lib/idempotency";
import { readJson, route } from "@/server/lib/http";
import { orderOrganizationId } from "@/server/services/orders";
import { requestRefund } from "@/server/services/refunds";
import { uuidSchema } from "@/validators/common";

const bodySchema = z.object({
  orderId: uuidSchema,
  /** Cents; omit for full refund. */
  amount: z.number().int().positive().optional(),
  reason: z.string().trim().min(5).max(500),
});

/** Staff (refunds:create). Idempotent. The PSP confirms the refund before the order changes. */
export const POST = route(async (req) => {
  const auth = await requireApiAuth();
  const input = bodySchema.parse(await readJson(req));
  const orgId = await orderOrganizationId(input.orderId);
  if (!orgId) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  assertCan(auth, "refunds:create", orgId);

  const result = await withIdempotency(
    { scope: `POST /api/refunds:${auth.user.id}`, key: req.headers.get("idempotency-key"), request: input },
    async () => {
      const refund = await requestRefund({ ...input, actorUserId: auth.user.id });
      return { status: 201, body: { data: { id: refund.id, status: refund.status, amount: refund.amount } } };
    },
  );
  return Response.json(result.body, { status: result.status });
});
