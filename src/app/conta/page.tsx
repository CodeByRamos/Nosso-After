import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { ChangePasswordForm, MfaDisableForm, MfaEnrollment } from "@/components/account/account-forms";
import { Card, Notice } from "@/components/admin/ui";
import { pendingSetup, requireAuth } from "@/server/auth/session";
import { env, mfaPolicy } from "@/server/lib/env";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const auth = await requireAuth({ allowPendingSetup: true });
  const pending = pendingSetup(auth);
  const mfaAvailable = !!env().MFA_ENCRYPTION_KEY;
  const policy = mfaPolicy();

  return (
    <main className="min-h-dvh bg-stone-100 px-4 py-10 text-stone-900">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Minha conta</h1>
          <div className="flex gap-4 text-sm">
            {!pending && <Link href="/admin" className="underline">Painel</Link>}
            <form action={logoutAction}><button className="underline">Sair</button></form>
          </div>
        </div>
        <p className="text-sm text-stone-500">{auth.user.name} · {auth.user.email}</p>

        {pending === "password" && <Notice tone="warn">Sua conta foi criada com uma senha provisória. Defina uma senha pessoal para continuar.</Notice>}
        {pending === "mfa" && <Notice tone="warn">A política da plataforma exige verificação em duas etapas (MFA) para o seu perfil. Ative abaixo para continuar.</Notice>}

        <Card title="Senha">
          <ChangePasswordForm />
        </Card>

        <Card title="Verificação em duas etapas (MFA)">
          {!mfaAvailable ? (
            <Notice tone="warn">MFA indisponível neste ambiente (MFA_ENCRYPTION_KEY não configurada).</Notice>
          ) : auth.user.mfaEnabled ? (
            <div className="space-y-3">
              <Notice tone="ok">MFA ativo. O login pede o código do app autenticador.</Notice>
              {policy === "none" || (policy === "admins" && !auth.user.isSuperAdmin && !auth.memberships.some((m) => m.role === "ORGANIZATION_ADMIN")) ? (
                <MfaDisableForm />
              ) : (
                <p className="text-xs text-stone-500">Obrigatório para o seu perfil; não pode ser desativado.</p>
              )}
            </div>
          ) : (
            <MfaEnrollment />
          )}
        </Card>
      </div>
    </main>
  );
}
