import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

/** inbound_message: decide and send the bot reply. outbound_message: deliver a queued outbound message (offer alerts). */
export const JOB_TYPES = ["inbound_message", "outbound_message"] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * pending → processing → done; on a transient failure → retry_scheduled → processing …;
 * after the final attempt → dead (dead-letter, needs review). failed = permanent error, not
 * retried. Admins can requeue dead and failed jobs from the System Health page.
 */
export const JOB_STATUSES = ["pending", "processing", "retry_scheduled", "done", "failed", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ProcessingJobDoc {
  _id: Types.ObjectId;
  type: JobType;
  /** e.g. `inbound:<wamid>`; unique so a webhook retry can never create a second job. */
  idempotencyKey: string;
  /** References only; no customer content is copied into jobs. */
  payload: { messageId: Types.ObjectId; conversationId: Types.ObjectId };
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedUntil: Date | null;
  lastError: { code: string; message: string; retryable: boolean } | null;
  completedAt: Date | null;
  /** Set when the job finishes; a TTL index removes it later. */
  expireAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const processingJobSchema = new Schema<ProcessingJobDoc>(
  {
    type: { type: String, enum: JOB_TYPES, required: true },
    idempotencyKey: { type: String, required: true, maxlength: 400 },
    payload: {
      messageId: { type: Schema.Types.ObjectId, required: true },
      conversationId: { type: Schema.Types.ObjectId, required: true },
    },
    status: { type: String, enum: JOB_STATUSES, required: true, default: "pending" },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 6 },
    runAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    lastError: {
      type: new Schema(
        {
          code: { type: String, maxlength: 100 },
          message: { type: String, maxlength: 1000 },
          retryable: Boolean,
        },
        { _id: false },
      ),
      default: null,
    },
    completedAt: { type: Date, default: null },
    expireAt: { type: Date, default: null },
  },
  { timestamps: true },
);

processingJobSchema.index({ idempotencyKey: 1 }, { unique: true });
processingJobSchema.index({ status: 1, runAt: 1 });
processingJobSchema.index({ status: 1, updatedAt: -1 });
processingJobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const ProcessingJob = defineModel<ProcessingJobDoc>("ProcessingJob", processingJobSchema);
