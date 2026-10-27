/**
 * Normalised WhatsApp webhook events.
 *
 * Meta's raw payload is parsed once (see `webhook-parser.ts`) into these shapes, so the rest of
 * the application never touches raw webhook JSON.
 */

/**
 * How a customer is identified. Meta is introducing usernames, so a customer may arrive with a
 * business-scoped user ID (`userId`) as well as, or instead of, a phone-based WhatsApp ID (`waId`).
 * At least one of the two is always present.
 */
export interface CustomerRef {
  waId: string | null;
  userId: string | null;
  profileName: string | null;
}

export type InboundContent =
  | { type: "text"; body: string }
  /** Any message type the bot does not handle yet (image, audio, location, reaction, …). */
  | { type: "unsupported"; originalType: string };

export interface InboundMessageEvent {
  kind: "message";
  /** The business phone number that received the message. */
  phoneNumberId: string;
  /** WhatsApp message ID (`wamid…`): the idempotency key for inbound messages. */
  messageId: string;
  customer: CustomerRef;
  /** When the customer sent it, from Meta's timestamp. */
  sentAt: Date;
  content: InboundContent;
  /** Set when the customer replied to a specific earlier message. */
  replyToMessageId: string | null;
}

export const DELIVERY_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface DeliveryError {
  code: number;
  title: string;
  details: string | null;
}

export interface StatusEvent {
  kind: "status";
  phoneNumberId: string;
  /** The outbound message this status refers to. */
  messageId: string;
  status: DeliveryStatus;
  occurredAt: Date;
  recipient: { waId: string | null; userId: string | null };
  errors: DeliveryError[];
}

/**
 * Coexistence: a message the business sent from the WhatsApp Business app (or a linked device) on
 * the same number the bot uses (`smb_message_echoes`). Bot replies sent through the API are not echoed.
 */
export interface BusinessEchoEvent {
  kind: "echo";
  phoneNumberId: string;
  messageId: string;
  /** The customer the business wrote to. */
  customer: { waId: string | null; userId: string | null };
  sentAt: Date;
  content: InboundContent;
}

/**
 * Coexistence: one past message from the WhatsApp Business app's chat history (`history`),
 * shared once after onboarding. Imported for the dashboard only; never answered by the bot.
 */
export interface HistoryMessageEvent {
  kind: "history";
  phoneNumberId: string;
  messageId: string;
  customer: { waId: string };
  fromBusiness: boolean;
  sentAt: Date;
  content: InboundContent;
  /** Delivery state of a business message at sync time, when Meta provides one. */
  deliveryStatus: DeliveryStatus | null;
}

/** A change Meta sent that the platform records but does not act on. */
export interface UnsupportedEvent {
  kind: "unsupported";
  field: string;
  reason: string;
}

export type WhatsAppEvent = InboundMessageEvent | StatusEvent | BusinessEchoEvent | HistoryMessageEvent | UnsupportedEvent;
