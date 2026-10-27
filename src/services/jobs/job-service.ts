import "server-only";

import type { Types } from "mongoose";

import { isDuplicateKeyError } from "@/lib/db/errors";
import { connectToDatabase } from "@/lib/db/mongoose";
import { expiresInDays, OPERATIONAL_RECORD_TTL_DAYS } from "@/models/define-model";
import { ProcessingJob, type JobType, type ProcessingJobDoc } from "@/models/processing-job";

import { backoffDelayMs } from "./backoff";

/** Durable job records: the source of truth for background work, whatever delivers it. */

const LOCK_MS = 2 * 60_000;

export async function createJob(input: {
  type: JobType;
  idempotencyKey: string;
  payload: ProcessingJobDoc["payload"];
  /** When the job becomes due; defaults to now. */
  runAt?: Date;
}): Promise<{ job: ProcessingJobDoc; created: boolean }> {
  await connectToDatabase();
  try {
    const job = await ProcessingJob.create({ ...input, status: "pending", runAt: input.runAt ?? new Date() });
    return { job: job.toObject(), created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await ProcessingJob.findOne({ idempotencyKey: input.idempotencyKey }).lean();
    if (!existing) throw error;
    return { job: existing, created: false };
  }
}

/**
 * Atomically takes ownership of a job that is due. Returns null when it is finished, not yet due,
 * or currently held by another worker (an expired lock can be taken over after a crash).
 */
export async function claimJob(id: Types.ObjectId, now: Date = new Date()): Promise<ProcessingJobDoc | null> {
  await connectToDatabase();
  return ProcessingJob.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { status: { $in: ["pending", "retry_scheduled"] }, runAt: { $lte: now } },
        { status: "processing", lockedUntil: { $lte: now } },
      ],
    },
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { returnDocument: "after", lean: true },
  );
}

export async function completeJob(id: Types.ObjectId): Promise<void> {
  const now = new Date();
  await ProcessingJob.updateOne(
    { _id: id },
    { $set: { status: "done", lockedUntil: null, completedAt: now, expireAt: expiresInDays(OPERATIONAL_RECORD_TTL_DAYS, now) } },
  );
}

export interface JobFailure {
  code: string;
  message: string;
  retryable: boolean;
}

/** Records a failure; schedules a retry with backoff, or dead-letters after the last attempt. */
export async function failJob(job: ProcessingJobDoc, failure: JobFailure): Promise<{ status: "retry_scheduled" | "dead" | "failed"; runAt: Date | null }> {
  const lastError = { code: failure.code.slice(0, 100), message: failure.message.slice(0, 1000), retryable: failure.retryable };
  if (!failure.retryable) {
    await ProcessingJob.updateOne({ _id: job._id }, { $set: { status: "failed", lockedUntil: null, lastError } });
    return { status: "failed", runAt: null };
  }
  if (job.attempts >= job.maxAttempts) {
    await ProcessingJob.updateOne({ _id: job._id }, { $set: { status: "dead", lockedUntil: null, lastError } });
    return { status: "dead", runAt: null };
  }
  const runAt = new Date(Date.now() + backoffDelayMs(job.attempts));
  await ProcessingJob.updateOne({ _id: job._id }, { $set: { status: "retry_scheduled", lockedUntil: null, runAt, lastError } });
  return { status: "retry_scheduled", runAt };
}

/** Controlled recovery: an administrator sends a dead or failed job back to the queue. */
export async function requeueJob(id: Types.ObjectId): Promise<ProcessingJobDoc | null> {
  await connectToDatabase();
  return ProcessingJob.findOneAndUpdate(
    { _id: id, status: { $in: ["dead", "failed"] } },
    { $set: { status: "pending", attempts: 0, runAt: new Date(), lockedUntil: null } },
    { returnDocument: "after", lean: true },
  );
}

/** Jobs that should be running but are not: never dispatched, retry due, or worker crashed. */
export async function findRecoverableJobs(limit: number, now: Date = new Date()): Promise<ProcessingJobDoc[]> {
  await connectToDatabase();
  const staleBefore = new Date(now.getTime() - 30_000);
  return ProcessingJob.find({
    $or: [
      { status: "pending", runAt: { $lte: staleBefore } },
      { status: "retry_scheduled", runAt: { $lte: now } },
      { status: "processing", lockedUntil: { $lte: now } },
    ],
  })
    .sort({ runAt: 1 })
    .limit(limit)
    .lean();
}
