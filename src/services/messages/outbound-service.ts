import "server-only";

import type { Types } from "mongoose";

import { isDuplicateKeyError } from "@/lib/db/errors";
import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError, isAppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";
import { WhatsAppApiError, WhatsAppClient } from "@/lib/whatsapp/client";
import { describePolicyReason, evaluateOutboundPolicy, type OutboundKind } from "@/lib/whatsapp/policy";
import { Conversation, type ConversationDoc } from "@/models/conversation";
import { Message, type BotSource, type MessageDoc, type MessageSender } from "@/models/message";
import { markHumanActive, recordOutboundOnConversation, previewOf } from "@/services/conversations/conversation-service";
import { getSettings } from "@/services/settings/settings-service";

import { getChannelSender } from "./channel-sender";

/**
 * Outbound delivery with safe retries.
 *
 * Each outbound message is stored as `pending` BEFORE contacting WhatsApp. Delivery claims it by
 * atomically moving it to `sending`, so two workers can never send the same record. Outcomes:
 * - accepted: Meta returned a message ID (stored; status webhooks update it later)
 * - pending again + retryable error: Meta rejected it temporarily (429/5xx); safe to retry
 * - failed: permanent error, recorded with a safe error code
 * - unknown: the request timed out, so it may have been sent; never retried automatically
 */

export class RetryableDeliveryError extends AppError {
  constructor(message: string, cause: unknown) {
    super(message, {
      code: "EXTERNAL_SERVICE_ERROR",
      httpStatus: 503,
      publicMessage: "WhatsApp is temporarily unavailable. Please try again shortly.",
      retryable: true,
      cause,
    });
    this.name = "RetryableDeliveryError";
  }
}

export interface OutboundDraft {
  conversation: ConversationDoc;
  sender: MessageSender;
  text?: string;
  template?: { name: string; languageCode: string };
  agentId?: Types.ObjectId | null;
  botReplyTo?: string | null;
  clientRequestId?: string | null;
  botMeta?: { source: BotSource; intent: string; aiModel: string | null } | null;
}

