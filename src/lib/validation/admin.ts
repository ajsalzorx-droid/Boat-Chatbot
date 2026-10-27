import { Types } from "mongoose";
import { z } from "zod";

import { ADMIN_ROLES } from "@/models/admin-user";
import { CONVERSATION_STATUSES, CHANNELS } from "@/models/conversation";
import { AVAILABILITY, PRODUCT_KINDS } from "@/models/product";

/**
 * Request schemas for every admin endpoint. Only primitive values are accepted for fields used
 * in database filters, which blocks query-operator injection ({"$gt": ""}).
 */

export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Invalid id")
  .transform((value) => new Types.ObjectId(value));

export const idParamsSchema = z.object({ id: objectIdSchema });

const trimmed = (max: number) => z.string().trim().max(max);
const optionalUrl = z.union([z.literal(""), z.url().max(500).refine((value) => /^https?:\/\//i.test(value), "Must start with http(s)://")]);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(200),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export const conversationListQuerySchema = z.object({
  search: trimmed(50).optional(),
  status: z.enum([...CONVERSATION_STATUSES, "unanswered"]).optional(),
  channel: z.enum(CHANNELS).optional(),
  assigned: z.union([z.enum(["me", "unassigned"]), objectIdSchema]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const conversationUpdateSchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES).optional(),
    botEnabled: z.boolean().optional(),
    assignedAgentId: z.union([objectIdSchema, z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const replySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(4096),
    clientRequestId: z.uuid(),
  }),
  z.object({ kind: z.literal("template"), clientRequestId: z.uuid() }),
]);

const keywordsSchema = z.array(z.string().trim().toLowerCase().min(1).max(50)).max(30).default([]);

export const faqSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(2000),
  keywords: keywordsSchema,
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  kind: z.enum(PRODUCT_KINDS).default("product"),
  name: z.string().trim().min(1).max(150),
  description: trimmed(2000).default(""),
  price: z.number().min(0).max(100_000_000).nullable().default(null),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("AED"),
  availability: z.enum(AVAILABILITY).default("available"),
  keywords: keywordsSchema,
  active: z.boolean().default(true),
});

const localized = z.object({ en: z.string().trim().min(1).max(1000), ar: trimmed(1000).optional() });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:mm");

export const settingsSchema = z.object({
  companyName: trimmed(120),
  logoUrl: optionalUrl,
  description: trimmed(2000),
  businessWhatsAppNumber: z.union([z.literal(""), z.string().trim().regex(/^\+?\d{6,15}$/, "Digits with country code")]),
  instagramUrl: optionalUrl,
  websiteUrl: optionalUrl,
  address: trimmed(500),
  mapsUrl: optionalUrl,
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  businessHours: z
    .array(z.object({ day: z.number().int().min(0).max(6), closed: z.boolean(), open: time, close: time }))
    .max(7)
    .refine((days) => new Set(days.map((day) => day.day)).size === days.length, "Each day once"),
  specialClosures: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: trimmed(200) })).max(100),
  botEnabled: z.boolean(),
  botInstructions: trimmed(4000),
  messages: z.object({
    greeting: localized,
    fallback: localized,
    handoff: localized,
    outOfHours: localized,
    optOut: localized,
    optIn: localized,
  }),
  humanSupport: z.object({ phone: trimmed(30), email: z.union([z.literal(""), z.email().max(200)]), hoursNote: trimmed(300) }),
  ai: z.object({ enabled: z.boolean(), maxHistoryMessages: z.number().int().min(0).max(30) }),
  maxResponseLength: z.number().int().min(100).max(4096),
  messaging: z.object({
    reengagementTemplate: z
      .object({
        name: z.string().regex(/^[a-z0-9_]{1,512}$/, "Lowercase letters, digits and _"),
        languageCode: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "e.g. en or en_US"),
      })
      .nullable(),
    optOutKeywords: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
    optInKeywords: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
  }),
  retention: z.object({ messageRetentionDays: z.number().int().min(30).max(3650) }),
  humanFirst: z.object({
    enabled: z.boolean(),
    waitSeconds: z.number().int().min(0).max(120),
    pauseMinutes: z.number().int().min(0).max(1440),
  }),
  savedReplies: z.array(z.object({ title: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(4096) })).max(50),
});

export const coexistenceOnboardingSchema = z.object({
  /** Authorization code from Embedded Signup, exchanged on the server for a business token. */
  code: z.string().min(10).max(2048),
  wabaId: z.string().regex(/^\d{5,20}$/),
  phoneNumberId: z.string().regex(/^\d{5,20}$/),
});

export const simulatorMessageSchema = z.object({
  customerId: z.string().regex(/^[a-z0-9-]{1,40}$/i, "Letters, digits and dashes"),
  customerName: trimmed(80).default("Test customer"),
  text: z.string().trim().min(1).max(4096),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(100),
  role: z.enum(ADMIN_ROLES),
});
