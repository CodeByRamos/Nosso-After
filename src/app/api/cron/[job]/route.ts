import { env } from "@/server/lib/env";
import { safeEqual } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import { route } from "@/server/lib/http";
import { JOBS, runAllJobs, type JobName } from "@/server/services/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduler entrypoint: `Authorization: Bearer <CRON_SECRET>`. Jobs are idempotent. */
async function handle(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env().CRON_SECRET}`)) throw new AppError("UNAUTHENTICATED", "unauthorized");
  const { job } = await params;
  if (job === "all") return Response.json({ data: await runAllJobs() });
  if (!(job in JOBS)) throw new AppError("NOT_FOUND", "unknown job");
  return Response.json({ data: await JOBS[job as JobName]() });
}

export const POST = route(handle);
// Vercel Cron issues GET requests.
export const GET = route(handle);
