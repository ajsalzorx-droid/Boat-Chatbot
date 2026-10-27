import { Schema } from "mongoose";

import { defineModel } from "./define-model";

export interface RateLimitDoc {
  /** e.g. `login:ip:<hash>` + window start. */
  key: string;
  count: number;
  expireAt: Date;
}

const rateLimitSchema = new Schema<RateLimitDoc>({
  key: { type: String, required: true, maxlength: 300 },
  count: { type: Number, required: true, default: 0 },
  expireAt: { type: Date, required: true },
});

rateLimitSchema.index({ key: 1 }, { unique: true });
rateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = defineModel<RateLimitDoc>("RateLimit", rateLimitSchema);
