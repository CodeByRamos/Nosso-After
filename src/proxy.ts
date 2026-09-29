import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge of the app:
 *  1. request id propagation (x-request-id)
 *  2. CSRF defense for cookie-authenticated API mutations: Origin must match the host.
 *     Webhooks (HMAC-signed) and cron (secret-authenticated) are exempt.
 *  3. Per-request nonce-based Content-Security-Policy for pages.
 */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT = [/^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/health$/];

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  const mp = process.env.PAYMENT_PROVIDER === "mercadopago";
  // Mercado Pago Card Payment Brick: SDK script, secure-field iframes, API calls, brand images.
  const mpScript = mp ? " https://sdk.mercadopago.com https://http2.mlstatic.com" : "";
  const mpConnect = mp ? " https://api.mercadopago.com https://api.mercadolibre.com https://events.mercadopago.com https://http2.mlstatic.com" : "";
  const mpFrame = mp ? " https://*.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com" : "";
  const mpImg = mp ? " https://http2.mlstatic.com https://*.mercadopago.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${mpScript}${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes (charts) are allowed; script injection is what the nonce prevents.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${mpImg}`,
    "font-src 'self' data:",
    `connect-src 'self'${mpConnect}`,
    `frame-src ${mp ? mpFrame.trim() : "'none'"}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id")?.match(/^[A-Za-z0-9-]{8,64}$/)?.[0] ?? crypto.randomUUID();

  if (pathname.startsWith("/api/")) {
    if (MUTATING.has(request.method) && !CSRF_EXEMPT.some((r) => r.test(pathname))) {
      const origin = request.headers.get("origin");
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      let ok = false;
      try {
        ok = !!origin && !!host && new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Origem da requisição não permitida." }, requestId },
          { status: 403, headers: { "x-request-id": requestId } },
        );
      }
    }
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", requestId);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
