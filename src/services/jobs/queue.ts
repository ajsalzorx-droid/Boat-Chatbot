import "server-only";

import { Client } from "@upstash/qstash";
import type { Types } from "mongoose";
import { after } from "next/server";

import { getQueueConfig } from "@/lib/config/env";
import { isAppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";
import type { JobType, ProcessingJobDoc } from "@/models/processing-job";

import { deliverQueuedOutbound } from "@/services/messages/outbound-service";

import { processInboundMessage } from "./inbound-processor";
import { claimJob, completeJob, failJob, type JobFailure } from "./job-service";

/** One handler per job type. */
const HANDLERS: Record<JobType, (job: ProcessingJobDoc) => Promise<string>> = {
  inbound_message: (job) => processInboundMessage(job.payload.messageId),
  outbound_message: (job) => deliverQueuedOutbound(job.payload.messageId),
};

/**
 * Job execution and dispatch.
 *
 * The job record in MongoDB is always written first. Dispatch only decides who runs it:
 * - qstash: QStash calls /api/jobs/process (signed), with its own delivery retries; our retries
 *   are published with a delay.
 * - inline: run after the HTTP response via `after()` (Vercel `waitUntil`); retries are picked up
 *   by the recovery sweep.
 * If dispatch fails, nothing is lost: the recovery sweep re-dispatches pending jobs.
 */

export const JOB_WORKER_PATH = "/api/jobs/process";

/** Inline mode waits in-process for short delays (staff-first, quick retries); longer ones go to the sweep. */
const INLINE_MAX_DELAY_MS = 2 * 60_000;

export type JobRunResult = "done" | "skipped" | "retry_scheduled" | "dead" | "failed";

/**
 * App errors carry their own retryability. Anything else (database blips, unexpected bugs) gets
 * the bounded retry budget and then lands in the dead-letter state for review.
 */
function toFailure(error: unknown): JobFailure {
  if (isAppError(error)) return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof Error) return { code: error.name, message: error.message, retryable: true };
  return { code: "UNKNOWN", message: "Non-error thrown", retryable: true };
}

export async function runJob(jobId: Types.ObjectId): Promise<JobRunResult> {
  const job = await claimJob(jobId);
  if (!job) return "skipped";
  const log = logger.child({ jobId: job._id.toString(), type: job.type, attempt: job.attempts });

  try {
    const outcome = await HANDLERS[job.type](job);
    log.info("job.done", { outcome });
    await completeJob(job._id);
    return "done";
  } catch (error) {
    const failure = toFailure(error);
    const result = await failJob(job, failure);
    log.warn("job.failed", { result: result.status, code: failure.code, error });
    if (result.status === "retry_scheduled") await dispatchJob(job._id, result.runAt);
    return result.status;
  }
}

let qstashClient: Client | null = null;

/** Hands a job to the configured runner. Never throws: the recovery sweep is the safety net. */
export async function dispatchJob(jobId: Types.ObjectId, runAt: Date | null = null): Promise<void> {
  try {
    const queue = getQueueConfig();
    if (queue.mode === "qstash") {
      qstashClient ??= new Client({ token: queue.qstashToken, ...(queue.qstashUrl ? { baseUrl: queue.qstashUrl } : {}) });
      const delaySeconds = runAt ? Math.max(0, Math.ceil((runAt.getTime() - Date.now()) / 1000)) : 0;
      await qstashClient.publishJSON({
        url: `${queue.appBaseUrl}${JOB_WORKER_PATH}`,
        body: { jobId: jobId.toString() },
        ...(delaySeconds > 0 ? { delay: delaySeconds } : {}),
        retries: 3,
        flowControl: { key: "job-worker", parallelism: queue.parallelism },
        deduplicationId: `${jobId.toString()}-${runAt?.getTime() ?? 0}`,
      });
      return;
    }

    const delayMs = runAt ? runAt.getTime() - Date.now() : 0;
    if (delayMs > INLINE_MAX_DELAY_MS) return; // Picked up by the recovery sweep when due.
    try {
      after(async () => {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        await runJob(jobId);
      });
    } catch {
      // Outside a request (scripts, tests): run now.
      await runJob(jobId);
    }
  } catch (error) {
    logger.error("job.dispatch_failed", { jobId: jobId.toString(), error });
  }
}
