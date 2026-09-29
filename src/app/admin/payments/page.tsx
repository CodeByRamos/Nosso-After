import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, Td, input } from "@/components/admin/ui";
import { formatBRL, formatDateTime, METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { listPayments } from "@/server/services/admin-queries";
import { listQuerySchema } from "@/validators/admin";

export const metadata = { title: "Pagamentos" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { orgIds } = await adminContext("finance:read");
  const q = listQuerySchema.parse(await searchParams);
  const { rows, hasMore } = await listPayments(orgIds, q);
  return (
    <div>
      <PageHeader title="Pagamentos" subtitle="Estado normalizado + status bruto do PSP, para conciliação." />
      <form className="mb-4 flex gap-2">
        <select name="status" defaultValue={q.status ?? ""} className={`${input} max-w-[220px]`}>
          <option value="">Todos</option>
          {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Filtrar</button>
      </form>
      <Table head={["Pedido", "Status", "Status PSP", "Método", "Valor", "Reembolsado", "Tarifa PSP", "Ambiente", "ID PSP", "Criado"]} empty={rows.length === 0}>
        {rows.map((p) => (
          <tr key={p.id} className="hover:bg-stone-50">
            <Td><Link href={`/admin/orders/${p.orderId}`} className="font-mono font-semibold hover:underline">{p.orderCode}</Link></Td>
            <Td>
              <Badge status={p.status} label={PAYMENT_STATUS_LABEL[p.status]} />
              {p.failureCode === "INTEGRITY_MISMATCH" && <span className="ml-1 text-xs font-semibold text-rose-600">divergência</span>}
            </Td>
            <Td className="font-mono text-xs text-stone-500">{p.providerStatus ?? "—"}</Td>
            <Td>{METHOD_LABEL[p.method]}</Td>
            <Td className="tabular">{formatBRL(p.amount)}</Td>
            <Td className="tabular">{p.refunded ? formatBRL(p.refunded) : "—"}</Td>
            <Td className="tabular">{p.providerFee != null ? formatBRL(p.providerFee) : "—"}</Td>
            <Td><Badge status={p.environment} /></Td>
            <Td className="font-mono text-xs">{p.providerPaymentId ?? "—"}</Td>
            <Td className="text-xs text-stone-500">{formatDateTime(p.createdAt)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={q.page} hasMore={hasMore} params={{ status: q.status }} />
    </div>
  );
}
