import "server-only";

import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { Conversation, type Channel, type ConversationDoc, type ConversationStatus } from "@/models/conversation";
import { Message } from "@/models/message";
import { ProcessingJob } from "@/models/processing-job";
import type { CustomerRef } from "@/lib/whatsapp/types";

export function customerKeyFor(customer: Pick<CustomerRef, "waId" | "userId">): string {
  if (customer.waId) return customer.waId;
  if (customer.userId) return `user:${customer.userId}`;
  throw new Error("Customer has neither waId nor userId");
}

export function previewOf(text: string | null, fallback: string): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return (value || fallback).slice(0, 120);
}

/**
 * Finds or creates the conversation for an inbound message in one atomic upsert, so concurrent
 * webhooks for the same customer always land in the same conversation.
 */
export async function upsertConversationForInbound(input: {
  channel: Channel;
  customer: CustomerRef;
  receivedAt: Date;
  preview: string;
}): Promise<ConversationDoc> {
  await connectToDatabase();
  const customerKey = customerKeyFor(input.customer);
  const conversation = await Conversation.findOneAndUpdate(
    { channel: input.channel, customerKey },
    [
      {
        $set: {
          channel: input.channel,
          customerKey,
          waId: input.customer.waId ?? { $ifNull: ["$waId", null] },
          userId: input.customer.userId ?? { $ifNull: ["$userId", null] },
          displayName: input.customer.profileName ?? { $ifNull: ["$displayName", null] },
          lastMessagePreview: input.preview,
          lastMessageDirection: "inbound",
          // $max keeps the newest timestamps even when webhooks arrive out of order.
          lastMessageAt: { $max: ["$lastMessageAt", input.receivedAt] },
          lastInboundAt: { $max: ["$lastInboundAt", input.receivedAt] },
          status: { $cond: [{ $eq: ["$status", "resolved"] }, "open", { $ifNull: ["$status", "new"] }] },
          botEnabled: { $ifNull: ["$botEnabled", true] },
          optedOut: { $ifNull: ["$optedOut", false] },
          assignedAgentId: { $ifNull: ["$assignedAgentId", null] },
          handoffRequestedAt: { $ifNull: ["$handoffRequestedAt", null] },
          humanActiveUntil: { $ifNull: ["$humanActiveUntil", null] },
          lastOutboundAt: { $ifNull: ["$lastOutboundAt", null] },
          optedOutAt: { $ifNull: ["$optedOutAt", null] },
          optedInAt: { $ifNull: ["$optedInAt", null] },
          createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
          updatedAt: "$$NOW",
        },
      },
    ],
    { upsert: true, returnDocument: "after", lean: true, updatePipeline: true },
  );
  if (!conversation) throw new Error("Conversation upsert returned nothing");
  return conversation;
}

/** Defaults for a conversation first created by a business-side message (echo or history). */
function newConversationFields(at: Date) {
  return {
    status: { $ifNull: ["$status", "open"] },
    botEnabled: { $ifNull: ["$botEnabled", true] },
    optedOut: { $ifNull: ["$optedOut", false] },
    assignedAgentId: { $ifNull: ["$assignedAgentId", null] },
    handoffRequestedAt: { $ifNull: ["$handoffRequestedAt", null] },
    humanActiveUntil: { $ifNull: ["$humanActiveUntil", null] },
    displayName: { $ifNull: ["$displayName", null] },
    lastInboundAt: { $ifNull: ["$lastInboundAt", null] },
    lastOutboundAt: { $ifNull: ["$lastOutboundAt", null] },
    lastMessageAt: { $ifNull: ["$lastMessageAt", at] },
    lastMessagePreview: { $ifNull: ["$lastMessagePreview", ""] },
    lastMessageDirection: { $ifNull: ["$lastMessageDirection", null] },
    optedOutAt: { $ifNull: ["$optedOutAt", null] },
    optedInAt: { $ifNull: ["$optedInAt", null] },
    createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
  };
}

/**
 * Coexistence: staff wrote to a customer from the WhatsApp Business app. Creates the conversation
 * if the business started it, and records the message as the latest outbound one.
 */
