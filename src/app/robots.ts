import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const production = process.env.APP_ENV === "production";
  return {
    // Staging/dev must never be indexed.
    rules: production
      ? { userAgent: "*", allow: "/", disallow: ["/admin", "/checkin", "/pedido", "/api", "/login"] }
      : { userAgent: "*", disallow: "/" },
    sitemap: production ? `${base}/sitemap.xml` : undefined,
  };
}
