import Link from "next/link";
import { Badge, PageHeader, Pagination, Table, Td, btn } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { listCheckIns } from "@/server/services/admin-queries";
import { listQuerySchema } from "@/validators/admin";

export const metadata = { title: "Check-ins" };

const LABEL: Record<string, string> = {
  VALID: "Entrada liberada",
  ALREADY_USED: "Já utilizado",
  INVALID: "Inválido",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  WRONG_EVENT: "Outro evento",
};

export default async function CheckInsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { orgIds } = await adminContext("checkin:read");
  const q = listQuerySchema.parse(await searchParams);
  const { rows, hasMore } = await listCheckIns(orgIds, q);
  return (
    <div>
      <PageHeader title="Check-ins" subtitle="Todas as leituras, válidas ou não." actions={<Link href="/checkin" className={btn.primary}>Abrir scanner</Link>} />
      <Table head={["Horário", "Resultado", "Ingresso", "Titular", "Evento", "Operador", "Dispositivo"]} empty={rows.length === 0}>
        {rows.map((c) => (
          <tr key={c.id}>
            <Td className="text-xs text-stone-500">{formatDateTime(c.createdAt)}</Td>
            <Td><Badge status={c.result} label={LABEL[c.result]} /></Td>
            <Td className="font-mono">{c.ticketCode ?? "—"}</Td>
            <Td>{c.holderName ?? "—"}</Td>
            <Td>{c.eventName}</Td>
            <Td>{c.operatorName ?? "—"}</Td>
            <Td className="font-mono text-xs text-stone-400">{c.deviceId?.slice(0, 8) ?? "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={q.page} hasMore={hasMore} params={{}} />
    </div>
  );
}
