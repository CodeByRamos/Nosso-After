import type { MetadataRoute } from "next";
import { listPublishedEvents } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const events = await listPublishedEvents(200);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...events.map((e) => ({ url: `${base}/eventos/${e.slug}`, changeFrequency: "daily" as const, priority: 0.9 })),
    { url: `${base}/termos`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacidade`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
