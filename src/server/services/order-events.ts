import type { Tx } from "@/server/db/client";
import { orderEvents } from "@/server/db/schema";

/** Appends to the order timeline (ORDER_CREATED, INVENTORY_RESERVED, PAYMENT_APPROVED, ...). */
export async function addOrderEvent(tx: Tx, orderId: string, type: string, data: Record<string, unknown> = {}) {
  await tx.insert(orderEvents).values({ orderId, type, data });
}