export async function upsertConversationForBusinessMessage(input: {
  customer: Pick<CustomerRef, "waId" | "userId">;
  sentAt: Date;
  preview: string;
}): Promise<ConversationDoc> {
  await connectToDatabase();
  const customerKey = customerKeyFor(input.customer);
  const conversation = await Conversation.findOneAndUpdate(
    { channel: "whatsapp", customerKey },
    [
      { $set: { channel: "whatsapp", customerKey, waId: input.customer.waId ?? { $ifNull: ["$waId", null] }, userId: input.customer.userId ?? { $ifNull: ["$userId", null] }, ...newConversationFields(input.sentAt) } },
      {
        $set: {
          lastMessagePreview: input.preview,
          lastMessageDirection: "outbound",
          lastMessageAt: { $max: ["$lastMessageAt", input.sentAt] },
          lastOutboundAt: { $max: ["$lastOutboundAt", input.sentAt] },
          status: { $cond: [{ $eq: ["$status", "new"] }, "open", "$status"] },
          updatedAt: "$$NOW",
        },
      },
    ],
    { upsert: true, returnDocument: "after", lean: true, updatePipeline: true },
  );
  if (!conversation) throw new Error("Conversation upsert returned nothing");
  return conversation;
}

/**
 * Coexistence: a message from the imported chat history. It never touches lastInboundAt, so past
 * messages cannot reopen the customer service window, and only updates the preview when it is
 * newer than what the conversation already shows.
 */
export async function upsertConversationForHistory(input: {
  waId: string;
  sentAt: Date;
  preview: string;
  direction: "inbound" | "outbound";
}): Promise<ConversationDoc> {
  await connectToDatabase();
  const newer = { $gte: [input.sentAt, "$lastMessageAt"] };
  const conversation = await Conversation.findOneAndUpdate(
    { channel: "whatsapp", customerKey: input.waId },
    [
      { $set: { channel: "whatsapp", customerKey: input.waId, waId: input.waId, userId: { $ifNull: ["$userId", null] }, ...newConversationFields(input.sentAt) } },
      {
        $set: {
          lastMessagePreview: { $cond: [newer, input.preview, "$lastMessagePreview"] },
          lastMessageDirection: { $cond: [newer, input.direction, "$lastMessageDirection"] },
          lastMessageAt: { $max: ["$lastMessageAt", input.sentAt] },
          updatedAt: "$$NOW",
        },
      },
    ],
    { upsert: true, returnDocument: "after", lean: true, updatePipeline: true },
  );
  if (!conversation) throw new Error("Conversation upsert returned nothing");
  return conversation;
}

/** Staff replied: keep the bot quiet for this customer for a while (staff-first mode). */
export async function markHumanActive(id: Types.ObjectId, minutes: number, now: Date = new Date()): Promise<void> {
  if (minutes <= 0) return;
  const until = new Date(now.getTime() + minutes * 60_000);
  await Conversation.updateOne({ _id: id }, [{ $set: { humanActiveUntil: { $max: [{ $ifNull: ["$humanActiveUntil", until] }, until] } } }], { updatePipeline: true });
}

export async function recordOutboundOnConversation(conversationId: Types.ObjectId, preview: string, at: Date): Promise<void> {
  await Conversation.updateOne(
    { _id: conversationId },
    [
      {
        $set: {
          lastMessagePreview: preview,
          lastMessageDirection: "outbound",
          lastMessageAt: { $max: ["$lastMessageAt", at] },
          lastOutboundAt: { $max: ["$lastOutboundAt", at] },
          status: { $cond: [{ $eq: ["$status", "new"] }, "open", "$status"] },
          updatedAt: "$$NOW",
        },
      },
    ],
    { updatePipeline: true },
  );
}

export async function getConversation(id: Types.ObjectId): Promise<ConversationDoc> {
  await connectToDatabase();
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw new AppError("Conversation not found", { code: "NOT_FOUND", httpStatus: 404, publicMessage: "Conversation not found." });
  }
  return conversation;
}

