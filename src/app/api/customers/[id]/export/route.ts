import { assertCan, requireApiAuth } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { customerOrganizationId, exportCustomerData } from "@/server/services/privacy";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";

/** LGPD access/portability: JSON of everything held about one buyer (privacy:manage, audited). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const auth = await requireApiAuth();
  const id = uuidSchema.parse((await params).id);
  const orgId = await customerOrganizationId(id);
  if (!orgId) throw new AppError("NOT_FOUND", "Titular não encontrado.");
  assertCan(auth, "privacy:manage", orgId);
  await enforceRateLimit(`privacy-export:${auth.user.id}`, 30, 3600);
  const data = await exportCustomerData(id, auth.user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="titular-${id}.json"`,
      "cache-control": "no-store",
    },
  });
});
