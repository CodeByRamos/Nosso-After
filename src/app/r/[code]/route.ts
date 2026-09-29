import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { clientIp } from "@/server/lib/http";
import { PROMOTER_ATTRIBUTION_DAYS, PROMOTER_COOKIE, signPromoterRef } from "@/server/lib/tokens";
import { findActivePromoterByCode, landingPathFor } from "@/server/services/promoters";

/**
 * Promoter link: nossoafter.com/r/JOAO
 * Stores a server-signed attribution cookie (last click wins, 30 days) and redirects to the
 * organization's next event. Unknown/inactive codes just go home — no error, no enumeration hint.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const url = new URL(req.url);
  try {
    await enforceRateLimit(`ref:${clientIp(req.headers) ?? "unknown"}`, 60, 60);
  } catch {
    return NextResponse.redirect(new URL("/", url.origin), 303);
  }
  const promoter = await findActivePromoterByCode((await params).code);
  if (!promoter) return NextResponse.redirect(new URL("/", url.origin), 303);

  const res = NextResponse.redirect(new URL(await landingPathFor(promoter), url.origin), 303);
  res.cookies.set(PROMOTER_COOKIE, signPromoterRef(promoter.id), {
    httpOnly: true,
    secure: process.env.APP_ENV !== "development" && process.env.APP_ENV !== "test",
    sameSite: "lax",
    path: "/",
    maxAge: PROMOTER_ATTRIBUTION_DAYS * 86_400,
  });
  return res;
}
