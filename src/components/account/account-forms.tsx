"use client";

import { useActionState, useState, useTransition } from "react";
import { changePasswordAction, confirmMfaAction, disableMfaAction, startMfaAction } from "@/app/conta/actions";
import type { ActionState } from "@/app/admin/action-runner";
import { FormField, Notice, btn, input } from "@/components/admin/ui";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">{state.ok}</Notice>}
      <FormField label="Senha atual"><input name="current" type="password" autoComplete="current-password" required className={input} /></FormField>
      <FormField label="Nova senha" hint="Mínimo de 12 caracteres, com letras e números.">
        <input name="next" type="password" autoComplete="new-password" required minLength={12} className={input} />
      </FormField>
      <FormField label="Confirme a nova senha">
        <input name="confirm" type="password" autoComplete="new-password" required className={input} />
        {state?.fields?.confirm && <span className="mt-1 block text-xs text-rose-600">{state.fields.confirm}</span>}
      </FormField>
      <button disabled={pending} className={btn.primary}>{pending ? "Salvando…" : "Alterar senha"}</button>
    </form>
  );
}

export function MfaEnrollment() {
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (codes) {
    return (
      <div className="space-y-3">
        <Notice tone="ok">MFA ativado.</Notice>
        <p className="text-sm">
          Guarde estes <strong>códigos de recuperação</strong> em local seguro. Cada um vale uma vez, se você perder o celular.
          Eles não serão mostrados de novo.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => <li key={c} className="rounded bg-stone-100 px-2 py-1">{c}</li>)}
        </ul>
        <a href="/admin" className={btn.primary}>Continuar</a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      {!setup ? (
        <>
          <p className="text-sm text-stone-600">Use um app autenticador (Google Authenticator, 1Password, Authy…).</p>
          <button
            disabled={pending}
            className={btn.primary}
            onClick={() => start(async () => {
              const r = await startMfaAction();
              if (r.error || !r.secret || !r.qrSvg) setError(r.error ?? "Erro");
              else setSetup({ secret: r.secret, qrSvg: r.qrSvg });
            })}
          >
            {pending ? "Gerando…" : "Ativar MFA"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">1. Escaneie o QR Code no app autenticador:</p>
          {/* SVG generated server-side by our QR encoder from the otpauth URI. */}
          <div className="w-48 rounded bg-white p-2" role="img" aria-label="QR Code MFA" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <p className="text-xs text-stone-500">Ou digite a chave: <code className="break-all font-mono">{setup.secret}</code></p>
          <p className="text-sm">2. Digite o código de 6 dígitos:</p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${input} max-w-[140px] tracking-widest`} />
            <button
              disabled={pending || code.length !== 6}
              className={btn.primary}
              onClick={() => start(async () => {
                const r = await confirmMfaAction(code);
                if (r.error || !r.codes) setError(r.error ?? "Erro");
                else setCodes(r.codes);
              })}
            >
              Confirmar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function MfaDisableForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(disableMfaAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <FormField label="Código atual para desativar">
        <input name="code" inputMode="numeric" maxLength={6} className={`${input} max-w-[140px]`} />
      </FormField>
      <button disabled={pending} className={btn.secondary}>Desativar MFA</button>
    </form>
  );
}
