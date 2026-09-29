import { PromoterForm, PromoterToggle } from "@/components/admin/promoter-forms";
import { Badge, Card, PageHeader, Table, Td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can, organizationsWith } from "@/server/auth/session";
import { env } from "@/server/lib/env";
import { promoterStats } from "@/server/services/promoters";

export const metadata = { title: "Promoters" };

export default async function PromotersPage() {
  const { auth, orgIds } = await adminContext("events:read");
  const writableOrgs = await organizationsWith(auth, "events:write");
  const rows = await promoterStats({ orgIds });
  const base = env().APP_URL;
  const finance = orgIds.some((id) => can(auth, "finance:read", id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promoters"
        subtitle="A atribuição vem de um cookie assinado pelo servidor (último clique, 30 dias). A comissão é calculada sobre o valor dos ingressos e só conta enquanto o pedido estiver pago."
      />
      <Table head={["Promoter", "Link", "Comissão", "Pedidos pagos", "Ingressos", ...(finance ? ["Receita de ingressos", "Comissão devida"] : []), "Status", ""]} empty={rows.length === 0}>
        {rows.map(({ promoter: p, paidOrders, tickets, revenue, commission }) => (
          <tr key={p.id}>
            <Td className="font-medium">{p.name}</Td>
            <Td className="font-mono text-xs">{base}/r/{p.code}</Td>
            <Td className="tabular text-xs">
              {(p.commissionBps / 100).toLocaleString("pt-BR")}%{p.commissionFixedPerTicket ? ` + ${formatBRL(p.commissionFixedPerTicket)}/ingresso` : ""}
            </Td>
            <Td className="tabular">{paidOrders}</Td>
            <Td className="tabular">{tickets}</Td>
            {finance && <Td className="tabular">{formatBRL(Number(revenue))}</Td>}
            {finance && <Td className="tabular font-semibold">{formatBRL(Number(commission))}</Td>}
            <Td><Badge status={p.isActive ? "ACTIVE" : "PAUSED"} label={p.isActive ? "Ativo" : "Inativo"} /></Td>
            <Td>{can(auth, "events:write", p.organizationId) && <PromoterToggle id={p.id} active={p.isActive} />}</Td>
          </tr>
        ))}
      </Table>
      {writableOrgs.length > 0 && (
        <Card title="Novo promoter">
          <PromoterForm orgs={writableOrgs.map((o) => ({ id: o.organizationId, name: o.organizationName }))} />
        </Card>
      )}
    </div>
  );
}
