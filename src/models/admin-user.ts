import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

/**
 * owner: everything, including account management through the CLI ·
 * admin: content, settings, health, simulator · agent: conversations only.
 */
export const ADMIN_ROLES = ["owner", "admin", "agent"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminUserDoc {
  _id: Types.ObjectId;
  /** Lowercased and trimmed. */
  email: string;
  name: string;
  /** scrypt hash in PHC-like format; never leaves the server. */
  passwordHash: string;
  role: AdminRole;
  active: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const adminUserSchema = new Schema<AdminUserDoc>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, required: true, default: "agent" },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

adminUserSchema.index({ email: 1 }, { unique: true });

export const AdminUser = defineModel<AdminUserDoc>("AdminUser", adminUserSchema);
