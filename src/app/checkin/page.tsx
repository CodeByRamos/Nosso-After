import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { Wordmark } from "@/components/site/site-chrome";
import { formatDateTime } from "@/lib/format";
import { organizationsWith, requireAuth } from "@/server/auth/session";
import { listCheckinEvents } from "@/server/services/checkin";

export const metadata: Metadata = { title: "Portaria", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckinHome() {
  const auth = await requireAuth();
  const orgIds = (await organizationsWith(auth, "checkin:perform")).map((o) => o.organizationId);
  const list = await listCheckinEvents(orgIds);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="flex items-center justify-between">
        <Wordmark />
        <form action={logoutAction}>
          <button className="text-sm text-mute underline">Sair</button>
        </form>
      </div>
      <h1 className="display mt-8 text-4xl">Portaria</h1>
      <p className="mt-1 text-sm text-mute">Escolha o evento para abrir o leitor de QR Code.</p>
      <ul className="mt-6 space-y-3">
        {list.map((e) => (
          <li key={e.id}>
            <Link href={`/checkin/${e.id}`} className="block rounded-2xl border border-line bg-ink-2 p-5 hover:border-sunset">
              <p className="text-lg font-bold">{e.name}</p>
              <p className="text-sm text-sand-2">{formatDateTime(e.startsAt)}</p>
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="text-sand-2">Nenhum evento disponível para check-in.</li>}
      </ul>
    </main>
  );
}
