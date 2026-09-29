import { route } from "@/server/lib/http";
import { receiveWebhook } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

/**
 * PSP notifications. Signature is verified on the RAW body before anything else; the payload is
 * then only used to learn WHICH payment changed — its state is re-read from the PSP API.
 */
export const POST = route<{ params: Promise<{ provider: string }> }>(async (req, { params }) => {
  const { provider } = await params;
  const rawBody = await req.text();
  if (rawBody.length > 64_000) return Response.json({ error: "payload too large" }, { status: 413 });
  const result = await receiveWebhook(provider, { headers: req.headers, rawBody, url: new URL(req.url) });
  return Response.json(result.body, { status: result.status });
});
