import { NextResponse } from "next/server";
import { grantOrderAccess } from "@/server/lib/order-access";
import { verifyOrderAccessToken } from "@/server/lib/tokens";
import { uuidSchema } from "@/validators/common";

/**
 * Magic link from the confirmation e-mail: validates the HMAC token, stores it in an httpOnly
 * cookie and redirects to the clean URL (the token never stays in the address bar or history).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = uuidSchema.safeParse((await params).id);
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!parsed.success || !verifyOrderAccessToken(parsed.data, token)) {
    return new NextResponse("Link inválido ou expirado.", { status: 404, headers: { "Referrer-Policy": "no-referrer" } });
  }
  await grantOrderAccess(parsed.data);
  const res = NextResponse.redirect(new URL(`/pedido/${parsed.data}`, url.origin), 303);
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
