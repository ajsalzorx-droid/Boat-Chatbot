import { Schema } from "mongoose";

import { defineModel } from "./define-model";

export interface SyncRequest {
  requestedAt: Date | null;
  requestId: string | null;
  /** Safe error summary when the request failed (never a token). */
  error: string | null;
}

/**
 * The latest WhatsApp Business app number connected through Embedded Signup (coexistence).
 * A single document; the IDs still have to be copied into the environment to take effect.
 */
export interface WhatsAppConnectionDoc {
  key: "default";
  businessAccountId: string;
  phoneNumberId: string;
  connectedAt: Date;
  subscribed: boolean;
  contactsSync: SyncRequest;
  historySync: SyncRequest;
  createdAt: Date;
  updatedAt: Date;
}

const syncRequest = new Schema<SyncRequest>(
  {
    requestedAt: { type: Date, default: null },
    requestId: { type: String, default: null, maxlength: 200 },
    error: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

const whatsAppConnectionSchema = new Schema<WhatsAppConnectionDoc>(
  {
    key: { type: String, required: true, enum: ["default"], default: "default" },
    businessAccountId: { type: String, required: true, match: /^\d{5,20}$/ },
    phoneNumberId: { type: String, required: true, match: /^\d{5,20}$/ },
    connectedAt: { type: Date, required: true },
    subscribed: { type: Boolean, default: false },
    contactsSync: { type: syncRequest, default: () => ({}) },
    historySync: { type: syncRequest, default: () => ({}) },
  },
  { timestamps: true },
);

whatsAppConnectionSchema.index({ key: 1 }, { unique: true });

export const WhatsAppConnection = defineModel<WhatsAppConnectionDoc>("WhatsAppConnection", whatsAppConnectionSchema);
