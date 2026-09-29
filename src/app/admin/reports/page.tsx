import { PhaseTwo } from "@/components/admin/phase-two";
import { adminContext } from "@/server/auth/admin-context";

export const metadata = { title: "Relatórios" };

export default async function ReportsPage() {
  await adminContext("finance:read");
  return (
    <PhaseTwo
      title="Relatórios e conciliação"
      description="Os dados já existem (payments, provider_transactions, refunds, webhook_events, audit_logs). A Visão geral e a lista de Pagamentos já mostram o status bruto do PSP e marcam divergências de valor."
      items={["Exportação CSV de vendas e repasses", "Conciliação automática: pagamento sem pedido, pedido sem pagamento, diferença de valor, webhook ausente, refund divergente", "Settlements (liquidações do PSP)", "Relatório de comissões de promoters"]}
    />
  );
}
