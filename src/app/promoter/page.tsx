import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { logoutAction } from "@/app/login/actions";
import { Wordmark } from "@/components/site/site-chrome";
import { formatBRL } from "@/lib/format";
import { requireAuth } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { promoters } from "@/server/db/schema";
import { env } from "@/server/lib/env";
import { promoterStats } from "@/server/services/promoters";

export const metadata: Metadata = { title: "Minhas vendas", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Promoter self-service: only the promoter records linked to the logged-in user. No buyer data. */
export default async function PromoterPage() {
  const auth = await requireAuth();
  const mine = await getDb()
    .select({ id: promoters.id })
    .from(promoters)
    .where(and(eq(promoters.userId, auth.user.id), eq(promoters.isActive, true)));
  const stats = (await Promise.all(mine.map((p) => promoterStats({ promoterId: p.id })))).flat();

  return (
    <main className="tex-halftone min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between">
          <Wordmark />
          <form action={logoutAction}><button className="text-sm text-muted underline">Sair</button></form>
        </div>
        <h1 className="type-display mt-8 text-4xl">Minhas vendas</h1>
        {stats.length === 0 && <p className="mt-4 text-fg-2">Nenhum link de promoter vinculado à sua conta.</p>}
        {stats.map(({ promoter: p, paidOrders, tickets, commission }) => (
          <section key={p.id} className="mt-6 border-2 border-fg/15 bg-surface p-5">
            <p className="text-sm text-muted">Seu link</p>
            <p className="break-all font-mono text-primary">{env().APP_URL}/r/{p.code}</p>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div><dt className="text-xs text-muted">Pedidos</dt><dd className="tabular text-2xl font-bold">{paidOrders}</dd></div>
              <div><dt className="text-xs text-muted">Ingressos</dt><dd className="tabular text-2xl font-bold">{tickets}</dd></div>
              <div><dt className="text-xs text-muted">Comissão</dt><dd className="tabular text-lg font-bold">{formatBRL(Number(commission))}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              Comissão de {(p.commissionBps / 100).toLocaleString("pt-BR")}%
              {p.commissionFixedPerTicket ? ` + ${formatBRL(p.commissionFixedPerTicket)} por ingresso` : ""} sobre ingressos pagos. Pedidos reembolsados não contam.
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
