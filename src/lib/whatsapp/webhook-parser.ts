import { z } from "zod";

import {
  DELIVERY_STATUSES,
  type BusinessEchoEvent,
  type CustomerRef,
  type DeliveryStatus,
  type HistoryMessageEvent,
  type InboundContent,
  type InboundMessageEvent,
  type StatusEvent,
  type UnsupportedEvent,
  type WhatsAppEvent,
} from "./types";

/**
 * Parses a WhatsApp Cloud API webhook payload into normalised events.
 *
 * Every field is validated before use. A malformed message or status is reported as an
 * `unsupported` event rather than failing the whole delivery, so one bad item never blocks the
 * others. Unknown fields are ignored, which keeps the parser working as Meta adds fields.
 */

const unixSeconds = z.string().regex(/^\d{1,12}$/);

const contactSchema = z.object({
  wa_id: z.string().min(1).max(32).optional(),
  user_id: z.string().min(1).max(128).optional(),
  profile: z.object({ name: z.string().max(200).optional() }).optional(),
});

const messageSchema = z.object({
  id: z.string().min(1).max(256),
  from: z.string().min(1).max(32).optional(),
  from_user_id: z.string().min(1).max(128).optional(),
  timestamp: unixSeconds,
  type: z.string().min(1).max(50),
  text: z.object({ body: z.string().max(65_536) }).optional(),
  /** Quick-reply button on a template, e.g. the marketing "Stop promotions" button. */
  button: z.object({ text: z.string().max(256) }).optional(),
  context: z.object({ id: z.string().max(256).optional() }).optional(),
});

const statusErrorSchema = z.object({
  code: z.number().int(),
  title: z.string().max(300).optional(),
  message: z.string().max(1000).optional(),
  error_data: z.object({ details: z.string().max(1000).optional() }).optional(),
});

const statusSchema = z.object({
  id: z.string().min(1).max(256),
  status: z.string().min(1).max(30),
  timestamp: unixSeconds,
  recipient_id: z.string().max(32).optional(),
  recipient_user_id: z.string().max(128).optional(),
  errors: z.array(statusErrorSchema).max(20).optional(),
});

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1).max(64) }),
  contacts: z.array(z.unknown()).max(100).optional(),
  messages: z.array(z.unknown()).max(100).optional(),
  statuses: z.array(z.unknown()).max(100).optional(),
});

// Coexistence (WhatsApp Business app + Cloud API on one number).

const echoSchema = z.object({
  id: z.string().min(1).max(256),
  to: z.string().min(1).max(32).optional(),
  to_user_id: z.string().min(1).max(128).optional(),
  timestamp: unixSeconds,
  type: z.string().min(1).max(50),
  text: z.object({ body: z.string().max(65_536) }).optional(),
});

const echoValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1).max(64) }),
  message_echoes: z.array(z.unknown()).max(100),
});

const historyMessageSchema = z.object({
  id: z.string().min(1).max(256),
  from: z.string().min(1).max(32),
  timestamp: unixSeconds,
  type: z.string().min(1).max(50),
  text: z.object({ body: z.string().max(65_536) }).optional(),
  history_context: z.object({ status: z.string().max(30).optional() }).optional(),
});

const historyValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1).max(64) }),
  history: z
    .array(
      z.object({
        threads: z.array(z.object({ id: z.string().min(1).max(32), messages: z.array(z.unknown()).max(5000) })).max(1000).optional(),
        errors: z.array(z.unknown()).max(20).optional(),
      }),
    )
    .max(100),
});

/** History delivery states mapped to ours; PENDING and unknown values carry no status. */
const HISTORY_STATUS: Record<string, DeliveryStatus> = { SENT: "sent", DELIVERED: "delivered", READ: "read", PLAYED: "read", ERROR: "failed" };

const payloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string().optional(),
        changes: z.array(z.object({ field: z.string().max(100), value: z.unknown() })).max(100),
      }),
    )
    .max(100),
});

export type ParseResult =
  | { ok: true; events: WhatsAppEvent[] }
  | { ok: false; reason: "not_whatsapp" | "invalid_structure" };

function toDate(seconds: string): Date {
  return new Date(Number(seconds) * 1000);
}

function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

/** A tapped template button is handled like the customer typing its label. */
function toContent(type: string, text: { body: string } | undefined, button?: { text: string }): InboundContent {
  if (type === "text" && text) return { type: "text", body: text.body };
  if (type === "button" && button) return { type: "text", body: button.text };
  return { type: "unsupported", originalType: type };
}

function resolveCustomer(
  message: z.infer<typeof messageSchema>,
  contacts: z.infer<typeof contactSchema>[],
): CustomerRef | null {
  const contact =
    contacts.find((candidate) => message.from !== undefined && candidate.wa_id === message.from) ??
    contacts.find((candidate) => message.from_user_id !== undefined && candidate.user_id === message.from_user_id) ??
    (contacts.length === 1 ? contacts[0] : undefined);

  const waId = message.from ?? contact?.wa_id ?? null;
  const userId = message.from_user_id ?? contact?.user_id ?? null;
  if (!waId && !userId) return null;

  const name = contact?.profile?.name?.trim();
  return { waId, userId, profileName: name ? name : null };
}

