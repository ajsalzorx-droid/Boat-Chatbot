import { Schema, type Types } from "mongoose";

import { CHANNELS, type Channel } from "./conversation";
import { defineModel } from "./define-model";

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_TYPES = ["text", "template", "unsupported"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** `business_app`: sent by staff from the WhatsApp Business app on the same number (coexistence). */
export const MESSAGE_SENDERS = ["customer", "bot", "agent", "system", "business_app"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

/**
 * Outbound lifecycle: pending → sending → accepted (Meta returned a message ID) → sent →
 * delivered → read, or failed. `unknown` = the send may have happened but the outcome was lost;
 * it is never retried automatically, to avoid duplicate messages. `simulated` = simulator only,
 * never sent to WhatsApp. Inbound messages are `received`.
 */
export const MESSAGE_STATUSES = [
  "received",
  "pending",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "unknown",
  "simulated",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const BOT_SOURCES = ["faq", "product", "rules", "ai", "fallback", "policy"] as const;
export type BotSource = (typeof BOT_SOURCES)[number];

export interface MessageError {
  code: number | string;
  title: string;
  details: string | null;
}

export interface MessageDoc {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  channel: Channel;
  direction: MessageDirection;
  sender: MessageSender;
  agentId: Types.ObjectId | null;
  type: MessageType;
  text: string | null;
  template: { name: string; languageCode: string } | null;
  /** Inbound types the bot does not handle (image, audio, …). */
  originalType: string | null;
  whatsappMessageId: string | null;
  /** For bot replies: the inbound WhatsApp message being answered. Unique → one reply per message. */
  botReplyTo: string | null;
  /** Client-generated key for agent replies, so a double-click cannot send twice. */
  clientRequestId: string | null;
  status: MessageStatus;
  error: MessageError | null;
  statusTimestamps: {
    acceptedAt: Date | null;
    sentAt: Date | null;
    deliveredAt: Date | null;
    readAt: Date | null;
    failedAt: Date | null;
  };
  /** Inbound: when the customer sent it (Meta timestamp, clamped to server time). */
  customerSentAt: Date | null;
  botMeta: { source: BotSource; intent: string; aiModel: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<MessageDoc>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    channel: { type: String, enum: CHANNELS, required: true },
    direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },
    sender: { type: String, enum: MESSAGE_SENDERS, required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    text: { type: String, default: null, maxlength: 4096 },
    template: {
      type: new Schema({ name: String, languageCode: String }, { _id: false }),
      default: null,
    },
    originalType: { type: String, default: null, maxlength: 50 },
    whatsappMessageId: { type: String, default: null, maxlength: 256 },
    botReplyTo: { type: String, default: null, maxlength: 256 },
    clientRequestId: { type: String, default: null, maxlength: 64 },
    status: { type: String, enum: MESSAGE_STATUSES, required: true },
    error: {
      type: new Schema(
        {
          code: { type: Schema.Types.Mixed },
          title: { type: String, maxlength: 300 },
          details: { type: String, default: null, maxlength: 1000 },
        },
        { _id: false },
      ),
      default: null,
    },
    statusTimestamps: {
      acceptedAt: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      readAt: { type: Date, default: null },
      failedAt: { type: Date, default: null },
    },
    customerSentAt: { type: Date, default: null },
    botMeta: {
      type: new Schema(
        {
          source: { type: String, enum: BOT_SOURCES },
          intent: { type: String, maxlength: 50 },
          aiModel: { type: String, default: null, maxlength: 100 },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

// Idempotency: the same WhatsApp message can never be stored twice, and a given inbound message
// can have at most one bot reply, however many times the webhook or a job is retried.
messageSchema.index(
  { whatsappMessageId: 1 },
  { unique: true, partialFilterExpression: { whatsappMessageId: { $type: "string" } } },
);
messageSchema.index(
  { botReplyTo: 1 },
  { unique: true, partialFilterExpression: { botReplyTo: { $type: "string" } } },
);
messageSchema.index(
  { conversationId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: "string" } } },
);
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ direction: 1, status: 1, createdAt: -1 });
messageSchema.index({ createdAt: 1 });

export const Message = defineModel<MessageDoc>("Message", messageSchema);
