import { EventForm } from "@/components/admin/event-form";
import { PageHeader } from "@/components/admin/ui";
import { adminContext } from "@/server/auth/admin-context";
import { organizationsWith } from "@/server/auth/session";

export const metadata = { title: "Novo evento" };

export default async function NewEventPage() {
  const { auth } = await adminContext("events:write");
  const orgs = await organizationsWith(auth, "events:write");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Novo evento" subtitle="O evento nasce como rascunho; publique depois de criar os lotes." />
      <EventForm orgs={orgs.map((o) => ({ id: o.organizationId, name: o.organizationName }))} />
    </div>
  );
}
