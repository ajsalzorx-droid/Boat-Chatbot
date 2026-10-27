import "server-only";

import { randomUUID } from "node:crypto";

import type { Types } from "mongoose";

import { isDuplicateKeyError } from "@/lib/db/errors";
import { connectToDatabase } from "@/lib/db/mongoose";
import { logger } from "@/lib/logging/logger";
import { maskPhoneNumber } from "@/lib/logging/redact";
import { trustedInboundTime } from "@/lib/whatsapp/policy";
import type { BusinessEchoEvent, HistoryMessageEvent, InboundContent, InboundMessageEvent, StatusEvent, WhatsAppEvent } from "@/lib/whatsapp/types";
import type { Channel } from "@/models/conversation";
import { expiresInDays, OPERATIONAL_RECORD_TTL_DAYS } from "@/models/define-model";
import { Message, type MessageDoc } from "@/models/message";
import { WebhookEvent, type WebhookEventKind, type WebhookEventStatus } from "@/models/webhook-event";
import {
  markHumanActive,
  previewOf,
  upsertConversationForBusinessMessage,
  upsertConversationForHistory,
  upsertConversationForInbound,
} from "@/services/conversations/conversation-service";
import { createJob } from "@/services/jobs/job-service";
import { applyStatusEvent } from "@/services/messages/status-service";
import { getSettings } from "@/services/settings/settings-service";

/**
 * Durable acceptance of webhook events. Everything here is idempotent, so Meta redelivering the
 * same webhook (which it does on timeouts and errors) can never create a second message, job or
 * reply. The webhook is only acknowledged after this completes.
 */

export interface IngestResult {
  /** New jobs to dispatch; `runAt` is later than now when staff-first mode delays the bot. */
  jobs: { id: Types.ObjectId; runAt: Date }[];
  inbound: number;
  statuses: number;
  echoes: number;
  history: number;
  ignored: number;
}

async function recordEvent(input: {
  eventKey: string;
  kind: WebhookEventKind;
  field: string;
  phoneNumberId: string | null;
  whatsappMessageId: string | null;
  status: WebhookEventStatus;
  statusPayload?: StatusEvent | null;
  lastError?: string | null;
}): Promise<void> {
  const now = new Date();
  await WebhookEvent.updateOne(
    { eventKey: input.eventKey },
    {
      $setOnInsert: {
        eventKey: input.eventKey,
        kind: input.kind,
        field: input.field,
        phoneNumberId: input.phoneNumberId,
        whatsappMessageId: input.whatsappMessageId,
        receivedAt: now,
        expireAt: expiresInDays(OPERATIONAL_RECORD_TTL_DAYS, now),
        statusPayload: input.statusPayload
          ? { status: input.statusPayload.status, occurredAt: input.statusPayload.occurredAt, deliveryErrors: input.statusPayload.errors }
          : null,
      },
      $set: { status: input.status, lastError: input.lastError ?? null, processedAt: now },
      $inc: { attempts: 1 },
    },
    { upsert: true },
  );
}

function textOf(content: InboundContent): string | null {
  return content.type === "text" ? content.body.slice(0, 4096) : null;
}

function previewFor(content: InboundContent): string {
  return previewOf(textOf(content), `[${content.type === "unsupported" ? content.originalType : "message"}]`);
}

