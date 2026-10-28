import { maskPhoneNumber } from "@/lib/logging/redact";
import type { AdminUserDoc } from "@/models/admin-user";
import type { CompanySettingsDoc } from "@/models/company-settings";
import type { ConversationDoc } from "@/models/conversation";
import type { FaqDoc } from "@/models/faq";
import type { MessageDoc } from "@/models/message";
import type { ProcessingJobDoc } from "@/models/processing-job";
import type { ProductDoc } from "@/models/product";

/**
 * Explicit response shapes for the dashboard. Database documents are never returned directly;
 * each field here is chosen on purpose, and internal fields stay on the server.
 */

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

export interface ConversationSummaryDto {
  id: string;
  channel: ConversationDoc["channel"];
  customerName: string | null;
  /** Masked in lists; the full number is only in the conversation detail. */
  customerNumber: string | null;
  lastMessagePreview: string;
  lastMessageDirection: ConversationDoc["lastMessageDirection"];
  lastMessageAt: string | null;
  status: ConversationDoc["status"];
  botEnabled: boolean;
  assignedAgentId: string | null;
  unanswered: boolean;
  optedOut: boolean;
}

export function toConversationSummary(conversation: ConversationDoc): ConversationSummaryDto {
  const lastIn = conversation.lastInboundAt?.getTime() ?? 0;
  const lastOut = conversation.lastOutboundAt?.getTime() ?? 0;
  return {
    id: conversation._id.toString(),
    channel: conversation.channel,
    customerName: conversation.displayName,
    customerNumber: conversation.waId ? (conversation.channel === "simulator" ? conversation.waId : maskPhoneNumber(conversation.waId)) : null,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageDirection: conversation.lastMessageDirection,
    lastMessageAt: iso(conversation.lastMessageAt),
    status: conversation.status,
    botEnabled: conversation.botEnabled,
    assignedAgentId: conversation.assignedAgentId?.toString() ?? null,
    unanswered: conversation.status !== "resolved" && lastIn > lastOut,
    optedOut: conversation.optedOut,
  };
}

export interface ConversationDetailDto extends ConversationSummaryDto {
  customerNumberFull: string | null;
  lastInboundAt: string | null;
  windowClosesAt: string | null;
  /** Computed on the server clock: whether free-form replies are allowed right now. */
  windowOpen: boolean;
  handoffRequestedAt: string | null;
  /** The bot stays quiet for this customer until then because staff replied recently. */
  humanActiveUntil: string | null;
  createdAt: string;
}

export function toConversationDetail(conversation: ConversationDoc, windowClosesAt: Date | null): ConversationDetailDto {
  return {
    ...toConversationSummary(conversation),
    customerNumberFull: conversation.waId,
    lastInboundAt: iso(conversation.lastInboundAt),
    windowClosesAt: iso(windowClosesAt),
    windowOpen: conversation.channel === "simulator" || (windowClosesAt !== null && windowClosesAt.getTime() > Date.now()),
    handoffRequestedAt: iso(conversation.handoffRequestedAt),
    humanActiveUntil: conversation.humanActiveUntil && conversation.humanActiveUntil.getTime() > Date.now() ? iso(conversation.humanActiveUntil) : null,
    createdAt: conversation.createdAt.toISOString(),
  };
}

