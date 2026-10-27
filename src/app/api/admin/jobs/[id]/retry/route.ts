import { adminRoute } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors/app-error";
import { json } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { idParamsSchema } from "@/lib/validation/admin";
import { toJobDto } from "@/services/dto";
import { requeueJob } from "@/services/jobs/job-service";
import { dispatchJob } from "@/services/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sends a dead-lettered or failed job back to the queue. */
export const POST = adminRoute<{ id: string }>("admin", async ({ params, session }) => {
  const { id } = idParamsSchema.parse(params);
  const job = await requeueJob(id);
  if (!job) throw new AppError("Job not requeueable", { code: "CONFLICT", httpStatus: 409, publicMessage: "Only failed or dead jobs can be retried." });
  logger.info("job.requeued", { jobId: id.toString(), by: session.user._id.toString() });
  await dispatchJob(job._id);
  return json({ job: toJobDto(job) });
});
