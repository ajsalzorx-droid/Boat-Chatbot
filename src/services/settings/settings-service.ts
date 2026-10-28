import "server-only";

import { connectToDatabase } from "@/lib/db/mongoose";
import { CompanySettings, type CompanySettingsDoc } from "@/models/company-settings";
import type { BotSettings } from "@/services/chatbot/types";

/** Company settings: a single document, created with safe defaults on first use. */

export type SettingsData = Omit<CompanySettingsDoc, "key" | "createdAt" | "updatedAt">;

export const DEFAULT_SETTINGS: SettingsData = {
  companyName: "",
  logoUrl: "",
  description: "",
  businessWhatsAppNumber: "",
  instagramUrl: "",
  websiteUrl: "",
  address: "",
  mapsUrl: "",
  timezone: "Asia/Dubai",
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: false, open: "09:00", close: "21:00" })),
  specialClosures: [],
  botEnabled: true,
  botInstructions: "Be friendly, polite and concise. Use simple language.",
  messages: {
    greeting: {
      en: "Hello {name}! 👋 Thanks for contacting us. How can we help you today?",
      ar: "مرحباً {name}! 👋 شكراً لتواصلك معنا. كيف يمكننا مساعدتك اليوم؟",
    },
    fallback: {
      en: "Sorry, I don't have that information right now. A member of our team will get back to you shortly.",
      ar: "عذراً، لا تتوفر لدي هذه المعلومات حالياً. سيتواصل معك أحد أعضاء فريقنا قريباً.",
    },
    handoff: {
      en: "I've passed your message to our team. A staff member will reply to you here as soon as possible.",
      ar: "لقد أرسلت رسالتك إلى فريقنا. سيرد عليك أحد الموظفين هنا في أقرب وقت ممكن.",
    },
    outOfHours: {
      en: "We're currently closed, so a team member will reply during our opening hours.",
      ar: "نحن مغلقون حالياً، وسيرد عليك أحد أعضاء الفريق خلال ساعات العمل.",
    },
    optOut: {
      en: "You've been unsubscribed and won't receive further messages from us. Reply START to subscribe again.",
      ar: "تم إلغاء اشتراكك ولن تصلك رسائل أخرى منا. أرسل ابدأ للاشتراك مرة أخرى.",
    },
    optIn: {
      en: "You're subscribed again. How can we help you?",
      ar: "تم تفعيل اشتراكك مرة أخرى. كيف يمكننا مساعدتك؟",
    },
  },
  humanSupport: { phone: "", email: "", hoursNote: "" },
  ai: { enabled: true, aiFirst: false, maxHistoryMessages: 10 },
  maxResponseLength: 700,
  messaging: {
    reengagementTemplate: null,
    optOutKeywords: ["stop", "unsubscribe", "إيقاف", "الغاء"],
    optInKeywords: ["start", "subscribe", "ابدأ"],
  },
  retention: { messageRetentionDays: 365 },
  humanFirst: { enabled: false, waitSeconds: 15, pauseMinutes: 30 },
  handoffResumeMinutes: 10,
  savedReplies: [],
};

/** Documents created before a setting existed lack it; lean reads do not apply schema defaults. */
function withDefaults(settings: CompanySettingsDoc): CompanySettingsDoc {
  const stored: Partial<Pick<CompanySettingsDoc, "humanFirst" | "handoffResumeMinutes" | "savedReplies">> = settings;
  return {
    ...settings,
    ai: { ...DEFAULT_SETTINGS.ai, ...settings.ai },
    humanFirst: stored.humanFirst ?? DEFAULT_SETTINGS.humanFirst,
    handoffResumeMinutes: stored.handoffResumeMinutes ?? DEFAULT_SETTINGS.handoffResumeMinutes,
    savedReplies: stored.savedReplies ?? DEFAULT_SETTINGS.savedReplies,
  };
}

export async function getSettings(): Promise<CompanySettingsDoc> {
  await connectToDatabase();
  const settings = await CompanySettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", ...DEFAULT_SETTINGS } },
    { upsert: true, returnDocument: "after", lean: true },
  );
  if (!settings) throw new Error("Settings upsert returned nothing");
  return withDefaults(settings);
}

export async function updateSettings(update: Partial<SettingsData>): Promise<CompanySettingsDoc> {
  await connectToDatabase();
  await getSettings();
  const updated = await CompanySettings.findOneAndUpdate(
    { key: "default" },
    { $set: update },
    { returnDocument: "after", runValidators: true, lean: true },
  );
  if (!updated) throw new Error("Settings document missing after upsert");
  return withDefaults(updated);
}

export function toBotSettings(settings: CompanySettingsDoc): BotSettings {
  return {
    companyName: settings.companyName,
    description: settings.description,
    address: settings.address,
    mapsUrl: settings.mapsUrl,
    websiteUrl: settings.websiteUrl,
    instagramUrl: settings.instagramUrl,
    timezone: settings.timezone,
    businessHours: settings.businessHours,
    specialClosures: settings.specialClosures,
    botInstructions: settings.botInstructions,
    messages: {
      greeting: settings.messages.greeting,
      fallback: settings.messages.fallback,
      handoff: settings.messages.handoff,
      outOfHours: settings.messages.outOfHours,
    },
    humanSupport: settings.humanSupport,
    maxResponseLength: settings.maxResponseLength,
    aiEnabled: settings.ai.enabled,
    aiFirst: settings.ai.aiFirst,
  };
}
