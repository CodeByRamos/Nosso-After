import { z } from "zod";
import { organizationsWith, requireApiAuth } from "@/server/auth/session";
import type { Permission } from "@/server/auth/permissions";
import { audit } from "@/server/lib/audit";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { enforceRateLimit } from "@/server/lib/rate-limit";
import { REPORT_TYPES, streamReport, type ReportType } from "@/server/services/reports";
import { uuidSchema } from "@/validators/common";

export const dynamic = "force-dynamic";

const PERMISSION: Record<ReportType, Permission> = {
  orders: "finance:read",
  "sales-by-batch": "finance:read",
  promoters: "finance:read",
  checkins: "checkin:read",
};

const querySchema = z.object({
  eventId: uuidSchema.optional().or(z.literal("").transform(() => undefined)),
  from: z.iso.date().optional().or(z.literal("").transform(() => undefined)),
  to: z.iso.date().optional().or(z.literal("").transform(() => undefined)),
});

/** Staff CSV export, scoped to the organizations where the caller holds the report's permission. */
export const GET = route<{ params: Promise<{ type: string }> }>(async (req, { params }) => {
  const auth = await requireApiAuth();
  const type = (await params).type as ReportType;
  if (!REPORT_TYPES.includes(type)) throw new AppError("NOT_FOUND", "Relatório inexistente.");
  await enforceRateLimit(`report:${auth.user.id}`, 20, 300);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const orgIds = (await organizationsWith(auth, PERMISSION[type])).map((o) => o.organizationId);
  if (orgIds.length === 0) throw new AppError("FORBIDDEN", "Sem permissão para este relatório.");

  // Exports carry personal data: every download is audited.
  await audit(getDb(), {
    action: "report.export",
    entityType: "report",
    entityId: type,
    actorType: "USER",
    actorUserId: auth.user.id,
    metadata: { type, ...q },
  });

  // São Paulo day boundaries (UTC-03:00).
  const from = q.from ? new Date(`${q.from}T00:00:00-03:00`) : undefined;
  const to = q.to ? new Date(new Date(`${q.to}T00:00:00-03:00`).getTime() + 86_400_000) : undefined;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(streamReport(type, { organizationIds: orgIds, eventId: q.eventId, from, to }), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="nossoafter-${type}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
});
