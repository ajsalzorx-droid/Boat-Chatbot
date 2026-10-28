import { Schema, type Types } from "mongoose";

import { defineModel } from "./define-model";

export const CHANNELS = ["whatsapp", "simulator"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * new: first contact, nobody has handled it yet · open: being handled by the bot or staff ·
 * needs_human: the bot handed over and is paused · resolved: closed by staff.
 */
export const CONVERSATION_STATUSES = ["new", "open", "needs_human", "resolved"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export interface ConversationDoc {
  _id: Types.ObjectId;
  channel: Channel;
  /** Stable identity within the channel: the WhatsApp ID, or `user:<business-scoped user ID>`. */
  customerKey: string;
  waId: string | null;
  userId: string | null;
  displayName: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageAt: Date | null;
  /** Server-side record of the customer's latest message; drives the customer service window. */
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  status: ConversationStatus;
  assignedAgentId: Types.ObjectId | null;
  botEnabled: boolean;
  handoffRequestedAt: Date | null;
  /** Staff replied recently (dashboard or WhatsApp Business app): the bot stays quiet until then. */
  humanActiveUntil: Date | null;
  optedOut: boolean;
  optedOutAt: Date | null;
  optedInAt: Date | null;
  /** The customer asked for offer alerts (marketing templates); STOP or OFFERS OFF clears it. */
  offersOptIn: boolean;
  offersOptInAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationDoc>(
  {
    channel: { type: String, enum: CHANNELS, required: true },
    customerKey: { type: String, required: true, maxlength: 200 },
    waId: { type: String, default: null, maxlength: 32 },
    userId: { type: String, default: null, maxlength: 128 },
    displayName: { type: String, default: null, trim: true, maxlength: 200 },
    lastMessagePreview: { type: String, default: "", maxlength: 200 },
    lastMessageDirection: { type: String, enum: ["inbound", "outbound", null], default: null },
    lastMessageAt: { type: Date, default: null },
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },
    status: { type: String, enum: CONVERSATION_STATUSES, default: "new" },
    assignedAgentId: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    botEnabled: { type: Boolean, default: true },
    handoffRequestedAt: { type: Date, default: null },
    humanActiveUntil: { type: Date, default: null },
    optedOut: { type: Boolean, default: false },
    optedOutAt: { type: Date, default: null },
    optedInAt: { type: Date, default: null },
    offersOptIn: { type: Boolean, default: false },
    offersOptInAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationSchema.index({ channel: 1, customerKey: 1 }, { unique: true });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ status: 1, lastMessageAt: -1 });
conversationSchema.index({ assignedAgentId: 1, lastMessageAt: -1 });

export const Conversation = defineModel<ConversationDoc>("Conversation", conversationSchema);
