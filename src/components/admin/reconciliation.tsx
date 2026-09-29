"use client";

import { useActionState, useState, useTransition } from "react";
import { resolveIssueAction, runReconciliationAction } from "@/app/admin/finance-actions";
import type { ActionState } from "@/app/admin/action-runner";
import { btn } from "./ui";

export function ReconciliationRunButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await runReconciliationAction(); setMsg(r?.error ?? r?.ok ?? null); })}
        className={btn.secondary}
      >
        {pending ? "Conciliando…" : "Rodar agora"}
      </button>
      {msg && <span className="text-xs text-stone-500">{msg}</span>}
    </span>
  );
}

export function ResolveIssueForm({ issueId }: { issueId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveIssueAction, undefined);
  if (state?.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  return (
    <form action={action} className="flex min-w-56 flex-col gap-1">
      <input type="hidden" name="issueId" value={issueId} />
      <input name="note" required minLength={5} placeholder="Justificativa" className="rounded border border-stone-300 px-2 py-1 text-xs" />
      <button disabled={pending} className="self-start text-xs font-semibold underline">{pending ? "…" : "Marcar resolvida"}</button>
      {state?.error && <span className="text-xs text-rose-600">{state.error}</span>}
    </form>
  );
}
