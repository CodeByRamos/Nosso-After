import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { payments } from "@/server/db/schema";
import { env } from "@/server/lib/env";
import { AppError } from "@/server/lib/errors";
import { readJson, route } from "@/server/lib/http";
import { hasOrderAccess } from "@/server/lib/order-access";
import { getProvider } from "@/server/payments/registry";
import { MockPaymentProvider } from "@/server/payments/providers/mock/mock-provider";
import { uuidSchema } from "@/validators/common";

const bodySchema = z.object({ action: z.enum(["pay_pix"]) });

/**
 * DEMO ONLY — simulates the buyer paying a Pix in their bank app. It changes the SIMULATED PSP's
 * state and makes it send a signed webhook; our core then confirms via the normal pipeline.
 * Disabled unless PAYMENT_PROVIDER=mock and APP_ENV is not production.
 */
export const POST = route<{ params: Promise<{ paymentId: string }> }>(async (req, { params }) => {
  if (env().PAYMENT_PROVIDER !== "mock" || env().APP_ENV === "production") {
    throw new AppError("NOT_FOUND", "Not found");
  }
  const paymentId = uuidSchema.parse((await params).paymentId);
  const { action } = bodySchema.parse(await readJson(req, 1024));
  const payment = await getDb().query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment || payment.provider !== "mock" || !payment.providerPaymentId) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");
  if (!(await hasOrderAccess(payment.orderId))) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");

  const mock = getProvider("mock") as MockPaymentProvider;
  if (action === "pay_pix") await mock.simulatePixPayment(payment.providerPaymentId);
  return Response.json({ data: { ok: true, environment: "DEMO" } });
});
