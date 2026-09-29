import { and, eq, isNull } from "drizzle-orm";
import { AddMemberForm, MemberRow } from "@/components/admin/member-forms";
import { Card, PageHeader, Table } from "@/components/admin/ui";
import { adminContext } from "@/server/auth/admin-context";
import { getDb } from "@/server/db/client";
import { promoters } from "@/server/db/schema";
import { listMembers } from "@/server/services/members";
import { uuidSchema } from "@/validators/common";

export const metadata = { title: "Membros" };

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { auth, orgs } = await adminContext("members:manage");
  const requested = uuidSchema.safeParse((await searchParams).org);
  const org = orgs.find((o) => requested.success && o.organizationId === requested.data) ?? orgs[0]!;
  const [members, freePromoters] = await Promise.all([
    listMembers(org.organizationId),
    getDb()
      .select({ id: promoters.id, name: promoters.name, code: promoters.code })
      .from(promoters)
      .where(and(eq(promoters.organizationId, org.organizationId), isNull(promoters.userId), eq(promoters.isActive, true))),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membros"
        subtitle={org.organizationName}
        actions={
          orgs.length > 1 ? (
            <form className="flex gap-2">
              <select name="org" defaultValue={org.organizationId} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
                {orgs.map((o) => <option key={o.organizationId} value={o.organizationId}>{o.organizationName}</option>)}
              </select>
              <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Trocar</button>
            </form>
          ) : undefined
        }
      />
      <Table head={["Nome", "E-mail", "Papel", "MFA", "Último acesso", ""]} empty={members.length === 0}>
        {members.map((m) => (
          <MemberRow key={m.membershipId} member={{ ...m, lastLoginAt: m.lastLoginAt?.toISOString() ?? null, self: m.userId === auth.user.id }} />
        ))}
      </Table>
      <Card title="Adicionar membro">
        <AddMemberForm organizationId={org.organizationId} promoters={freePromoters} />
      </Card>
      <p className="text-xs text-stone-500">
        Papéis: <strong>Admin da organização</strong> (tudo, inclusive reembolsos e membros) · <strong>Gerente de evento</strong>{" "}
        (eventos, lotes, cupons, promoters; sem financeiro) · <strong>Portaria</strong> (somente check-in) · <strong>Promoter</strong>{" "}
        (somente as próprias vendas).
      </p>
    </div>
  );
}
