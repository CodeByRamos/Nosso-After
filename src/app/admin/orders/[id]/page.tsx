import { notFound } from "next/navigation";
import { RefundForm } from "@/components/admin/refund-form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/admin/ui";
import { formatBRL, formatDateTime, METHOD_LABEL, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, TICKET_STATUS_LABEL } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { can } from "@/server/auth/session";
import { maskDocument } from "@/server/lib/logger";
import { getOrderAdmin } from "@/server/services/admin-queries";
import { uuidSchema } from "@/validators/common";

export const metadata = { title: "Pedido" };

export default async function OrderAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { auth } = await adminContext("orders:read");
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getOrderAdmin(id.data);
  if (!data || !can(auth, "orders:read", data.order.organizationId)) notFound();
  const { order, customer, event, items, payments, tickets, timeline, refunds, fees, coupon, promoter } = data;
  const finance = can(auth, "finance:read", order.organizationId);
  const canRefund = can(auth, "refunds:create", order.organizationId);
  const refundable = payments.find((p) => p.status === "PAID" || p.status === "PARTIALLY_REFUNDED");

  return (
    <div className="space-y-6">
      <PageHeader title={`Pedido ${order.code}`} subtitle={`${event?.name ?? ""} · criado em ${formatDateTime(order.createdAt)}`} actions={<Badge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Comprador">
          <p className="font-medium">{customer?.name}</p>
          <p className="text-sm text-stone-600">{customer?.email}</p>
          <p className="text-sm text-stone-600">{customer?.phone}</p>
          {customer?.document && <p className="text-sm text-stone-400">CPF {maskDocument(customer.document)}</p>}
        </Card>
        <Card title="Valores" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-4">
            {items.map((i) => (
              <div key={i.id} className="col-span-2 flex justify-between sm:col-span-4">
                <dt>{i.quantity}× {i.description}</dt>
                <dd className="tabular">{formatBRL(i.unitPrice * i.quantity)}</dd>
              </div>
            ))}
            {order.discountAmount > 0 && (
              <div className="col-span-2 flex justify-between text-emerald-700 sm:col-span-4"><dt>Desconto (cupom {coupon?.code})</dt><dd className="tabular">−{formatBRL(order.discountAmount)}</dd></div>
            )}
            {finance && (
              <>
                <div className="col-span-2 flex justify-between sm:col-span-4"><dt className="text-stone-500">Taxa de serviço (plataforma)</dt><dd className="tabular">{formatBRL(order.feeAmount)}</dd></div>
                <div className="col-span-2 flex justify-between border-t border-stone-200 pt-1 font-semibold sm:col-span-4"><dt>Total pago</dt><dd className="tabular">{formatBRL(order.totalAmount)}</dd></div>
                {order.refundedAmount > 0 && <div className="col-span-2 flex justify-between text-sky-700 sm:col-span-4"><dt>Reembolsado</dt><dd className="tabular">−{formatBRL(order.refundedAmount)}</dd></div>}
                <div className="col-span-2 flex justify-between text-stone-500 sm:col-span-4"><dt>Líquido produtor (antes da tarifa PSP)</dt><dd className="tabular">{formatBRL(order.paidAt ? order.totalAmount - order.feeAmount - order.refundedAmount : 0)}</dd></div>
                {promoter && <div className="col-span-2 flex justify-between text-stone-500 sm:col-span-4"><dt>Comissão promoter {promoter.name} ({promoter.code})</dt><dd className="tabular">{formatBRL(order.promoterCommissionAmount)}</dd></div>}
              </>
            )}
          </dl>
          {finance && fees.length > 0 && (
            <p className="mt-2 text-xs text-stone-400">
              Regra de taxa aplicada: {String((fees[0]!.snapshot as { name?: string }).name ?? fees[0]!.feeRuleId)}
            </p>
          )}
        </Card>
      </div>

      {finance && (
        <Card title="Pagamentos">
          <Table head={["Status", "Método", "Valor", "Ambiente", "PSP", "ID no PSP", "Tarifa PSP", "Criado"]} empty={payments.length === 0}>
            {payments.map((p) => (
              <tr key={p.id}>
                <Td><Badge status={p.status} label={PAYMENT_STATUS_LABEL[p.status]} /></Td>
                <Td>{METHOD_LABEL[p.method]}{p.cardLastFour ? ` •••• ${p.cardLastFour}` : ""}{p.installments > 1 ? ` ${p.installments}×` : ""}</Td>
                <Td className="tabular">{formatBRL(p.amount)}</Td>
                <Td><Badge status={p.environment} /></Td>
                <Td>{p.provider}</Td>
                <Td className="font-mono text-xs">{p.providerPaymentId ?? "—"}</Td>
                <Td className="tabular">{p.providerFeeAmount != null ? formatBRL(p.providerFeeAmount) : "—"}</Td>
                <Td className="text-xs text-stone-500">{formatDateTime(p.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {finance && (
        <Card title="Reembolsos">
          {refunds.length > 0 && (
            <Table head={["Status", "Valor", "Motivo", "Solicitado por", "ID no PSP", "Data"]}>
              {refunds.map(({ refund: r, by }) => (
                <tr key={r.id}>
                  <Td><Badge status={r.status} /></Td>
                  <Td className="tabular">{formatBRL(r.amount)}</Td>
                  <Td>{r.reason}{r.failureMessage ? <span className="block text-xs text-rose-600">{r.failureMessage}</span> : null}</Td>
                  <Td>{by ?? "—"}</Td>
                  <Td className="font-mono text-xs">{r.providerRefundId ?? "—"}</Td>
                  <Td className="text-xs text-stone-500">{formatDateTime(r.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canRefund && refundable ? (
            <div className="mt-4">
              <RefundForm orderId={order.id} refundable={refundable.amount - refundable.refundedAmount} />
            </div>
          ) : (
            refunds.length === 0 && <p className="text-sm text-stone-500">Nenhum reembolso.</p>
          )}
        </Card>
      )}

      <Card title={`Ingressos (${tickets.length})`}>
        <Table head={["Código", "Titular", "Status", "Emitido", "Check-in"]} empty={tickets.length === 0}>
          {tickets.map((t) => (
            <tr key={t.id}>
              <Td className="font-mono">{t.code}</Td>
              <Td>{t.holderName}</Td>
              <Td><Badge status={t.status} label={TICKET_STATUS_LABEL[t.status]} /></Td>
              <Td className="text-xs text-stone-500">{formatDateTime(t.issuedAt)}</Td>
              <Td className="text-xs text-stone-500">{t.checkedInAt ? formatDateTime(t.checkedInAt) : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Linha do tempo">
        <ol className="space-y-2 text-sm">
          {timeline.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-36 shrink-0 text-xs text-stone-400">{formatDateTime(e.createdAt)}</span>
              <span className="font-mono text-xs font-semibold">{e.type}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
