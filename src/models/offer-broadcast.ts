import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

/**
 * One record per website offer that was (or is about to be) announced to subscribed customers.
 * The unique `offerKey` guarantees an offer is announced once, however often the check runs.
 *
 * waiting: found, but cannot be sent yet (template missing or not approved); retried each run.
 * sent: messages queued for every subscriber. skipped: nothing to send (e.g. no banner).
 */
export const OFFER_BROADCAST_STATUSES = ["waiting", "sent", "skipped"] as const;
export type OfferBroadcastStatus = (typeof OFFER_BROADCAST_STATUSES)[number];

export interface OfferBroadcastDoc {
  _id: Types.ObjectId;
  offerKey: string;
  title: string;
  percent: number;
  bannerUrl: string | null;
  validUntil: string;
  status: OfferBroadcastStatus;
  /** Why it is waiting or skipped, safe to show admins. */
  note: string | null;
  recipients: number;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const offerBroadcastSchema = new Schema<OfferBroadcastDoc>(
  {
    offerKey: { type: String, required: true, maxlength: 600 },
    title: { type: String, required: true, maxlength: 200 },
    percent: { type: Number, required: true },
    bannerUrl: { type: String, default: null, maxlength: 2000 },
    validUntil: { type: String, required: true },
    status: { type: String, enum: OFFER_BROADCAST_STATUSES, required: true },
    note: { type: String, default: null, maxlength: 300 },
    recipients: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

offerBroadcastSchema.index({ offerKey: 1 }, { unique: true });
offerBroadcastSchema.index({ createdAt: -1 });

export const OfferBroadcast = defineModel<OfferBroadcastDoc>("OfferBroadcast", offerBroadcastSchema);