/** Stores a message staff sent from the WhatsApp Business app. Returns false for a redelivery. */
async function storeBusinessEcho(event: BusinessEchoEvent, receivedAt: Date, pauseMinutes: number): Promise<boolean> {
  const sentAt = trustedInboundTime(event.sentAt, receivedAt);
  const conversation = await upsertConversationForBusinessMessage({ customer: event.customer, sentAt, preview: previewFor(event.content) });
  try {
    await Message.create({
      conversationId: conversation._id,
      channel: "whatsapp",
      direction: "outbound",
      sender: "business_app",
      type: event.content.type,
      text: textOf(event.content),
      originalType: event.content.type === "unsupported" ? event.content.originalType : null,
      whatsappMessageId: event.messageId,
      status: "sent",
      statusTimestamps: { sentAt },
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return false;
  }
  await markHumanActive(conversation._id, pauseMinutes, receivedAt);
  return true;
}

/** True when a bulk insert failed only because some documents already existed. */
function onlyDuplicates(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("writeErrors" in error)) return false;
  const writeErrors = (error as { writeErrors?: unknown }).writeErrors;
  return Array.isArray(writeErrors) && writeErrors.every((item) => isDuplicateKeyError(item) || isDuplicateKeyError((item as { err?: unknown }).err));
}

/**
 * Imports one customer's past messages from the shared chat history. One conversation update per
 * customer and one bulk insert keep large histories fast; already-imported messages are skipped.
 */
async function storeHistoryThread(waId: string, events: HistoryMessageEvent[], receivedAt: Date): Promise<void> {
  const ordered = [...events].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const latest = ordered[ordered.length - 1];
  if (!latest) return;
  const conversation = await upsertConversationForHistory({
    waId,
    sentAt: trustedInboundTime(latest.sentAt, receivedAt),
    preview: previewFor(latest.content),
    direction: latest.fromBusiness ? "outbound" : "inbound",
  });

  const docs = ordered.map((event) => {
    const sentAt = trustedInboundTime(event.sentAt, receivedAt);
    return {
      conversationId: conversation._id,
      channel: "whatsapp",
      direction: event.fromBusiness ? "outbound" : "inbound",
      sender: event.fromBusiness ? "business_app" : "customer",
      type: event.content.type,
      text: textOf(event.content),
      originalType: event.content.type === "unsupported" ? event.content.originalType : null,
      whatsappMessageId: event.messageId,
      status: event.fromBusiness ? (event.deliveryStatus ?? "sent") : "received",
      customerSentAt: event.fromBusiness ? null : sentAt,
      // Keep the original time so imported messages sort correctly in the conversation.
      createdAt: sentAt,
      updatedAt: sentAt,
    };
  });
  try {
    await Message.insertMany(docs, { ordered: false });
  } catch (error) {
    if (!onlyDuplicates(error)) throw error;
  }
}

async function storeInboundMessage(event: InboundMessageEvent, channel: Channel, receivedAt: Date): Promise<{ message: MessageDoc; conversationId: Types.ObjectId }> {
  const customerSentAt = trustedInboundTime(event.sentAt, receivedAt);
  const text = textOf(event.content);
  const preview = previewFor(event.content);

  const conversation = await upsertConversationForInbound({ channel, customer: event.customer, receivedAt: customerSentAt, preview });

  try {
    const created = await Message.create({
      conversationId: conversation._id,
      channel,
      direction: "inbound",
      sender: "customer",
      type: event.content.type,
      text,
      originalType: event.content.type === "unsupported" ? event.content.originalType : null,
      whatsappMessageId: event.messageId,
      status: "received",
      customerSentAt,
    });
    return { message: created.toObject(), conversationId: conversation._id };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await Message.findOne({ whatsappMessageId: event.messageId }).lean();
    if (!existing) throw error;
    return { message: existing, conversationId: existing.conversationId };
  }
}

export async function ingestEvents(
  events: readonly WhatsAppEvent[],
  options: { channel: Channel; expectedPhoneNumberId: string | null; receivedAt?: Date },
): Promise<IngestResult> {
  await connectToDatabase();
  const receivedAt = options.receivedAt ?? new Date();
  const result: IngestResult = { jobs: [], inbound: 0, statuses: 0, echoes: 0, history: 0, ignored: 0 };

  // Staff-first mode applies to real WhatsApp only; the simulator always answers at once.
  const needsSettings = options.channel === "whatsapp" && events.some((event) => event.kind === "message" || event.kind === "echo");
  const humanFirst = needsSettings ? (await getSettings()).humanFirst : null;
  const staffFirst = humanFirst?.enabled ? humanFirst : null;
  const historyByCustomer = new Map<string, HistoryMessageEvent[]>();

  for (const event of events) {
    if (event.kind === "unsupported") {
      result.ignored += 1;
      await recordEvent({
        eventKey: `unsupported:${event.field}:${randomUUID()}`,
        kind: "unsupported",
        field: event.field,
        phoneNumberId: null,
        whatsappMessageId: null,
        status: "ignored",
        lastError: event.reason,
      });
      continue;
    }

    const field = event.kind === "echo" ? "smb_message_echoes" : event.kind === "history" ? "history" : "messages";
    if (options.expectedPhoneNumberId && event.phoneNumberId !== options.expectedPhoneNumberId) {
      result.ignored += 1;
      await recordEvent({
        eventKey: `${event.kind}:${event.messageId}${event.kind === "status" ? `:${event.status}` : ""}`,
        kind: event.kind,
        field,
        phoneNumberId: event.phoneNumberId,
        whatsappMessageId: event.messageId,
        status: "ignored",
        lastError: "event for a different business phone number",
      });
      continue;
    }

    if (event.kind === "echo") {
      const created = await storeBusinessEcho(event, receivedAt, staffFirst?.pauseMinutes ?? 0);
      result.echoes += 1;
      await recordEvent({
        eventKey: `echo:${event.messageId}`,
        kind: "echo",
        field,
        phoneNumberId: event.phoneNumberId,
        whatsappMessageId: event.messageId,
        status: "applied",
      });
      logger.info("webhook.echo_stored", { type: event.content.type, duplicate: !created });
      continue;
    }

    if (event.kind === "history") {
      const thread = historyByCustomer.get(event.customer.waId) ?? [];
      thread.push(event);
      historyByCustomer.set(event.customer.waId, thread);
      continue;
    }

    if (event.kind === "message") {
      const { message, conversationId } = await storeInboundMessage(event, options.channel, receivedAt);
      // Staff-first: give staff on the WhatsApp Business app a head start before the bot answers.
      const runAt = new Date(receivedAt.getTime() + (staffFirst?.waitSeconds ?? 0) * 1000);
      const { job, created } = await createJob({
        type: "inbound_message",
        idempotencyKey: `inbound:${event.messageId}`,
        payload: { messageId: message._id, conversationId },
        runAt,
      });
      if (created) result.jobs.push({ id: job._id, runAt: job.runAt });
      result.inbound += 1;
      await recordEvent({
        eventKey: `message:${event.messageId}`,
        kind: "message",
        field: "messages",
        phoneNumberId: event.phoneNumberId,
        whatsappMessageId: event.messageId,
        status: "queued",
      });
      logger.info("webhook.inbound_stored", {
        customer: event.customer.waId ? maskPhoneNumber(event.customer.waId) : "user-id",
        type: event.content.type,
        duplicate: !created,
      });
      continue;
    }

    const applied = await applyStatusEvent(event);
    result.statuses += 1;
    await recordEvent({
      eventKey: `status:${event.messageId}:${event.status}`,
      kind: "status",
      field: "messages",
      phoneNumberId: event.phoneNumberId,
      whatsappMessageId: event.messageId,
      status: applied === "unmatched" ? "unmatched" : applied === "applied" ? "applied" : "ignored",
      statusPayload: applied === "unmatched" ? event : null,
      lastError: applied === "stale" ? "older than current status" : null,
    });
  }

  for (const [waId, thread] of historyByCustomer) {
    await storeHistoryThread(waId, thread, receivedAt);
    result.history += thread.length;
    const last = thread[thread.length - 1];
    await recordEvent({
      eventKey: `history:${waId}:${last?.messageId ?? "none"}`,
      kind: "history",
      field: "history",
      phoneNumberId: last?.phoneNumberId ?? null,
      whatsappMessageId: null,
      status: "applied",
    });
  }
  if (result.history > 0) logger.info("webhook.history_imported", { messages: result.history, customers: historyByCustomer.size });

  return result;
}

/**
 * Status webhooks can arrive before we have stored the message ID they refer to. The recovery
 * sweep re-applies recent unmatched ones.
 */
export async function reapplyUnmatchedStatuses(limit = 100): Promise<number> {
  await connectToDatabase();
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const pending = await WebhookEvent.find({ status: "unmatched", receivedAt: { $gte: since } }).limit(limit).lean();
  let applied = 0;
  for (const record of pending) {
    if (!record.statusPayload || !record.whatsappMessageId) continue;
    const outcome = await applyStatusEvent({
      kind: "status",
      phoneNumberId: record.phoneNumberId ?? "",
      messageId: record.whatsappMessageId,
      status: record.statusPayload.status as StatusEvent["status"],
      occurredAt: record.statusPayload.occurredAt,
      recipient: { waId: null, userId: null },
      errors: record.statusPayload.deliveryErrors,
    });
    if (outcome !== "unmatched") {
      applied += 1;
      await WebhookEvent.updateOne({ _id: record._id }, { $set: { status: outcome === "applied" ? "applied" : "ignored", processedAt: new Date() } });
    }
  }
  return applied;
}
