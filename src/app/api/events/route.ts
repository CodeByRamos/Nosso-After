import { route } from "@/server/lib/http";
import { listPublishedEvents } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

/** Public: upcoming published events. */
export const GET = route(async () => {
  const events = await listPublishedEvents(50);
  return Response.json(
    { data: events },
    { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } },
  );
});
