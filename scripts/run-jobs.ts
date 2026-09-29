/** Runs every background job once (local/manual use). Production uses POST /api/cron/<job>. */
import { closeDb } from "../src/server/db/client";
import { runAllJobs } from "../src/server/services/jobs";

runAllJobs()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .finally(() => closeDb());
