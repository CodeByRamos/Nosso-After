import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Scanner } from "@/components/checkin/scanner";
import { can, requireAuth } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { events } from "@/server/db/schema";
import { checkInStats } from "@/server/services/checkin";
import { uuidSchema } from "@/validators/common";

export const metadata: Metadata = { title: "Leitor", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ScannerPage({ params }: { params: Promise<{ eventId: string }> }) {
  const auth = await requireAuth();
  const id = uuidSchema.safeParse((await params).eventId);
  if (!id.success) notFound();
  const event = await getDb().query.events.findFirst({ where: eq(events.id, id.data) });
  if (!event || !can(auth, "checkin:perform", event.organizationId)) notFound();
  const stats = await checkInStats(event.id);
  return <Scanner eventId={event.id} eventName={event.name} operator={auth.user.name} initialStats={stats} />;
}
