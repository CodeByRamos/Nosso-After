import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, Td, input } from "@/components/admin/ui";
import { formatDateTime, TICKET_STATUS_LABEL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { listTickets } from "@/server/services/admin-queries";
import { listQuerySchema } from "@/validators/admin";

export const metadata = { title: "Ingressos" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { orgIds } = await adminContext("tickets:read");
  const q = listQuerySchema.parse(await searchParams);
  const { rows, hasMore } = await listTickets(orgIds, q);
  return (
    <div>
      <PageHeader title="Ingressos" />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q.q} placeholder="Código, titular ou e-mail" className={`${input} max-w-xs`} />
        <select name="status" defaultValue={q.status ?? ""} className={`${input} max-w-[200px]`}>
          <option value="">Todos</option>
          {Object.entries(TICKET_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Filtrar</button>
      </form>
      <Table head={["Código", "Titular", "Evento", "Tipo · Lote", "Status", "Emitido", "Check-in"]} empty={rows.length === 0}>
        {rows.map((t) => (
          <tr key={t.id} className="hover:bg-stone-50">
            <Td><Link href={`/admin/orders/${t.orderId}`} className="font-mono hover:underline">{t.code}</Link></Td>
            <Td>
              <span className="block">{t.holderName}</span>
              <span className="block text-xs text-stone-500">{t.holderEmail}</span>
            </Td>
            <Td>{t.eventName}</Td>
            <Td>{t.typeName} · {t.batchName}</Td>
            <Td><Badge status={t.status} label={TICKET_STATUS_LABEL[t.status]} /></Td>
            <Td className="text-xs text-stone-500">{formatDateTime(t.issuedAt)}</Td>
            <Td className="text-xs text-stone-500">{t.checkedInAt ? formatDateTime(t.checkedInAt) : "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={q.page} hasMore={hasMore} params={{ q: q.q, status: q.status }} />
    </div>
  );
}
