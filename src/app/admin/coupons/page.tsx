import { asc, inArray } from "drizzle-orm";
import { CouponForm, CouponToggle } from "@/components/admin/coupon-forms";
import { Badge, Card, PageHeader, Table, Td } from "@/components/admin/ui";
import { formatBRL, formatDateTime } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can, organizationsWith } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { events, ticketBatches, ticketTypes } from "@/server/db/schema";
import { listCoupons } from "@/server/services/coupons";
import { eq } from "drizzle-orm";

export const metadata = { title: "Cupons" };

export default async function CouponsPage() {
  const { auth, orgIds } = await adminContext("events:read");
  const writableOrgs = await organizationsWith(auth, "events:write");
  const [rows, eventRows, batchRows] = await Promise.all([
    listCoupons(orgIds),
    getDb().select({ id: events.id, name: events.name, organizationId: events.organizationId }).from(events).where(inArray(events.organizationId, orgIds)).orderBy(asc(events.startsAt)),
    getDb()
      .select({ id: ticketBatches.id, eventId: ticketBatches.eventId, name: ticketBatches.name, typeName: ticketTypes.name })
      .from(ticketBatches)
      .innerJoin(ticketTypes, eq(ticketTypes.id, ticketBatches.ticketTypeId))
      .innerJoin(events, eq(events.id, ticketBatches.eventId))
      .where(inArray(events.organizationId, orgIds))
      .orderBy(asc(ticketBatches.sortOrder)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Cupons" subtitle="Desconto por ingresso, validado no servidor, com contagem de uso atômica." />
      <Table head={["Código", "Desconto", "Escopo", "Usos (reservados+confirmados)", "Desconto concedido", "Validade", "Status", ""]} empty={rows.length === 0}>
        {rows.map(({ coupon: c, confirmed, discountGiven, eventName }) => (
          <tr key={c.id}>
            <Td>
              <span className="font-mono font-semibold">{c.code}</span>
              {c.description && <span className="block text-xs text-stone-500">{c.description}</span>}
            </Td>
            <Td className="tabular">{c.type === "PERCENTAGE" ? `${(c.value / 100).toLocaleString("pt-BR")}%` : formatBRL(c.value)} / ingresso</Td>
            <Td className="text-xs">{eventName ?? "Todos os eventos"}</Td>
            <Td className="tabular">
              {c.redeemedCount}
              {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} <span className="text-xs text-stone-400">({confirmed} pagos)</span>
            </Td>
            <Td className="tabular">{formatBRL(Number(discountGiven))}</Td>
            <Td className="text-xs text-stone-500">{formatDateTime(c.validFrom)} → {c.validUntil ? formatDateTime(c.validUntil) : "∞"}</Td>
            <Td><Badge status={c.isActive ? "ACTIVE" : "PAUSED"} label={c.isActive ? "Ativo" : "Inativo"} /></Td>
            <Td>{can(auth, "events:write", c.organizationId) && <CouponToggle id={c.id} active={c.isActive} />}</Td>
          </tr>
        ))}
      </Table>
      {writableOrgs.length > 0 && (
        <Card title="Novo cupom">
          <CouponForm
            orgs={writableOrgs.map((o) => ({ id: o.organizationId, name: o.organizationName }))}
            events={eventRows}
            batches={batchRows.map((b) => ({ id: b.id, eventId: b.eventId, label: `${b.typeName} · ${b.name}` }))}
          />
        </Card>
      )}
    </div>
  );
}
