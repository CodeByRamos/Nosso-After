import { can, getAuth } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { hasOrderAccess } from "@/server/lib/order-access";
import { getOrderView, orderOrganizationId } from "@/server/services/orders";
import { listTicketsForOrder } from "@/server/services/tickets";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";

/** Buyer (order-access cookie) or staff with orders:read. Used by the checkout page to poll status. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const id = uuidSchema.parse((await params).id);
  const view = await getOrderView(id);
  const allowed = view && ((await hasOrderAccess(id)) || (await staffCanRead(id)));
  // 404 (not 403) so order ids can't be probed.
  if (!view || !allowed) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(view.status);
  return Response.json({ data: { ...view, tickets: paid ? await listTicketsForOrder(id) : [] } });
});

async function staffCanRead(orderId: string) {
  const auth = await getAuth();
  if (!auth) return false;
  const orgId = await orderOrganizationId(orderId);
  return !!orgId && can(auth, "orders:read", orgId);
}
