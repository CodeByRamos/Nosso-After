import { desc } from "drizzle-orm";
import { FeeRuleForm, FeeRuleToggle } from "@/components/admin/fee-rules";
import { Badge, Card, Notice, PageHeader, Table, Td } from "@/components/admin/ui";
import { formatBRL, formatDateTime, METHOD_LABEL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { canPlatform } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { feeRules } from "@/server/db/schema";
import { getActiveProvider } from "@/server/payments/registry";
import { webhookHealth } from "@/server/services/admin-queries";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const { auth, orgs } = await adminContext("members:manage");
  const provider = getActiveProvider();
  const platform = canPlatform(auth, "fees:manage");
  const [rules, wh] = await Promise.all([
    getDb().select().from(feeRules).orderBy(desc(feeRules.createdAt)).limit(100),
    platform ? webhookHealth() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" />

      <Card title="Processador de pagamento">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">{provider.id}</span>
          <Badge status={provider.environment} />
          <span className="text-stone-500">
            Pix {provider.capabilities.pix ? "✓" : "✗"} · Cartão {provider.capabilities.creditCard ? "✓" : "✗"} · Split{" "}
            {provider.capabilities.split ? "✓" : "✗ (não habilitado)"} · Reembolso parcial {provider.capabilities.partialRefund ? "✓" : "✗"}
          </span>
        </div>
        {provider.environment !== "PRODUCTION" && (
          <div className="mt-3">
            <Notice tone="warn">
              Ambiente {provider.environment}: nenhuma cobrança real acontece. Para produção, veja docs/PAYMENTS.md (checklist).
            </Notice>
          </div>
        )}
        {wh && (
          <p className="mt-3 text-sm text-stone-500">
            Webhooks nas últimas 24h: {wh.last24h} · com falha aguardando retry: <strong className={wh.failed ? "text-rose-600" : ""}>{wh.failed}</strong>
          </p>
        )}
      </Card>

      <Card title="Taxas da plataforma">
        {!platform && (
          <Notice>As taxas da plataforma são definidas pela administração do Nosso After. Aqui você vê as regras vigentes.</Notice>
        )}
        <div className="mt-3">
          <Table head={["Regra", "Escopo", "Método", "Base", "Fixo", "%", "Vigência", "Status", ""]} empty={rules.length === 0}>
            {rules
              .filter((r) => platform || !r.organizationId || orgs.some((o) => o.organizationId === r.organizationId))
              .map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-xs">{r.eventId ? "Evento" : r.organizationId ? "Organização" : "Global"}</Td>
                  <Td>{r.paymentMethod ? METHOD_LABEL[r.paymentMethod] : "Todos"}</Td>
                  <Td>{r.appliesPer === "TICKET" ? "Por ingresso" : "Por pedido"}</Td>
                  <Td className="tabular">{formatBRL(r.fixedAmount)}</Td>
                  <Td className="tabular">{(r.percentageBps / 100).toFixed(2).replace(".", ",")}%</Td>
                  <Td className="text-xs text-stone-500">{formatDateTime(r.activeFrom)} → {r.activeUntil ? formatDateTime(r.activeUntil) : "∞"}</Td>
                  <Td><Badge status={r.isActive ? "ACTIVE" : "PAUSED"} label={r.isActive ? "Ativa" : "Inativa"} /></Td>
                  <Td>{platform && <FeeRuleToggle id={r.id} active={r.isActive} />}</Td>
                </tr>
              ))}
          </Table>
        </div>
        {platform && (
          <div className="mt-4">
            <FeeRuleForm orgs={orgs.map((o) => ({ id: o.organizationId, name: o.organizationName }))} />
          </div>
        )}
      </Card>
    </div>
  );
}
