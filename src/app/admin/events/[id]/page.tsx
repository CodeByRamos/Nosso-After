import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchForm } from "@/components/admin/batch-form";
import { EventForm } from "@/components/admin/event-form";
import { EventStatusControls } from "@/components/admin/event-status";
import { Badge, Card, PageHeader, Table, Td } from "@/components/admin/ui";
import { formatBRL, formatDateTime } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can } from "@/server/auth/session";
import { getEventAdmin } from "@/server/services/admin-events";
import { uuidSchema } from "@/validators/common";

export const metadata = { title: "Evento" };

export default async function EventAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { auth } = await adminContext("events:read");
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getEventAdmin(id.data);
  if (!data || !can(auth, "events:read", data.event.organizationId)) notFound();
  const { event, venue, batches } = data;
  const writable = can(auth, "events:write", event.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={event.name}
        subtitle={`${formatDateTime(event.startsAt)} · ${venue?.name ?? "sem local"}`}
        actions={
          <Link href={`/eventos/${event.slug}`} target="_blank" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
            Ver página pública
          </Link>
        }
      />

      <Card title="Status">
        <div className="flex flex-wrap items-center gap-3">
          <Badge status={event.status} />
          {writable && <EventStatusControls eventId={event.id} current={event.status} />}
        </div>
      </Card>

      <Card title="Lotes">
        <Table head={["Tipo · Lote", "Preço", "Vendidos", "Reservados", "Capacidade", "Janela de vendas", "Status"]} empty={batches.length === 0}>
          {batches.map(({ batch, typeName }) => (
            <tr key={batch.id}>
              <Td><span className="font-medium">{typeName}</span> · {batch.name}</Td>
              <Td className="tabular">{formatBRL(batch.price)}</Td>
              <Td className="tabular">{batch.soldQuantity}</Td>
              <Td className="tabular">{batch.reservedQuantity}</Td>
              <Td className="tabular">{batch.quantity}</Td>
              <Td className="text-xs text-stone-500">
                {batch.salesStart ? formatDateTime(batch.salesStart) : "—"} → {batch.salesEnd ? formatDateTime(batch.salesEnd) : "—"}
              </Td>
              <Td><Badge status={batch.status} /></Td>
            </tr>
          ))}
        </Table>
        {writable && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <BatchForm eventId={event.id} title="Novo lote" />
            {batches.length > 0 && (
              <BatchForm
                eventId={event.id}
                title="Editar lote"
                batches={batches.map(({ batch, typeName }) => ({
                  id: batch.id,
                  typeName,
                  name: batch.name,
                  price: batch.price,
                  quantity: batch.quantity,
                  maxPerCustomer: batch.maxPerCustomer,
                  salesStart: batch.salesStart?.toISOString() ?? null,
                  salesEnd: batch.salesEnd?.toISOString() ?? null,
                  sortOrder: batch.sortOrder,
                  status: batch.status,
                }))}
              />
            )}
          </div>
        )}
      </Card>

      {writable && (
        <Card title="Dados do evento">
          <EventForm
            orgs={[{ id: event.organizationId, name: "" }]}
            initial={{
              id: event.id,
              organizationId: event.organizationId,
              name: event.name,
              slug: event.slug,
              description: event.description,
              coverImageUrl: event.coverImageUrl,
              startsAt: event.startsAt.toISOString(),
              endsAt: event.endsAt.toISOString(),
              salesStartAt: event.salesStartAt?.toISOString() ?? null,
              salesEndAt: event.salesEndAt?.toISOString() ?? null,
              ageRating: event.ageRating,
              accentColor: event.accentColor,
              lineup: event.lineup,
              highlights: event.highlights,
              venueName: venue?.name ?? "",
              venueAddress: venue?.addressLine ?? null,
              venueCity: venue?.city ?? "Guarujá",
              venueState: venue?.state ?? "SP",
            }}
          />
        </Card>
      )}
    </div>
  );
}
