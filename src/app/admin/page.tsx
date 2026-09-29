import Link from "next/link";
import { BarSeries } from "@/components/admin/charts";
import { Card, Notice, PageHeader, Stat, input } from "@/components/admin/ui";
import { formatBRL, METHOD_LABEL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can } from "@/server/auth/session";
import { listEventsForOrgs } from "@/server/services/admin-events";
import { dashboardCharts, dashboardMetrics } from "@/server/services/admin-queries";
import { uuidSchema } from "@/validators/common";

export const metadata = { title: "Visão geral" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ evento?: string }> }) {
  const { auth, orgIds } = await adminContext("dashboard:view");
  const events = await listEventsForOrgs(orgIds);
  const requested = uuidSchema.safeParse((await searchParams).evento);
  const eventId = requested.success && events.some((e) => e.id === requested.data) ? requested.data : undefined;
  // Finance numbers only for roles with finance:read in every scoped organization.
  const financeOrgIds = orgIds.filter((id) => can(auth, "finance:read", id));
  const showFinance = financeOrgIds.length > 0;

  const [m, charts] = await Promise.all([
    dashboardMetrics({ organizationIds: showFinance ? financeOrgIds : orgIds, eventId }),
    dashboardCharts({ organizationIds: showFinance ? financeOrgIds : orgIds, eventId }),
  ]);

  return (
    <div>
      <PageHeader
        title="Visão geral"
        subtitle={eventId ? events.find((e) => e.id === eventId)?.name : "Todos os eventos"}
        actions={
          <form className="flex gap-2">
            <select name="evento" defaultValue={eventId ?? ""} className={input} aria-label="Filtrar por evento">
              <option value="">Todos os eventos</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Filtrar</button>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Ingressos vendidos" value={m.ticketsSold} />
        <Stat label="Check-ins" value={m.checkedIn} hint={m.ticketsSold ? `${Math.round((m.checkedIn / m.ticketsSold) * 100)}% dos vendidos` : undefined} />
        <Stat label="Pedidos" value={m.orders} hint={`${m.paidOrders} pagos · ${m.pendingOrders} aguardando`} />
        <Stat label="Reembolsos" value={m.refunds} />
      </div>

      {showFinance && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Receita bruta" value={m.gross} money hint="Total pago pelos compradores" />
            <Stat label="Taxas da plataforma" value={m.platformFees} money hint="Taxa de serviço cobrada" />
            <Stat label="Receita líquida" value={m.net} money hint="Bruta − taxas − reembolsos" />
            <Stat label="Ticket médio" value={m.averageTicket} money hint="Por pedido pago" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Pagamentos aprovados" value={m.paymentsApproved} />
            <Stat label="Pagamentos pendentes" value={m.paymentsPending} />
            <Stat label="Pagamentos recusados/expirados" value={m.paymentsFailed} />
            <Stat label="Reembolsado" value={m.refunded} money hint={m.pspFees ? `Tarifa PSP: ${formatBRL(m.pspFees)}` : "Confirmado pelo PSP"} />
          </div>
        </>
      )}

      {events.length === 0 && (
        <div className="mt-6">
          <Notice>
            Nenhum evento ainda. <Link href="/admin/events/new" className="font-semibold underline">Crie o primeiro evento</Link>.
          </Notice>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {showFinance && (
          <Card title="Vendas por dia (receita, últimos 30 dias)">
            <BarSeries data={charts.byDay.map((d) => ({ dia: d.day.slice(8, 10) + "/" + d.day.slice(5, 7), receita: d.revenue }))} x="dia" y="receita" money />
          </Card>
        )}
        <Card title="Vendidos por lote">
          <BarSeries data={charts.byBatch.map((b) => ({ lote: b.batch, vendidos: b.sold }))} x="lote" y="vendidos" />
        </Card>
        {showFinance && (
          <Card title="Pedidos pagos por método de pagamento">
            <BarSeries data={charts.byMethod.map((x) => ({ metodo: METHOD_LABEL[x.method] ?? x.method, pedidos: x.orders }))} x="metodo" y="pedidos" />
          </Card>
        )}
        <Card title="Check-ins por hora (últimos 7 dias)">
          <BarSeries data={charts.checkinsByHour.map((c) => ({ hora: c.hour, entradas: c.n }))} x="hora" y="entradas" />
        </Card>
      </div>
    </div>
  );
}
