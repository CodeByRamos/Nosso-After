/**
 * Staff management per organization (no e-mail invites yet: transactional e-mail is not configured,
 * so the admin sets an initial password that the member must change on first login).
 */
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { memberships, promoters, users } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";
import { hashPassword, passwordPolicyError } from "@/server/auth/password";
import type { MembershipRole } from "@/server/auth/permissions";

export async function listMembers(organizationId: string) {
  return getDb()
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      userId: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      mfa: sql<boolean>`${users.mfaEnabledAt} IS NOT NULL`,
      promoterCode: sql<string | null>`(SELECT code FROM promoters p WHERE p.user_id = ${users.id} AND p.organization_id = ${organizationId} LIMIT 1)`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(users.name));
}

export interface AddMemberInput {
  organizationId: string;
  email: string;
  name: string;
  role: MembershipRole;
  initialPassword?: string;
  promoterId?: string;
}

export async function addMember(input: AddMemberInput, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const email = input.email.trim().toLowerCase();
    let user = await tx.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      if (!input.initialPassword) throw new AppError("VALIDATION_ERROR", "Usuário novo: defina uma senha inicial.");
      const policy = passwordPolicyError(input.initialPassword);
      if (policy) throw new AppError("VALIDATION_ERROR", policy);
      [user] = await tx
        .insert(users)
        .values({ email, name: input.name, passwordHash: await hashPassword(input.initialPassword), mustChangePassword: true })
        .returning();
    }
    const [m] = await tx
      .insert(memberships)
      .values({ userId: user!.id, organizationId: input.organizationId, role: input.role })
      .onConflictDoNothing()
      .returning();
    if (!m) throw new AppError("CONFLICT", "Este usuário já é membro da organização.");

    if (input.role === "PROMOTER") {
      if (!input.promoterId) throw new AppError("VALIDATION_ERROR", "Escolha o promoter vinculado a este login.");
      const [linked] = await tx
        .update(promoters)
        .set({ userId: user!.id, updatedAt: new Date() })
        .where(and(eq(promoters.id, input.promoterId), eq(promoters.organizationId, input.organizationId), isNull(promoters.userId)))
        .returning({ id: promoters.id });
      if (!linked) throw new AppError("VALIDATION_ERROR", "Promoter inválido ou já vinculado a outro login.");
    }

    await audit(tx, {
      action: "member.create",
      entityType: "membership",
      entityId: m.id,
      organizationId: input.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { email, role: input.role, newUser: !!input.initialPassword, promoterId: input.promoterId },
    });
    return m;
  });
}

async function assertNotLastAdmin(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], organizationId: string, membershipId: string) {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "ORGANIZATION_ADMIN"), ne(memberships.id, membershipId)));
  if (Number(n) === 0) throw new AppError("INVALID_STATE", "A organização precisa de pelo menos um administrador.");
}

export async function changeMemberRole(membershipId: string, role: MembershipRole, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
    if (!m) throw new AppError("NOT_FOUND", "Membro não encontrado.");
    if (m.role === "ORGANIZATION_ADMIN" && role !== "ORGANIZATION_ADMIN") await assertNotLastAdmin(tx, m.organizationId, m.id);
    if (role === "PROMOTER") throw new AppError("VALIDATION_ERROR", "Para promoter, remova e adicione o membro vinculando o promoter.");
    await tx.update(memberships).set({ role }).where(eq(memberships.id, m.id));
    await audit(tx, {
      action: "member.update",
      entityType: "membership",
      entityId: m.id,
      organizationId: m.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { from: m.role, to: role },
    });
  });
}

export async function removeMember(membershipId: string, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
    if (!m) throw new AppError("NOT_FOUND", "Membro não encontrado.");
    if (m.role === "ORGANIZATION_ADMIN") await assertNotLastAdmin(tx, m.organizationId, m.id);
    await tx.delete(memberships).where(eq(memberships.id, m.id));
    await tx
      .update(promoters)
      .set({ userId: null, updatedAt: new Date() })
      .where(and(eq(promoters.userId, m.userId), eq(promoters.organizationId, m.organizationId)));
    await audit(tx, {
      action: "member.update",
      entityType: "membership",
      entityId: m.id,
      organizationId: m.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { removed: true, userId: m.userId, role: m.role },
    });
  });
}

export async function membershipOrganizationId(id: string) {
  const m = await getDb().query.memberships.findFirst({ where: eq(memberships.id, id), columns: { organizationId: true, userId: true } });
  return m ?? null;
}
