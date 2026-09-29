"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, login, logout } from "@/server/auth/session";
import { permissionsFor } from "@/server/auth/permissions";
import { isAppError } from "@/server/lib/errors";
import { clientIp } from "@/server/lib/http";
import { loginSchema } from "@/validators/admin";

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Informe e-mail e senha." };
  const h = await headers();
  try {
    await login({ ...parsed.data, ip: clientIp(h), userAgent: h.get("user-agent") });
  } catch (e) {
    return { error: isAppError(e) ? e.message : "Não foi possível entrar." };
  }
  const auth = await getAuth();
  const onlyCheckin =
    auth && !auth.user.isSuperAdmin && auth.memberships.every((m) => !permissionsFor(m.role).includes("dashboard:view"));
  redirect(onlyCheckin ? "/checkin" : "/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