/** Inserts the pending record, or returns the existing one when this send was already requested. */
export async function createOutboundMessage(draft: OutboundDraft): Promise<{ message: MessageDoc; created: boolean }> {
  await connectToDatabase();
  try {
    const created = await Message.create({
      conversationId: draft.conversation._id,
      channel: draft.conversation.channel,
      direction: "outbound",
      sender: draft.sender,
      agentId: draft.agentId ?? null,
      type: draft.template ? "template" : "text",
      text: draft.text ?? null,
      template: draft.template ?? null,
      botReplyTo: draft.botReplyTo ?? null,
      clientRequestId: draft.clientRequestId ?? null,
      status: "pending",
      botMeta: draft.botMeta ?? null,
    });
    return { message: created.toObject(), created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = draft.botReplyTo
      ? await Message.findOne({ botReplyTo: draft.botReplyTo }).lean()
      : await Message.findOne({ conversationId: draft.conversation._id, clientRequestId: draft.clientRequestId }).lean();
    if (!existing) throw error;
    return { message: existing, created: false };
  }
}

function safeErrorFrom(error: unknown): { code: number | string; title: string; details: string | null } {
  if (error instanceof WhatsAppApiError) {
    return { code: error.graphCode ?? `HTTP_${error.graphHttpStatus}`, title: error.message.slice(0, 300), details: error.fbtraceId ? `fbtrace ${error.fbtraceId}` : null };
  }
  if (isAppError(error)) return { code: error.code, title: error.publicMessage, details: null };
  return { code: "INTERNAL", title: "Unexpected error while sending", details: null };
}

/** Sends a pending outbound message. Throws `RetryableDeliveryError` when a retry is safe. */
export async function deliverOutboundMessage(messageId: Types.ObjectId): Promise<MessageDoc> {
  await connectToDatabase();
  const claimed = await Message.findOneAndUpdate(
    { _id: messageId, direction: "outbound", status: "pending" },
    { $set: { status: "sending" } },
    { returnDocument: "after", lean: true },
  );
  if (!claimed) {
    const current = await Message.findById(messageId).lean();
    if (!current) throw new Error("Outbound message not found");
    return current; // Already delivered, failed, or being sent by another worker.
  }

  const conversation = await Conversation.findById(claimed.conversationId).lean();
  if (!conversation) throw new Error("Conversation missing for outbound message");

  const sender = getChannelSender(conversation.channel);
  const recipient = { waId: conversation.waId, userId: conversation.userId };
  const log = logger.child({ messageId: claimed._id.toString(), channel: conversation.channel });

  try {
    const outcome = claimed.template
      ? await sender.sendTemplate(recipient, claimed.template)
      : await sender.sendText(recipient, claimed.text ?? "", null);

    const now = new Date();
    const update =
      outcome.kind === "sent"
        ? { status: "accepted", whatsappMessageId: outcome.messageId, "statusTimestamps.acceptedAt": now }
        : { status: "simulated", "statusTimestamps.acceptedAt": now };
    const saved = await Message.findOneAndUpdate({ _id: claimed._id }, { $set: update }, { returnDocument: "after", lean: true });
    await recordOutboundOnConversation(conversation._id, previewOf(claimed.text, `Template: ${claimed.template?.name ?? ""}`), now);
    log.info("outbound.accepted", { simulated: outcome.kind === "simulated" });
    return saved ?? claimed;
  } catch (error) {
    if (error instanceof WhatsAppApiError && error.deliveryAmbiguous) {
      await Message.updateOne({ _id: claimed._id }, { $set: { status: "unknown", error: safeErrorFrom(error) } });
      log.warn("outbound.outcome_unknown", { error });
      throw new AppError("Send outcome unknown", {
        code: "EXTERNAL_SERVICE_ERROR",
        httpStatus: 504,
        publicMessage: "WhatsApp did not respond in time. Check the conversation before sending again.",
        retryable: false,
        cause: error,
      });
    }
    if (isAppError(error) && error.retryable) {
      await Message.updateOne({ _id: claimed._id }, { $set: { status: "pending", error: safeErrorFrom(error) } });
      log.warn("outbound.retryable_failure", { error });
      throw new RetryableDeliveryError("Temporary WhatsApp failure", error);
    }
    await Message.updateOne(
      { _id: claimed._id },
      { $set: { status: "failed", error: safeErrorFrom(error), "statusTimestamps.failedAt": new Date() } },
    );
    log.error("outbound.failed", { error });
    throw error;
  }
}

/** Throws a 409 explaining why WhatsApp policy does not allow this message right now. */
export function assertPolicyAllows(conversation: ConversationDoc, kind: OutboundKind, templateStatus?: string | null): void {
  if (conversation.channel === "simulator") return;
  const decision = evaluateOutboundPolicy({
    kind,
    lastInboundAt: conversation.lastInboundAt,
    optedOut: conversation.optedOut,
    ...(templateStatus !== undefined ? { templateStatus } : {}),
  });
  if (!decision.allowed) {
    throw new AppError(`Outbound blocked by policy: ${decision.reason}`, {
      code: "CONFLICT",
      httpStatus: 409,
      publicMessage: describePolicyReason(decision.reason),
      details: { reason: decision.reason },
    });
  }
}

/** Staff reply from the dashboard. Idempotent on `clientRequestId`. */
export async function sendAgentReply(input: {
  conversation: ConversationDoc;
  agentId: Types.ObjectId;
  text: string;
  clientRequestId: string;
}): Promise<MessageDoc> {
  assertPolicyAllows(input.conversation, "freeform");
  const { message, created } = await createOutboundMessage({
    conversation: input.conversation,
    sender: "agent",
    agentId: input.agentId,
    text: input.text,
    clientRequestId: input.clientRequestId,
  });
  if (!created && message.status !== "pending") return message;
  const delivered = await deliverOutboundMessage(message._id);
  const { humanFirst } = await getSettings();
  if (humanFirst.enabled) await markHumanActive(input.conversation._id, humanFirst.pauseMinutes);
  return delivered;
}

const templateCache = new Map<string, { status: string | null; at: number }>();
const TEMPLATE_CACHE_MS = 10 * 60 * 1000;

/** Looks up the template's approval status with Meta (cached briefly). */
async function templateStatus(name: string, languageCode: string): Promise<string | null> {
  const key = `${name}:${languageCode}`;
  const cached = templateCache.get(key);
  if (cached && Date.now() - cached.at < TEMPLATE_CACHE_MS) return cached.status;
  const template = await new WhatsAppClient().getTemplate(name, languageCode);
  const status = template?.status ?? null;
  templateCache.set(key, { status, at: Date.now() });
  return status;
}

/** Re-engagement template outside the 24-hour window, validated against Meta first. */
export async function sendReengagementTemplate(input: {
  conversation: ConversationDoc;
  agentId: Types.ObjectId;
  clientRequestId: string;
}): Promise<MessageDoc> {
  const settings = await getSettings();
  const template = settings.messaging.reengagementTemplate;
  if (!template) {
    throw new AppError("No re-engagement template configured", {
      code: "CONFLICT",
      httpStatus: 409,
      publicMessage: describePolicyReason("template_not_configured"),
      details: { reason: "template_not_configured" },
    });
  }
  const status = input.conversation.channel === "simulator" ? "APPROVED" : await templateStatus(template.name, template.languageCode);
  assertPolicyAllows(input.conversation, "template", status);

  const { message, created } = await createOutboundMessage({
    conversation: input.conversation,
    sender: "agent",
    agentId: input.agentId,
    template: { name: template.name, languageCode: template.languageCode },
    clientRequestId: input.clientRequestId,
  });
  if (!created && message.status !== "pending") return message;
  return deliverOutboundMessage(message._id);
}

/**
 * Controlled recovery of one outbound message. `failed` messages were rejected by WhatsApp and
 * are safe to resend. `unknown` messages may already have been delivered, so they are only
 * resent when an administrator explicitly accepts the risk of a duplicate.
 */
export async function retryOutboundMessage(id: Types.ObjectId, options: { acceptDuplicateRisk: boolean }): Promise<MessageDoc> {
  await connectToDatabase();
  const message = await Message.findById(id).lean();
  if (!message || message.direction !== "outbound") {
    throw new AppError("Message not found", { code: "NOT_FOUND", httpStatus: 404, publicMessage: "Message not found." });
  }
  const retryable = message.status === "failed" || (message.status === "unknown" && options.acceptDuplicateRisk);
  if (!retryable) {
    throw new AppError("Message not retryable", {
      code: "CONFLICT",
      httpStatus: 409,
      publicMessage:
        message.status === "unknown"
          ? "This message may already have been delivered. Confirm the duplicate risk to resend it."
          : "Only failed messages can be resent.",
    });
  }
  const conversation = await Conversation.findById(message.conversationId).lean();
  if (!conversation) throw new AppError("Conversation not found", { code: "NOT_FOUND", httpStatus: 404, publicMessage: "Conversation not found." });
  assertPolicyAllows(conversation, message.type === "template" ? "template" : "freeform", message.type === "template" ? "APPROVED" : undefined);

  await Message.updateOne({ _id: id, status: message.status }, { $set: { status: "pending", error: null } });
  return deliverOutboundMessage(id);
}
