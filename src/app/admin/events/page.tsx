import Link from "next/link";
import { Badge, PageHeader, Table, Td, btn } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { listEventsForOrgs } from "@/server/services/admin-events";

export const metadata = { title: "Eventos" };

export default async function EventsPage() {
  const { orgIds } = await adminContext("events:read");
  const rows = await listEventsForOrgs(orgIds);
  return (
    <div>
      <PageHeader title="Eventos" actions={<Link href="/admin/events/new" className={btn.primary}>Novo evento</Link>} />
      <Table head={["Evento", "Data", "Status", "Vendidos", "Página pública"]} empty={rows.length === 0}>
        {rows.map((e) => (
          <tr key={e.id} className="hover:bg-stone-50">
            <Td>
              <Link href={`/admin/events/${e.id}`} className="font-semibold hover:underline">{e.name}</Link>
            </Td>
            <Td>{formatDateTime(e.startsAt)}</Td>
            <Td><Badge status={e.status} /></Td>
            <Td className="tabular">{e.sold} / {e.capacity}</Td>
            <Td><Link href={`/eventos/${e.slug}`} className="text-stone-500 underline" target="_blank">/eventos/{e.slug}</Link></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
