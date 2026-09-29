import { eq } from "drizzle-orm";
import { assertCan, requireApiAuth } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { paymentAttempts, payments, providerTransactions } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";

/** Staff (finance:read): payment with PSP attempts and latest PSP snapshot (sanitized). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const auth = await requireApiAuth();
  const id = uuidSchema.parse((await params).id);
  const db = getDb();
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, id) });
  if (!payment) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");
  assertCan(auth, "finance:read", payment.organizationId);
  const [attempts, snapshots] = await Promise.all([
    db.select().from(paymentAttempts).where(eq(paymentAttempts.paymentId, id)),
    db.select().from(providerTransactions).where(eq(providerTransactions.paymentId, id)),
  ]);
  return Response.json({ data: { payment, attempts, providerTransactions: snapshots } });
});
