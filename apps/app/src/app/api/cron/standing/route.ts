import { handleStandingCron } from "@synoro/api";
import { db } from "@synoro/db";

/**
 * The daily standing-time run (`docs/standing-time.md`), posted to by the
 * Hatchet worker with the shared `CRON_SECRET`. See `handleStandingCron`.
 */
export async function POST(request: Request) {
  return handleStandingCron(request, db);
}
