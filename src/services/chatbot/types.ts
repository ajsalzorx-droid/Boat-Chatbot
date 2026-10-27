import type { BotSource } from "@/models/message";
import type { Availability, ProductKind } from "@/models/product";
import type { DaySchedule, LocalizedText, SpecialClosure } from "@/models/company-settings";

/**
 * Channel-independent chatbot contracts. The engine receives plain data and returns a reply;
 * it knows nothing about WhatsApp, MongoDB or HTTP.
 */

export type Language = "en" | "ar";

export type Intent =
  | "greeting"
  | "thanks"
  | "human"
  | "hours"
  | "location"
  | "contact"
  | "faq"
  | "product"
  | "ai"
  | "fallback"
  | "injection";

export interface KnowledgeFaq {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
}

export interface KnowledgeProduct {
  id: string;
  kind: ProductKind;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  availability: Availability;
  keywords: string[];
}

/** Trusted company configuration, as approved by administrators. */
export interface BotSettings {
  companyName: string;
  description: string;
  address: string;
  mapsUrl: string;
  websiteUrl: string;
  instagramUrl: string;
  timezone: string;
  businessHours: DaySchedule[];
  specialClosures: SpecialClosure[];
  botInstructions: string;
  messages: {
    greeting: LocalizedText;
    fallback: LocalizedText;
    handoff: LocalizedText;
    outOfHours: LocalizedText;
  };
  humanSupport: { phone: string; email: string; hoursNote: string };
  maxResponseLength: number;
  aiEnabled: boolean;
}

export interface HistoryTurn {
  role: "customer" | "business";
  text: string;
}

export interface ChatbotInput {
  /** Untrusted customer text. */
  text: string;
  history: HistoryTurn[];
  customerName: string | null;
  now: Date;
}

export interface Knowledge {
  settings: BotSettings;
  faqs: KnowledgeFaq[];
  products: KnowledgeProduct[];
}

export interface ChatbotReply {
  text: string;
  intent: Intent;
  source: BotSource;
  /** True when the conversation should be handed to staff and the bot paused. */
  handoff: boolean;
  language: Language;
  aiModel: string | null;
}
