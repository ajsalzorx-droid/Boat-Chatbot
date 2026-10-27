import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { runRecovery } from "@/services/jobs/recovery-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Same work as the scheduled cron, on demand. */
export const POST = adminRoute("admin", async ({ session }) => {
  const report = await runRecovery();
  logger.info("recovery.manual", { by: session.user._id.toString() });
  return json(report);
});
