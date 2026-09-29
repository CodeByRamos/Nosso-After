import { env } from "./env";
import { hmacSha256, safeEqual } from "./crypto";

// ---------------------------------------------------------------------------
// Ticket QR payload (ADR-0006):  NA1.<ticketId b64url>.<qrVersion>.<mac>
// ---------------------------------------------------------------------------

const QR_PREFIX = "NA1";

function uuidToB64(uuid: string) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

function b64ToUuid(b64: string): string | null {
  const buf = Buffer.from(b64, "base64url");
  if (buf.length !== 16) return null;
  const h = buf.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function qrMac(ticketId: string, version: number) {
  return hmacSha256(env().QR_SIGNING_SECRET, `${QR_PREFIX}|${ticketId}|${version}`).subarray(0, 16).toString("base64url");
}

export function signTicketQr(ticketId: string, version: number): string {
  return `${QR_PREFIX}.${uuidToB64(ticketId)}.${version}.${qrMac(ticketId, version)}`;
}

/** Returns the ticket id + version when the MAC is authentic; null for anything forged/malformed. */
export function verifyTicketQr(payload: string): { ticketId: string; version: number } | null {
  if (typeof payload !== "string" || payload.length > 200) return null;
  const parts = payload.trim().split(".");
  if (parts.length !== 4 || parts[0] !== QR_PREFIX) return null;
  const [, idPart, versionPart, mac] = parts as [string, string, string, string];
  const ticketId = b64ToUuid(idPart);
  const version = Number(versionPart);
  if (!ticketId || !Number.isInteger(version) || version < 1) return null;
  if (!safeEqual(qrMac(ticketId, version), mac)) return null;
  return { ticketId, version };
}

// ---------------------------------------------------------------------------
// Guest order access token (ADR-0005)
// ---------------------------------------------------------------------------

export function orderAccessToken(orderId: string): string {
  return hmacSha256(env().ORDER_ACCESS_SECRET, `order-access:${orderId}`).toString("base64url");
}

export function verifyOrderAccessToken(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  return safeEqual(orderAccessToken(orderId), token);
}

export const orderCookieName = (orderId: string) => `na_order_${orderId.replace(/-/g, "")}`;

// ---------------------------------------------------------------------------
// Promoter attribution cookie (ADR-0008): <promoterId>.<expiresAtUnix>.<mac>
// Signed server-side, so the browser can't forge or edit the attribution.
// ---------------------------------------------------------------------------

export const PROMOTER_COOKIE = "na_ref";
export const PROMOTER_ATTRIBUTION_DAYS = 30;

function refMac(promoterId: string, exp: number) {
  return hmacSha256(env().ORDER_ACCESS_SECRET, `promoter-ref:${promoterId}:${exp}`).subarray(0, 16).toString("base64url");
}

export function signPromoterRef(promoterId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + PROMOTER_ATTRIBUTION_DAYS * 86_400;
  return `${promoterId}.${exp}.${refMac(promoterId, exp)}`;
}

export function verifyPromoterRef(value: string | null | undefined, now = Date.now()): string | null {
  if (!value || value.length > 120) return null;
  const [id, expStr, mac] = value.split(".");
  const exp = Number(expStr);
  if (!id || !mac || !/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(exp)) return null;
  if (exp * 1000 < now) return null;
  return safeEqual(refMac(id, exp), mac) ? id : null;
}
