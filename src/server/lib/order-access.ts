import "server-only";
import { cookies } from "next/headers";
import { orderAccessToken, orderCookieName, verifyOrderAccessToken } from "./tokens";

const secure = () => process.env.APP_ENV !== "development" && process.env.APP_ENV !== "test";

/** Buyer access to an order: httpOnly cookie set at purchase (or via the e-mailed link). */
export async function hasOrderAccess(orderId: string): Promise<boolean> {
  const jar = await cookies();
  return verifyOrderAccessToken(orderId, jar.get(orderCookieName(orderId))?.value);
}

export async function grantOrderAccess(orderId: string) {
  const jar = await cookies();
  jar.set(orderCookieName(orderId), orderAccessToken(orderId), {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 120, // until well after the event
  });
}
