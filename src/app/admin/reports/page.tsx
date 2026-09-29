import { asc, inArray } from "drizzle-orm";
import { ReconciliationRunButton, ResolveIssueForm } from "@/components/admin/reconciliation";
import { Badge, Card, Notice, PageHeader, Table, Td, btn, input } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can, canPlatform } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { events } from "@/server/db/schema";
import { CHECK_LABELS, listIssues } from "@/server/services/reconciliation";

export const metadata = { title: "Relatórios e conciliação" };

const REPORTS = [
  { type: "orders", label: "Pedidos e pagamentos", hint: "Valores, taxa, desconto, reembolso, líquido, cupom, promoter, PSP" },
  { type: "sales-by-batch", label: "Vendas por lote", hint: "Capacidade, vendidos, check-ins e receita de ingressos" },
  { type: "promoters", label: "Comissões de promoters", hint: "Pedidos pagos, receita e comissão devida" },
  { type: "checkins", label: "Check-ins", hint: "Todas as leituras, com operador e dispositivo" },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { auth, orgIds } = await adminContext("finance:read");
  const status = (await searchParams).status === "RESOLVED" ? "RESOLVED" : "OPEN";
  const platform = canPlatform(auth, "platform:admin");
  const [issues, eventRows] = await Promise.all([
    listIssues({ orgIds, includePlatform: platform, status }),
    getDb().select({ id: events.id, name: events.name }).from(events).where(inArray(events.organizationId, orgIds)).orderBy(asc(events.startsAt)),
  ]);
  const canManage = platform || orgIds.some((id) => can(auth, "reconciliation:manage", id));

  return (
    <div className="space-y-6">
      <PageHeader title="Relatórios e conciliação" />

      <Card title="Conciliação">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-stone-500">
            O job <code>reconcile</code> cruza pedidos, pagamentos, snapshots do PSP, reembolsos e webhooks. Se a condição
            some, a pendência fecha sozinha. Uma resolução manual exige justificativa e fica na auditoria.
          </p>
          <div className="flex items-center gap-3 text-sm">
            <a href="?status=OPEN" className={status === "OPEN" ? "font-semibold underline" : "text-stone-500"}>Abertas</a>
            <a href="?status=RESOLVED" className={status === "RESOLVED" ? "font-semibold underline" : "text-stone-500"}>Resolvidas</a>
            {canManage && <ReconciliationRunButton />}
          </div>
        </div>
        {issues.length === 0 ? (
          <Notice tone={status === "OPEN" ? "ok" : "info"}>{status === "OPEN" ? "Nenhuma divergência aberta." : "Nenhuma pendência resolvida."}</Notice>
        ) : (
          <Table head={["Severidade", "Tipo", "Referência", "Detalhes", "Detectada", "Última vez", status === "OPEN" ? "" : "Resolução"]}>
            {issues.map((i) => (
              <tr key={i.id} className="align-top">
                <Td><Badge status={i.severity === "CRITICAL" ? "FAILED" : i.severity === "WARNING" ? "PENDING" : "DRAFT"} label={i.severity} /></Td>
                <Td className="text-xs">{CHECK_LABELS[i.type] ?? i.type}</Td>
                <Td className="font-mono text-xs">
                  {i.entityType === "order" ? <a className="underline" href={`/admin/orders/${i.entityId}`}>{String(i.details.code ?? i.entityId)}</a> : `${i.entityType}:${i.entityId.slice(0, 8)}`}
                  {typeof i.details.orderCode === "string" && <span className="block">pedido {i.details.orderCode}</span>}
                </Td>
                <Td className="max-w-xs break-words font-mono text-[11px] text-stone-500">{JSON.stringify(i.details)}</Td>
                <Td className="text-xs text-stone-500">{formatDateTime(i.detectedAt)}</Td>
                <Td className="text-xs text-stone-500">{formatDateTime(i.lastSeenAt)}</Td>
                <Td>
                  {status === "OPEN"
                    ? canManage && <ResolveIssueForm issueId={i.id} />
                    : <span className="text-xs text-stone-500">{i.resolutionNote}</span>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Exportar (CSV)">
        <form className="mb-4 flex flex-wrap items-end gap-3" id="report-filter">
          <label className="text-xs text-stone-600">
            Evento
            <select name="eventId" className={`${input} mt-1`} form="report-filter">
              <option value="">Todos</option>
              {eventRows.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-stone-600">De<input type="date" name="from" className={`${input} mt-1`} /></label>
          <label className="text-xs text-stone-600">Até<input type="date" name="to" className={`${input} mt-1`} /></label>
        </form>
        <ul className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map((r) => (
            <li key={r.type} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3">
              <div>
                <p className="text-sm font-semibold">{r.label}</p>
                <p className="text-xs text-stone-500">{r.hint}</p>
              </div>
              {/* GET form so filters apply; the download is a normal authenticated request (audited). */}
              <button form="report-filter" formAction={`/api/reports/${r.type}`} formMethod="get" className={btn.secondary}>
                Baixar
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-stone-400">
          Exportações contêm dados pessoais e ficam registradas na auditoria. Limite de 100 mil linhas por arquivo.
          Settlements (liberações do PSP) ainda não entram: dependem da API de relatórios do Mercado Pago, não validada.
        </p>
      </Card>
    </div>
  );
}
