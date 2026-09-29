import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { AdminNav } from "@/components/admin/nav";
import { PaymentEnvBanner } from "@/components/site/site-chrome";
import { can, canPlatform, requireAuth } from "@/server/auth/session";
import type { Permission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel Nosso After" }, robots: { index: false } };
export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/admin", label: "Visão geral", perm: "dashboard:view" },
  { href: "/admin/events", label: "Eventos", perm: "events:read" },
  { href: "/admin/orders", label: "Pedidos", perm: "orders:read" },
  { href: "/admin/payments", label: "Pagamentos", perm: "finance:read" },
  { href: "/admin/tickets", label: "Ingressos", perm: "tickets:read" },
  { href: "/admin/checkins", label: "Check-ins", perm: "checkin:read" },
  { href: "/admin/coupons", label: "Cupons", perm: "events:write" },
  { href: "/admin/promoters", label: "Promoters", perm: "events:write" },
  { href: "/admin/reports", label: "Relatórios", perm: "finance:read" },
  { href: "/admin/settings", label: "Configurações", perm: "members:manage" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const allowed = (perm: Permission) =>
    canPlatform(auth, perm) || auth.memberships.some((m) => can(auth, perm, m.organizationId));
  const items = NAV.filter((n) => allowed(n.perm));

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <PaymentEnvBanner />
      <div className="lg:grid lg:grid-cols-[220px_1fr]">
        <aside className="border-b border-stone-200 bg-white lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 py-4">
            <Link href="/admin" className="display text-xl text-stone-900">
              Nosso<span className="text-sunset">After</span>
            </Link>
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-stone-500">Painel</span>
          </div>
          <AdminNav items={items.map(({ href, label }) => ({ href, label }))} />
          <div className="hidden border-t border-stone-200 p-4 text-xs text-stone-500 lg:absolute lg:bottom-0 lg:block lg:w-full">
            <p className="truncate font-medium text-stone-700">{auth.user.name}</p>
            <p className="truncate">{auth.user.email}</p>
            <div className="mt-2 flex gap-3">
              <Link href="/checkin" className="underline">Scanner</Link>
              <form action={logoutAction}>
                <button className="underline">Sair</button>
              </form>
            </div>
          </div>
        </aside>
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
