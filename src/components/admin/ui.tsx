import Link from "next/link";
import { formatBRL } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-stone-700">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, money }: { label: string; value: number; hint?: string; money?: boolean }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-bold">{money ? formatBRL(value) : value.toLocaleString("pt-BR")}</p>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  gray: "bg-stone-100 text-stone-600 ring-stone-500/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  PAID: "green",
  VALID: "green",
  PUBLISHED: "green",
  ACTIVE: "green",
  SUCCEEDED: "green",
  PROCESSED: "green",
  CHECKED_IN: "blue",
  AWAITING_PAYMENT: "yellow",
  PENDING: "yellow",
  PROCESSING: "yellow",
  AUTHORIZED: "yellow",
  REQUESTED: "yellow",
  DRAFT: "gray",
  PAUSED: "gray",
  CLOSED: "gray",
  EXPIRED: "gray",
  FINISHED: "gray",
  CANCELLED: "red",
  FAILED: "red",
  CHARGEBACK: "red",
  REFUND_PENDING: "red",
  REFUNDED: "blue",
  PARTIALLY_REFUNDED: "blue",
  SOLD_OUT: "blue",
  ALREADY_USED: "yellow",
  INVALID: "red",
  WRONG_EVENT: "red",
  DEMO: "yellow",
  SANDBOX: "yellow",
  PRODUCTION: "green",
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const tone = TONES[STATUS_TONE[status] ?? "gray"];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {label ?? status}
    </span>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
      {empty && <p className="p-8 text-center text-sm text-stone-400">Nada por aqui ainda.</p>}
    </div>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

export function Pagination({ page, hasMore, params }: { page: number; hasMore: boolean; params: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `?${sp.toString()}`;
  };
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      {page > 1 && (
        <Link href={href(page - 1)} className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 hover:bg-stone-50">
          Anterior
        </Link>
      )}
      <span className="text-stone-500">Página {page}</span>
      {hasMore && (
        <Link href={href(page + 1)} className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 hover:bg-stone-50">
          Próxima
        </Link>
      )}
    </div>
  );
}

export const btn = {
  primary: "inline-flex items-center justify-center rounded-lg bg-stone-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50",
  secondary: "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50",
  danger: "inline-flex items-center justify-center rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50",
};

export const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900";

export function FormField({ label, name, hint, children }: { label: string; name?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block" htmlFor={name}>
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>;
}
