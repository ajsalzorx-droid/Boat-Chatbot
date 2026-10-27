import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

export const WEBHOOK_EVENT_KINDS = ["message", "status", "echo", "history", "unsupported"] as const;
export type WebhookEventKind = (typeof WEBHOOK_EVENT_KINDS)[number];

/**
 * received: stored, not yet acted on · queued: a processing job exists · applied: status update
 * written · ignored: intentionally not acted on · unmatched: status for a message we have not
 * stored yet (re-applied by the recovery sweep) · failed: could not be applied.
 */
export const WEBHOOK_EVENT_STATUSES = ["received", "queued", "applied", "ignored", "unmatched", "failed"] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export interface WebhookEventDoc {
  _id: Types.ObjectId;
  /** Unique event identity, e.g. `message:<wamid>` or `status:<wamid>:delivered`. */
  eventKey: string;
  kind: WebhookEventKind;
  field: string;
  phoneNumberId: string | null;
  whatsappMessageId: string | null;
  status: WebhookEventStatus;
  attempts: number;
  /** Safe details for status events only (no message text). */
  statusPayload: {
    status: string;
    occurredAt: Date;
    deliveryErrors: { code: number; title: string; details: string | null }[];
  } | null;
  lastError: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  expireAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new Schema<WebhookEventDoc>(
  {
    eventKey: { type: String, required: true, maxlength: 400 },
    kind: { type: String, enum: WEBHOOK_EVENT_KINDS, required: true },
    field: { type: String, required: true, maxlength: 100 },
    phoneNumberId: { type: String, default: null },
    whatsappMessageId: { type: String, default: null },
    status: { type: String, enum: WEBHOOK_EVENT_STATUSES, required: true },
    attempts: { type: Number, default: 0 },
    statusPayload: {
      type: new Schema(
        {
          status: String,
          occurredAt: Date,
          deliveryErrors: [new Schema({ code: Number, title: String, details: String }, { _id: false })],
        },
        { _id: false },
      ),
      default: null,
    },
    lastError: { type: String, default: null, maxlength: 1000 },
    receivedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
);

webhookEventSchema.index({ eventKey: 1 }, { unique: true });
webhookEventSchema.index({ status: 1, receivedAt: -1 });
webhookEventSchema.index({ receivedAt: -1 });
webhookEventSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const WebhookEvent = defineModel<WebhookEventDoc>("WebhookEvent", webhookEventSchema);