export interface MessageDto {
  id: string;
  direction: MessageDoc["direction"];
  sender: MessageDoc["sender"];
  type: MessageDoc["type"];
  text: string | null;
  templateName: string | null;
  originalType: string | null;
  status: MessageDoc["status"];
  error: { code: string; title: string } | null;
  botSource: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export function toMessageDto(message: MessageDoc): MessageDto {
  return {
    id: message._id.toString(),
    direction: message.direction,
    sender: message.sender,
    type: message.type,
    text: message.text,
    templateName: message.template?.name ?? null,
    originalType: message.originalType,
    status: message.status,
    error: message.error ? { code: String(message.error.code), title: message.error.title } : null,
    botSource: message.botMeta?.source ?? null,
    createdAt: message.createdAt.toISOString(),
    deliveredAt: iso(message.statusTimestamps.deliveredAt),
    readAt: iso(message.statusTimestamps.readAt),
  };
}

export interface FaqDto {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  active: boolean;
  updatedAt: string;
}

export function toFaqDto(faq: FaqDoc): FaqDto {
  return { id: faq._id.toString(), question: faq.question, answer: faq.answer, keywords: faq.keywords, active: faq.active, updatedAt: faq.updatedAt.toISOString() };
}

export interface ProductDto {
  id: string;
  kind: ProductDoc["kind"];
  name: string;
  description: string;
  price: number | null;
  currency: string;
  availability: ProductDoc["availability"];
  keywords: string[];
  offer: { price: number; validUntil: string; note: string } | null;
  active: boolean;
  source: ProductDoc["source"];
  updatedAt: string;
}

export function toProductDto(product: ProductDoc): ProductDto {
  return {
    id: product._id.toString(),
    kind: product.kind,
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    availability: product.availability,
    keywords: product.keywords,
    offer: product.offer ? { price: product.offer.price, validUntil: product.offer.validUntil, note: product.offer.note } : null,
    active: product.active,
    source: product.source,
    updatedAt: product.updatedAt.toISOString(),
  };
}

export type SettingsDto = Omit<CompanySettingsDoc, "key" | "createdAt" | "updatedAt" | "_id"> & { updatedAt: string };

export function toSettingsDto(settings: CompanySettingsDoc): SettingsDto {
  return {
    companyName: settings.companyName,
    logoUrl: settings.logoUrl,
    description: settings.description,
    businessWhatsAppNumber: settings.businessWhatsAppNumber,
    instagramUrl: settings.instagramUrl,
    websiteUrl: settings.websiteUrl,
    address: settings.address,
    mapsUrl: settings.mapsUrl,
    timezone: settings.timezone,
    businessHours: settings.businessHours.map(({ day, closed, open, close }) => ({ day, closed, open, close })),
    specialClosures: settings.specialClosures.map(({ date, note }) => ({ date, note })),
    botEnabled: settings.botEnabled,
    botInstructions: settings.botInstructions,
    messages: {
      greeting: { en: settings.messages.greeting.en, ar: settings.messages.greeting.ar },
      fallback: { en: settings.messages.fallback.en, ar: settings.messages.fallback.ar },
      handoff: { en: settings.messages.handoff.en, ar: settings.messages.handoff.ar },
      outOfHours: { en: settings.messages.outOfHours.en, ar: settings.messages.outOfHours.ar },
      optOut: { en: settings.messages.optOut.en, ar: settings.messages.optOut.ar },
      optIn: { en: settings.messages.optIn.en, ar: settings.messages.optIn.ar },
    },
    humanSupport: { ...settings.humanSupport },
    ai: { enabled: settings.ai.enabled, aiFirst: settings.ai.aiFirst, maxHistoryMessages: settings.ai.maxHistoryMessages },
    maxResponseLength: settings.maxResponseLength,
    messaging: {
      reengagementTemplate: settings.messaging.reengagementTemplate
        ? { name: settings.messaging.reengagementTemplate.name, languageCode: settings.messaging.reengagementTemplate.languageCode }
        : null,
      optOutKeywords: [...settings.messaging.optOutKeywords],
      optInKeywords: [...settings.messaging.optInKeywords],
    },
    retention: { messageRetentionDays: settings.retention.messageRetentionDays },
    humanFirst: { ...settings.humanFirst },
    handoffResumeMinutes: settings.handoffResumeMinutes,
    savedReplies: settings.savedReplies.map(({ title, text }) => ({ title, text })),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: AdminUserDoc["role"];
}

export function toAdminUserDto(user: Pick<AdminUserDoc, "_id" | "email" | "name" | "role">): AdminUserDto {
  return { id: user._id.toString(), email: user.email, name: user.name, role: user.role };
}

export interface JobDto {
  id: string;
  type: string;
  status: ProcessingJobDoc["status"];
  attempts: number;
  maxAttempts: number;
  lastError: { code: string; message: string } | null;
  conversationId: string;
  updatedAt: string;
}

export function toJobDto(job: ProcessingJobDoc): JobDto {
  return {
    id: job._id.toString(),
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError ? { code: job.lastError.code, message: job.lastError.message } : null,
    conversationId: job.payload.conversationId.toString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
