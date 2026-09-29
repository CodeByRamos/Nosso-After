import { readJson, route } from "@/server/lib/http";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { quoteOrder } from "@/server/services/orders";
import { quoteSchema } from "@/validators/checkout";

/** Price preview with itemized service fee. Reserves nothing. */
export const POST = route(async (req, { ip }) => {
  await enforceRateLimit(`quote:${ip ?? "unknown"}`, 60, 60);
  const input = quoteSchema.parse(await readJson(req));
  return Response.json({ data: await quoteOrder(input) });
});
