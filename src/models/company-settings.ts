import { Schema } from "mongoose";

import { defineModel } from "./define-model";

export interface LocalizedText {
  en: string;
  /** Optional Arabic version; the bot falls back to English when absent. */
  ar?: string | undefined;
}

export interface DaySchedule {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  closed: boolean;
  /** "HH:mm" in the company timezone. */
  open: string;
  close: string;
}

export interface SpecialClosure {
  /** "YYYY-MM-DD" in the company timezone. */
  date: string;
  note: string;
}

export interface TemplateRef {
  name: string;
  languageCode: string;
}

export interface CompanySettingsDoc {
  /** Singleton key: there is exactly one settings document. */
  key: "default";
  companyName: string;
  logoUrl: string;
  description: string;
  businessWhatsAppNumber: string;
  instagramUrl: string;
  websiteUrl: string;
  address: string;
  mapsUrl: string;
  timezone: string;
  businessHours: DaySchedule[];
  specialClosures: SpecialClosure[];
  botEnabled: boolean;
  /** Extra guidance for the AI (tone, topics). Never overrides the safety rules. */
  botInstructions: string;
  messages: {
    greeting: LocalizedText;
    fallback: LocalizedText;
    handoff: LocalizedText;
    outOfHours: LocalizedText;
    optOut: LocalizedText;
    optIn: LocalizedText;
  };
  humanSupport: { phone: string; email: string; hoursNote: string };
  /** aiFirst: the AI writes every answer except greetings and thanks (rule answers are the fallback). */
  ai: { enabled: boolean; aiFirst: boolean; maxHistoryMessages: number };
  maxResponseLength: number;
  messaging: {
    /** Approved template used to re-open a conversation outside the customer service window. */
    reengagementTemplate: TemplateRef | null;
    optOutKeywords: string[];
    optInKeywords: string[];
  };
  retention: { messageRetentionDays: number };
  /**
   * Staff-first replies, for numbers shared with the WhatsApp Business app (coexistence). The bot
   * waits `waitSeconds` before answering and stays quiet when staff replied in the meantime; after a
   * staff reply it pauses for that customer for `pauseMinutes`.
   */
  humanFirst: { enabled: boolean; waitSeconds: number; pauseMinutes: number };
  /**
   * After a handover the bot is silent for that customer. When no staff member has replied this
   * many minutes after the handover, the bot answers the customer's next message again. 0 = never.
   */
  handoffResumeMinutes: number;
  /**
   * Offer alerts: when a new offer goes live on the website, subscribed customers get it on
   * WhatsApp through an approved Marketing template (image header = banner; body {{1}} title,
   * {{2}} percent, {{3}} last day).
   */
  offerAlerts: { enabled: boolean; template: TemplateRef | null };
  /** Ready-made texts staff can insert when replying from the dashboard. */
  savedReplies: SavedReply[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedReply {
  title: string;
  text: string;
}

const localizedText = new Schema<LocalizedText>(
  {
    en: { type: String, required: true, trim: true, maxlength: 1000 },
    ar: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const daySchedule = new Schema<DaySchedule>(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    closed: { type: Boolean, default: false },
    open: { type: String, default: "09:00", match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    close: { type: String, default: "21:00", match: /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/ },
  },
  { _id: false },
);

const companySettingsSchema = new Schema<CompanySettingsDoc>(
  {
    key: { type: String, required: true, enum: ["default"], default: "default" },
    companyName: { type: String, trim: true, maxlength: 120, default: "" },
    logoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    businessWhatsAppNumber: { type: String, trim: true, maxlength: 20, default: "" },
    instagramUrl: { type: String, trim: true, maxlength: 300, default: "" },
    websiteUrl: { type: String, trim: true, maxlength: 300, default: "" },
    address: { type: String, trim: true, maxlength: 500, default: "" },
    mapsUrl: { type: String, trim: true, maxlength: 500, default: "" },
    timezone: { type: String, trim: true, default: "Asia/Dubai" },
    businessHours: { type: [daySchedule], default: [] },
    specialClosures: {
      type: [
        new Schema<SpecialClosure>(
          {
            date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
            note: { type: String, trim: true, maxlength: 200, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    botEnabled: { type: Boolean, default: true },
    botInstructions: { type: String, trim: true, maxlength: 4000, default: "" },
    messages: {
      greeting: { type: localizedText, required: true },
      fallback: { type: localizedText, required: true },
      handoff: { type: localizedText, required: true },
      outOfHours: { type: localizedText, required: true },
      optOut: { type: localizedText, required: true },
      optIn: { type: localizedText, required: true },
    },
    humanSupport: {
      phone: { type: String, trim: true, maxlength: 30, default: "" },
      email: { type: String, trim: true, maxlength: 200, default: "" },
      hoursNote: { type: String, trim: true, maxlength: 300, default: "" },
    },
    ai: {
      enabled: { type: Boolean, default: true },
      aiFirst: { type: Boolean, default: false },
      maxHistoryMessages: { type: Number, min: 0, max: 30, default: 10 },
    },
    maxResponseLength: { type: Number, min: 100, max: 4096, default: 700 },
    messaging: {
      reengagementTemplate: {
        type: new Schema<TemplateRef>(
          {
            name: { type: String, required: true, match: /^[a-z0-9_]{1,512}$/ },
            languageCode: { type: String, required: true, match: /^[a-z]{2,3}(_[A-Z]{2})?$/ },
          },
          { _id: false },
        ),
        default: null,
      },
      optOutKeywords: { type: [String], default: ["stop", "unsubscribe", "إيقاف", "الغاء"] },
      optInKeywords: { type: [String], default: ["start", "subscribe", "ابدأ"] },
    },
    retention: {
      messageRetentionDays: { type: Number, min: 30, max: 3650, default: 365 },
    },
    humanFirst: {
      enabled: { type: Boolean, default: false },
      waitSeconds: { type: Number, min: 0, max: 120, default: 15 },
      pauseMinutes: { type: Number, min: 0, max: 1440, default: 30 },
    },
    handoffResumeMinutes: { type: Number, min: 0, max: 10080, default: 10 },
    offerAlerts: {
      enabled: { type: Boolean, default: false },
      template: {
        type: new Schema<TemplateRef>({ name: { type: String, trim: true, maxlength: 512 }, languageCode: { type: String, trim: true, maxlength: 15 } }, { _id: false }),
        default: null,
      },
    },
    savedReplies: {
      type: [
        new Schema<SavedReply>(
          {
            title: { type: String, required: true, trim: true, maxlength: 60 },
            text: { type: String, required: true, trim: true, maxlength: 4096 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

companySettingsSchema.index({ key: 1 }, { unique: true });

export const CompanySettings = defineModel<CompanySettingsDoc>("CompanySettings", companySettingsSchema);
