"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { completeMfaLogin, getAuth, login, logout, pendingSetup } from "@/server/auth/session";
import { permissionsFor } from "@/server/auth/permissions";
import { isAppError } from "@/server/lib/errors";
import { clientIp } from "@/server/lib/http";
import { loginSchema } from "@/validators/admin";

export type LoginState = { error?: string; mfa?: boolean } | undefined;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const h = await headers();
  const meta = { ip: clientIp(h), userAgent: h.get("user-agent") };
  if (form.get("step") === "mfa") {
    const code = String(form.get("code") ?? "").slice(0, 20);
    try {
      await completeMfaLogin({ code, ...meta });
    } catch (e) {
      return { mfa: true, error: isAppError(e) ? e.message : "Não foi possível verificar o código." };
    }
    return redirectAfterLogin();
  }
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Informe e-mail e senha." };
  try {
    const r = await login({ ...parsed.data, ...meta });
    if (r.mfaRequired) return { mfa: true };
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Não foi possível entrar." };
  }
  return redirectAfterLogin();
}

async function redirectAfterLogin(): Promise<never> {
  const auth = await getAuth();
  if (auth && pendingSetup(auth)) redirect("/conta");
  const staffLike = auth && !auth.user.isSuperAdmin ? auth.memberships : null;
  if (staffLike && staffLike.length > 0 && staffLike.every((m) => m.role === "PROMOTER")) redirect("/promoter");
  const onlyCheckin = staffLike && staffLike.every((m) => !permissionsFor(m.role).includes("dashboard:view"));
  redirect(onlyCheckin ? "/checkin" : "/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
