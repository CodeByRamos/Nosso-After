import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import { memberships, organizations, sessions, users } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { randomToken, sha256Hex } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { DUMMY_HASH, verifyPassword } from "./password";
import { permissionsFor, type MembershipRole, type Permission } from "./permissions";

const SESSION_TTL_MS = 12 * 3600_000;
const SESSION_RENEW_AFTER_MS = 15 * 60_000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;

const secureCookies = () => process.env.APP_ENV !== "development" && process.env.APP_ENV !== "test";
export const sessionCookieName = () => (secureCookies() ? "__Host-na_session" : "na_session");

export interface AuthMembership {
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; name: string; isSuperAdmin: boolean };
  memberships: AuthMembership[];
}

export async function login(input: { email: string; password: string; ip: string | null; userAgent: string | null }) {
  const email = input.email.trim().toLowerCase();
  await enforceRateLimit(`login:ip:${input.ip ?? "unknown"}`, 20, 15 * 60);
  await enforceRateLimit(`login:email:${email}`, 10, 15 * 60);

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  const generic = new AppError("UNAUTHENTICATED", "E-mail ou senha inválidos.");
  if (!user) throw generic;
  if (user.status !== "ACTIVE") throw generic;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("RATE_LIMITED", "Conta temporariamente bloqueada por tentativas inválidas. Tente mais tarde.");
  }
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : user.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await audit(db, { action: "auth.login_failed", entityType: "user", entityId: user.id, actorType: "USER", actorUserId: user.id });
    throw generic;
  }

  const token = randomToken(32);
  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning({ id: sessions.id });
  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await audit(db, { action: "auth.login", entityType: "user", entityId: user.id, actorType: "USER", actorUserId: user.id });

  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  logger.info("auth.login", { user_id: user.id, session: session?.id });
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) {
    const db = getDb();
    const [s] = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, sha256Hex(token)))
      .returning({ userId: sessions.userId });
    if (s) await audit(db, { action: "auth.logout", entityType: "user", entityId: s.userId, actorType: "USER", actorUserId: s.userId });
  }
  jar.delete(sessionCookieName());
}

/** Resolves the current staff session (memoized per request). */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token || token.length > 100) return null;
  const db = getDb();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.user.status !== "ACTIVE") return null;

  // Sliding expiration, throttled to avoid a write per request.
  if (Date.now() - row.session.lastSeenAt.getTime() > SESSION_RENEW_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.session.id));
  }

  const ms = await db
    .select({ organizationId: memberships.organizationId, role: memberships.role, organizationName: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, row.user.id), isNull(organizations.deletedAt)));

  return {
    sessionId: row.session.id,
    user: { id: row.user.id, email: row.user.email, name: row.user.name, isSuperAdmin: row.user.platformRole === "SUPER_ADMIN" },
    memberships: ms,
  };
});

export function can(auth: AuthContext, permission: Permission, organizationId: string): boolean {
  if (auth.user.isSuperAdmin) return permissionsFor("SUPER_ADMIN").includes(permission);
  const m = auth.memberships.find((x) => x.organizationId === organizationId);
  return !!m && permissionsFor(m.role).includes(permission);
}

/** Organizations where the user holds a permission (super admin: all). */
export async function organizationsWith(auth: AuthContext, permission: Permission) {
  if (auth.user.isSuperAdmin) {
    return getDb()
      .select({ organizationId: organizations.id, organizationName: organizations.name })
      .from(organizations)
      .where(isNull(organizations.deletedAt));
  }
  return auth.memberships
    .filter((m) => permissionsFor(m.role).includes(permission))
    .map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName }));
}

/** Page guard: redirects to login when anonymous. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** API/action guard: throws instead of redirecting. */
export async function requireApiAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw new AppError("UNAUTHENTICATED", "Faça login.");
  return auth;
}

export function assertCan(auth: AuthContext, permission: Permission, organizationId: string) {
  if (!can(auth, permission, organizationId)) throw new AppError("FORBIDDEN", "Sem permissão para esta ação.");
}

export function canPlatform(auth: AuthContext, permission: Permission) {
  return auth.user.isSuperAdmin && permissionsFor("SUPER_ADMIN").includes(permission);
}