export interface ConversationFilter {
  search?: string | undefined;
  status?: ConversationStatus | "unanswered" | undefined;
  channel?: Channel | undefined;
  assignedTo?: Types.ObjectId | "me" | "unassigned" | undefined;
  currentUserId?: Types.ObjectId | undefined;
  page: number;
  pageSize: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listConversations(filter: ConversationFilter): Promise<{ items: ConversationDoc[]; total: number }> {
  await connectToDatabase();
  const query: Record<string, unknown> = {};

  if (filter.channel) query.channel = filter.channel;
  if (filter.status === "unanswered") {
    query.status = { $ne: "resolved" };
    query.$expr = { $gt: ["$lastInboundAt", { $ifNull: ["$lastOutboundAt", new Date(0)] }] };
  } else if (filter.status) {
    query.status = filter.status;
  }

  if (filter.assignedTo === "me" && filter.currentUserId) query.assignedAgentId = filter.currentUserId;
  else if (filter.assignedTo === "unassigned") query.assignedAgentId = null;
  else if (filter.assignedTo instanceof Types.ObjectId) query.assignedAgentId = filter.assignedTo;

  const search = filter.search?.trim();
  if (search) {
    const pattern = new RegExp(escapeRegex(search.slice(0, 50)), "i");
    query.$or = [{ displayName: pattern }, { waId: pattern }, { lastMessagePreview: pattern }];
  }

  const [items, total] = await Promise.all([
    Conversation.find(query)
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip((filter.page - 1) * filter.pageSize)
      .limit(filter.pageSize)
      .lean(),
    Conversation.countDocuments(query),
  ]);
  return { items, total };
}

export interface ConversationUpdate {
  status?: ConversationStatus | undefined;
  botEnabled?: boolean | undefined;
  assignedAgentId?: Types.ObjectId | null | undefined;
}

export async function updateConversation(id: Types.ObjectId, update: ConversationUpdate): Promise<ConversationDoc> {
  await connectToDatabase();
  const set: Record<string, unknown> = {};
  if (update.status !== undefined) {
    set.status = update.status;
    if (update.status === "needs_human") {
      set.handoffRequestedAt = new Date();
      set.botEnabled = false;
    }
    // A resolved chat starts fresh: the bot answers the customer's next message again.
    if (update.status === "resolved") {
      set.handoffRequestedAt = null;
      set.botEnabled = true;
    }
  }
  if (update.botEnabled !== undefined) {
    set.botEnabled = update.botEnabled;
    if (update.botEnabled) set.handoffRequestedAt = null;
  }
  if (update.assignedAgentId !== undefined) set.assignedAgentId = update.assignedAgentId;

  const updated = await Conversation.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after", runValidators: true, lean: true });
  if (!updated) throw new AppError("Conversation not found", { code: "NOT_FOUND", httpStatus: 404, publicMessage: "Conversation not found." });
  return updated;
}

export async function requestHandoff(id: Types.ObjectId): Promise<void> {
  await Conversation.updateOne(
    { _id: id },
    { $set: { status: "needs_human", botEnabled: false, handoffRequestedAt: new Date() } },
  );
}

export async function setOptOut(id: Types.ObjectId, optedOut: boolean): Promise<void> {
  await Conversation.updateOne(
    { _id: id },
    { $set: optedOut ? { optedOut: true, optedOutAt: new Date() } : { optedOut: false, optedInAt: new Date() } },
  );
}

/**
 * Permanently erases a customer's conversation, messages and related jobs (data-subject
 * deletion request). Irreversible.
 */
export async function eraseConversation(id: Types.ObjectId): Promise<{ messagesDeleted: number }> {
  await connectToDatabase();
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) throw new AppError("Conversation not found", { code: "NOT_FOUND", httpStatus: 404, publicMessage: "Conversation not found." });
  const messages = await Message.deleteMany({ conversationId: id });
  await ProcessingJob.deleteMany({ "payload.conversationId": id });
  await Conversation.deleteOne({ _id: id });
  return { messagesDeleted: messages.deletedCount };
}
