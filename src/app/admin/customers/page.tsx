import { AnonymizeForm } from "@/components/admin/privacy-forms";
import { Card, Notice, PageHeader, Table, Td, input } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";
import { adminContext } from "@/server/auth/admin-context";
import { searchCustomers } from "@/server/services/privacy";

export const metadata = { title: "Titulares (LGPD)" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { orgIds } = await adminContext("privacy:manage");
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const rows = await searchCustomers(orgIds, q);

  return (
    <div className="space-y-6">
      <PageHeader title="Titulares (LGPD)" subtitle="Atendimento a solicitações de acesso, portabilidade e eliminação (art. 18)." />
      <Notice>
        Antes de atender, confirme a identidade do solicitante pelo e-mail cadastrado. A exportação gera um JSON para
        enviar ao titular. A anonimização é <strong>irreversível</strong>: substitui nome, e-mail, telefone e CPF e mantém
        só os registros financeiros exigidos por lei. Tudo fica na auditoria.
      </Notice>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="E-mail ou nome (mín. 3 caracteres)" className={`${input} max-w-sm`} />
        <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Buscar</button>
      </form>
      {q.length >= 3 && (
        <Table head={["Titular", "E-mail", "Pedidos", "Situação", "Ações"]} empty={rows.length === 0}>
          {rows.map((c) => (
            <tr key={c.id} className="align-top">
              <Td className="font-medium">{c.name}</Td>
              <Td>{c.email}</Td>
              <Td className="tabular">{c.orders}</Td>
              <Td className="text-xs">{c.anonymizedAt ? `Anonimizado em ${formatDateTime(c.anonymizedAt)}` : "Ativo"}</Td>
              <Td>
                {!c.anonymizedAt && (
                  <Card className="space-y-2 p-3">
                    <a href={`/api/customers/${c.id}/export`} className="text-sm font-semibold underline">Exportar dados (JSON)</a>
                    <AnonymizeForm customerId={c.id} />
                  </Card>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
