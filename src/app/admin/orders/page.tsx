import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, Td, input } from "@/components/admin/ui";
import { formatBRL, formatDateTime, METHOD_LABEL, ORDER_STATUS_LABEL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can } from "@/server/auth/session";
import { listOrders } from "@/server/services/admin-queries";
import { listQuerySchema } from "@/validators/admin";

export const metadata = { title: "Pedidos" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { auth, orgIds } = await adminContext("orders:read");
  const sp = await searchParams;
  const q = listQuerySchema.parse(sp);
  const { rows, hasMore } = await listOrders(orgIds, q);
  const finance = orgIds.some((id) => can(auth, "finance:read", id));

  return (
    <div>
      <PageHeader title="Pedidos" />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q.q} placeholder="Código, nome ou e-mail" className={`${input} max-w-xs`} />
        <select name="status" defaultValue={q.status ?? ""} className={`${input} max-w-[220px]`}>
          <option value="">Todos os status</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Filtrar</button>
      </form>
      <Table head={["Pedido", "Comprador", "Evento", "Status", "Método", ...(finance ? ["Total", "Taxa"] : []), "Criado em"]} empty={rows.length === 0}>
        {rows.map((o) => (
          <tr key={o.id} className="hover:bg-stone-50">
            <Td><Link href={`/admin/orders/${o.id}`} className="font-mono font-semibold hover:underline">{o.code}</Link></Td>
            <Td>
              <span className="block">{o.customerName}</span>
              <span className="block text-xs text-stone-500">{o.customerEmail}</span>
            </Td>
            <Td>{o.eventName}</Td>
            <Td><Badge status={o.status} label={ORDER_STATUS_LABEL[o.status]} /></Td>
            <Td>{METHOD_LABEL[o.method]}</Td>
            {finance && <Td className="tabular">{formatBRL(o.total)}</Td>}
            {finance && <Td className="tabular text-stone-500">{formatBRL(o.fee)}</Td>}
            <Td className="text-xs text-stone-500">{formatDateTime(o.createdAt)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={q.page} hasMore={hasMore} params={{ q: q.q, status: q.status }} />
    </div>
  );
}