function parseMessage(
  raw: unknown,
  phoneNumberId: string,
  contacts: z.infer<typeof contactSchema>[],
): InboundMessageEvent | { kind: "unsupported"; field: string; reason: string } {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return { kind: "unsupported", field: "messages", reason: "malformed message" };

  const message = parsed.data;
  const customer = resolveCustomer(message, contacts);
  if (!customer) return { kind: "unsupported", field: "messages", reason: "message without sender" };

  const content = toContent(message.type, message.text, message.button);

  return {
    kind: "message",
    phoneNumberId,
    messageId: message.id,
    customer,
    sentAt: toDate(message.timestamp),
    content,
    replyToMessageId: message.context?.id ?? null,
  };
}

function parseStatus(raw: unknown, phoneNumberId: string): StatusEvent | { kind: "unsupported"; field: string; reason: string } {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return { kind: "unsupported", field: "statuses", reason: "malformed status" };

  const status = parsed.data;
  if (!isDeliveryStatus(status.status)) {
    return { kind: "unsupported", field: "statuses", reason: `status '${status.status}' not tracked` };
  }

  return {
    kind: "status",
    phoneNumberId,
    messageId: status.id,
    status: status.status,
    occurredAt: toDate(status.timestamp),
    recipient: { waId: status.recipient_id ?? null, userId: status.recipient_user_id ?? null },
    errors: (status.errors ?? []).map((error) => ({
      code: error.code,
      title: error.title ?? error.message ?? "Unknown error",
      details: error.error_data?.details ?? null,
    })),
  };
}

function parseEchoes(raw: unknown): (BusinessEchoEvent | UnsupportedEvent)[] {
  const field = "smb_message_echoes";
  const value = echoValueSchema.safeParse(raw);
  if (!value.success) return [{ kind: "unsupported", field, reason: "malformed change value" }];

  return value.data.message_echoes.map((item): BusinessEchoEvent | UnsupportedEvent => {
    const parsed = echoSchema.safeParse(item);
    if (!parsed.success) return { kind: "unsupported", field, reason: "malformed echo" };
    const echo = parsed.data;
    if (!echo.to && !echo.to_user_id) return { kind: "unsupported", field, reason: "echo without recipient" };
    return {
      kind: "echo",
      phoneNumberId: value.data.metadata.phone_number_id,
      messageId: echo.id,
      customer: { waId: echo.to ?? null, userId: echo.to_user_id ?? null },
      sentAt: toDate(echo.timestamp),
      content: toContent(echo.type, echo.text),
    };
  });
}

function parseHistory(raw: unknown): (HistoryMessageEvent | UnsupportedEvent)[] {
  const field = "history";
  const value = historyValueSchema.safeParse(raw);
  if (!value.success) return [{ kind: "unsupported", field, reason: "malformed change value" }];

  const events: (HistoryMessageEvent | UnsupportedEvent)[] = [];
  for (const batch of value.data.history) {
    // Error 2593109: the business declined to share its chat history.
    if (batch.errors?.length) events.push({ kind: "unsupported", field, reason: "history sharing declined or failed" });
    for (const thread of batch.threads ?? []) {
      for (const item of thread.messages) {
        const parsed = historyMessageSchema.safeParse(item);
        if (!parsed.success) {
          events.push({ kind: "unsupported", field, reason: "malformed history message" });
          continue;
        }
        const message = parsed.data;
        // A thread is keyed by the customer's number, so anything not sent by them came from the business.
        const fromBusiness = message.from !== thread.id;
        events.push({
          kind: "history",
          phoneNumberId: value.data.metadata.phone_number_id,
          messageId: message.id,
          customer: { waId: thread.id },
          fromBusiness,
          sentAt: toDate(message.timestamp),
          content: toContent(message.type, message.text),
          deliveryStatus: fromBusiness ? (HISTORY_STATUS[message.history_context?.status ?? ""] ?? null) : null,
        });
      }
    }
  }
  return events;
}

export function parseWebhookPayload(input: unknown): ParseResult {
  const payload = payloadSchema.safeParse(input);
  if (!payload.success) return { ok: false, reason: "invalid_structure" };
  if (payload.data.object !== "whatsapp_business_account") return { ok: false, reason: "not_whatsapp" };

  const events: WhatsAppEvent[] = [];
  for (const entry of payload.data.entry) {
    for (const change of entry.changes) {
      if (change.field === "smb_message_echoes") {
        events.push(...parseEchoes(change.value));
        continue;
      }
      if (change.field === "history") {
        events.push(...parseHistory(change.value));
        continue;
      }
      if (change.field !== "messages") {
        events.push({ kind: "unsupported", field: change.field, reason: "field not handled" });
        continue;
      }

      const value = valueSchema.safeParse(change.value);
      if (!value.success) {
        events.push({ kind: "unsupported", field: change.field, reason: "malformed change value" });
        continue;
      }

      const phoneNumberId = value.data.metadata.phone_number_id;
      const contacts = (value.data.contacts ?? []).flatMap((raw) => {
        const contact = contactSchema.safeParse(raw);
        return contact.success ? [contact.data] : [];
      });

      for (const raw of value.data.messages ?? []) events.push(parseMessage(raw, phoneNumberId, contacts));
      for (const raw of value.data.statuses ?? []) events.push(parseStatus(raw, phoneNumberId));
    }
  }

  return { ok: true, events };
}
