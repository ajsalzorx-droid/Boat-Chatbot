import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

export interface AdminSessionDoc {
  _id: Types.ObjectId;
  /** HMAC of the cookie token; the token itself is never stored. */
  tokenHash: string;
  userId: Types.ObjectId;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date;
  userAgent: string;
  createdAt: Date;
  updatedAt: Date;
}

const adminSessionSchema = new Schema<AdminSessionDoc>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, required: true },
    userAgent: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true },
);

adminSessionSchema.index({ tokenHash: 1 }, { unique: true });
adminSessionSchema.index({ userId: 1 });
// MongoDB deletes expired sessions automatically.
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminSession = defineModel<AdminSessionDoc>("AdminSession", adminSessionSchema);
