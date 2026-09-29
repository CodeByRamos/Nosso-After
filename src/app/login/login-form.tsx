"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const field = "w-full rounded-xl border border-line bg-ink-3 px-4 py-3 focus:border-sunset focus:outline-none";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
  return (
    <form action={action} className="mt-8 space-y-4">
      {state?.mfa ? (
        <>
          <input type="hidden" name="step" value="mfa" />
          <label className="block">
            <span className="mb-1.5 block text-sm">Código do app autenticador</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={20}
              placeholder="123456 ou código de recuperação"
              className={`${field} tracking-widest`}
            />
          </label>
        </>
      ) : (
        <>
          <label className="block">
            <span className="mb-1.5 block text-sm">E-mail</span>
            <input name="email" type="email" autoComplete="username" required className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">Senha</span>
            <input name="password" type="password" autoComplete="current-password" required className={field} />
          </label>
        </>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="w-full rounded-full bg-sunset py-3.5 font-bold uppercase tracking-wider text-ink disabled:opacity-60">
        {pending ? "Verificando…" : state?.mfa ? "Confirmar" : "Entrar"}
      </button>
    </form>
  );
}
