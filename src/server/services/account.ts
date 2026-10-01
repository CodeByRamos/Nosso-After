import { and, eq, ne } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from "@/server/auth/totp";
import { audit } from "@/server/lib/audit";
import { env } from "@/server/lib/env";
import { AppError } from "@/server/lib/errors";
import { enforceRateLimit } from "@/server/lib/rate-limit";

async function loadUser(userId: string) {
  const u = await getDb().query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) throw new AppError("NOT_FOUND", "Usuário não encontrado.");
  return u;
}

function mfaKey() {
  const k = env().MFA_ENCRYPTION_KEY;
  if (!k) throw new AppError("NOT_SUPPORTED", "MFA indisponível: MFA_ENCRYPTION_KEY não configurada.");
  return k;
}

/** Changes the password and revokes every other session of the user. */
export async function changePassword(userId: string, currentSessionId: string, current: string, next: string) {
  await enforceRateLimit(`pwchange:${userId}`, 5, 15 * 60);
  const user = await loadUser(userId);
  if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("VALIDATION_ERROR", "Senha atual incorreta.");
  const policy = passwordPolicyError(next);
  if (policy) throw new AppError("VALIDATION_ERROR", policy);
  if (await verifyPassword(next, user.passwordHash)) throw new AppError("VALIDATION_ERROR", "A nova senha deve ser diferente da atual.");
  await getDb().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
    await audit(tx, { action: "auth.password_change", entityType: "user", entityId: userId, actorType: "USER", actorUserId: userId });
  });
}

/** Generates a new (pending) TOTP secret. MFA only becomes active after confirmMfa(). */
export async function startMfaEnrollment(userId: string) {
  const user = await loadUser(userId);
  if (user.mfaEnabledAt) throw new AppError("INVALID_STATE", "MFA já está ativo.");
  const secret = generateTotpSecret();
  await getDb().update(users).set({ mfaSecretEnc: encryptSecret(secret, mfaKey()), updatedAt: new Date() }).where(eq(users.id, userId));
  const uri = otpauthUri(secret, user.email);
  return { secret, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1 }) };
}

/** Confirms enrollment with a first valid code; returns recovery codes (shown once, stored hashed). */
export async function confirmMfa(userId: string, code: string) {
  await enforceRateLimit(`mfa-enroll:${userId}`, 10, 15 * 60);
  const user = await loadUser(userId);
  if (user.mfaEnabledAt) throw new AppError("INVALID_STATE", "MFA já está ativo.");
  if (!user.mfaSecretEnc) throw new AppError("INVALID_STATE", "Gere o QR Code primeiro.");
  const step = verifyTotp(decryptSecret(user.mfaSecretEnc, mfaKey()), code.replace(/\s/g, ""));
  if (step === null) throw new AppError("VALIDATION_ERROR", "Código inválido. Confira o horário do celular.");
  const { codes, hashes } = generateRecoveryCodes();
  await getDb().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfaEnabledAt: new Date(), mfaRecoveryHashes: hashes, mfaLastStep: step, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await audit(tx, { action: "auth.mfa_enable", entityType: "user", entityId: userId, actorType: "USER", actorUserId: userId });
  });
  return codes;
}

export async function disableMfa(userId: string, code: string, policyRequires: boolean) {
  if (policyRequires) throw new AppError("FORBIDDEN", "A política da plataforma exige MFA para o seu perfil.");
  const user = await loadUser(userId);
  if (!user.mfaEnabledAt || !user.mfaSecretEnc) throw new AppError("INVALID_STATE", "MFA não está ativo.");
  await enforceRateLimit(`mfa-disable:${userId}`, 5, 15 * 60);
  const step = verifyTotp(decryptSecret(user.mfaSecretEnc, mfaKey()), code.replace(/\s/g, ""));
  // Same replay rule as login: a code (time step) can be used once.
  if (step === null || step <= (user.mfaLastStep ?? -1)) {
    throw new AppError("VALIDATION_ERROR", "Código inválido.");
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryHashes: null, mfaLastStep: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await audit(tx, { action: "auth.mfa_disable", entityType: "user", entityId: userId, actorType: "USER", actorUserId: userId });
  });
}
