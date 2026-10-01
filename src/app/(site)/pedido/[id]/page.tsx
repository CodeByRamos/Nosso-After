import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OrderClient } from "@/components/site/order-client";
import { hasOrderAccess } from "@/server/lib/order-access";
import { getActiveProvider } from "@/server/payments/registry";
import { getOrderView } from "@/server/services/orders";
import { listTicketsForOrder } from "@/server/services/tickets";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seu pedido", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = uuidSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const id = parsed.data;
  if (!(await hasOrderAccess(id))) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="type-display text-4xl">Pedido protegido</h1>
        <p className="mt-4 text-fg-2">
          Abra este pedido pelo link enviado ao seu e-mail, no mesmo aparelho em que comprou.
        </p>
      </div>
    );
  }
  const view = await getOrderView(id);
  if (!view) notFound();
  const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(view.status);
  const tickets = paid ? await listTicketsForOrder(id) : [];
  const provider = getActiveProvider();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <OrderClient
      initial={{ ...view, tickets }}
      payment={provider.clientConfig()}
      nonce={nonce}
    />
  );
}
