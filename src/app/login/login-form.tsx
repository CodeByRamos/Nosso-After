"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-8 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm">E-mail</span>
        <input name="email" type="email" autoComplete="username" required className="w-full rounded-xl border border-line bg-ink-3 px-4 py-3 focus:border-sunset focus:outline-none" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm">Senha</span>
        <input name="password" type="password" autoComplete="current-password" required className="w-full rounded-xl border border-line bg-ink-3 px-4 py-3 focus:border-sunset focus:outline-none" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="w-full rounded-full bg-sunset py-3.5 font-bold uppercase tracking-wider text-ink disabled:opacity-60">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
