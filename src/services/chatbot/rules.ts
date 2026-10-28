import type { LocalizedText } from "@/models/company-settings";

import { formatHours, isOpenNow } from "./business-hours";
import { containsPhrase, countMatches, normalize, tokenize } from "./text";
import type { BotSettings, Intent, KnowledgeFaq, KnowledgeProduct, Language } from "./types";

/** Deterministic, rule-based understanding and replies. Works with AI disabled. */

const GREETINGS = [
  "hi", "hello", "hey", "hii", "hiii", "good morning", "good afternoon", "good evening", "salam", "salaam",
  "assalamualaikum", "assalamu alaikum", "السلام عليكم", "سلام", "مرحبا", "اهلا", "هلا", "صباح الخير", "مساء الخير",
];
const THANKS = ["thanks", "thank you", "thx", "ty", "thank u", "شكرا", "مشكور", "يعطيك العافيه"];
const HUMAN = [
  "human", "agent", "person", "real person", "representative", "staff", "talk to someone", "speak to someone",
  "customer service", "call me", "manager", "موظف", "شخص", "خدمه العملاء", "اكلم احد",
];
const HOURS = ["hours", "opening", "open", "close", "closing", "timing", "timings", "working hours", "دوام", "ساعات", "متى تفتحون", "مفتوح"];
const LOCATION = ["address", "location", "where", "located", "map", "directions", "branch", "عنوان", "موقع", "وين", "فرع"];
const CONTACT = ["contact", "phone", "call", "email", "number", "website", "instagram", "رقم", "تواصل", "ايميل"];
const OFFERS = ["offer", "offers", "discount", "discounts", "deal", "deals", "sale", "promo", "promotion", "promotions", "عرض", "عروض", "خصم", "تخفيض", "تخفيضات"];

/** Obvious attempts to manipulate the bot or extract hidden instructions or secrets. */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules|messages)/i,
  /(system|hidden|initial|developer)\s+(prompt|instructions|message)/i,
  /(reveal|show|print|repeat|display|leak)\s+(me\s+)?(your|the)\s+(instructions|prompt|rules|configuration|system)/i,
  /what\s+(are|were)\s+your\s+(instructions|rules)/i,
  /\b(api[\s_-]?key|access[\s_-]?token|secret[\s_-]?key|password|credentials?)\b/i,
  /\b(jailbreak|dan mode|developer mode|do anything now)\b/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /تجاهل\s+.*(التعليمات|الاوامر)/,
];

export function pick(text: LocalizedText, language: Language): string {
  return language === "ar" && text.ar ? text.ar : text.en;
}

export function isInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectSimpleIntent(text: string): Intent | null {
  const tokens = normalize(text).split(" ").filter(Boolean);
  if (containsPhrase(text, HUMAN)) return "human";
  if (tokens.length <= 5 && containsPhrase(text, THANKS)) return "thanks";
  if (tokens.length <= 4 && containsPhrase(text, GREETINGS)) return "greeting";
  if (containsPhrase(text, OFFERS)) return "offers";
  if (containsPhrase(text, HOURS)) return "hours";
  if (containsPhrase(text, LOCATION)) return "location";
  if (containsPhrase(text, CONTACT)) return "contact";
  return null;
}

export interface ScoredFaq {
  faq: KnowledgeFaq;
  score: number;
}

/**
 * Scores FAQs by token overlap. The message coverage dominates (did we match what the customer
 * asked about?); FAQ coverage breaks ties toward the most specific question.
 */
export function rankFaqs(text: string, faqs: readonly KnowledgeFaq[]): ScoredFaq[] {
  const messageTokens = tokenize(text);
  if (messageTokens.length === 0) return [];
  return faqs
    .map((faq) => {
      const faqTokens = [...tokenize(faq.question), ...faq.keywords.flatMap((keyword) => tokenize(keyword))];
      if (faqTokens.length === 0) return { faq, score: 0 };
      const matched = countMatches(messageTokens, faqTokens);
      const messageCoverage = matched / new Set(messageTokens).size;
      const faqCoverage = matched / new Set(faqTokens).size;
      return { faq, score: 0.75 * messageCoverage + 0.25 * Math.min(1, faqCoverage) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

export interface ScoredProduct {
  product: KnowledgeProduct;
  score: number;
}

export function rankProducts(text: string, products: readonly KnowledgeProduct[]): ScoredProduct[] {
  const messageTokens = tokenize(text);
  if (messageTokens.length === 0) return [];
  return products
    .map((product) => {
      const nameTokens = tokenize(product.name);
      const keywordTokens = product.keywords.flatMap((keyword) => tokenize(keyword));
      const nameMatches = countMatches(messageTokens, nameTokens);
      const keywordMatches = countMatches(messageTokens, keywordTokens);
      const nameCoverage = nameTokens.length > 0 ? nameMatches / new Set(nameTokens).size : 0;
      return { product, score: Math.min(1, nameCoverage + 0.25 * keywordMatches) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

const AVAILABILITY_TEXT: Record<Language, Record<KnowledgeProduct["availability"], string>> = {
  en: { available: "Available", out_of_stock: "Currently out of stock", on_request: "Available on request", discontinued: "No longer available" },
  ar: { available: "متوفر", out_of_stock: "غير متوفر حالياً", on_request: "متوفر عند الطلب", discontinued: "لم يعد متوفراً" },
};

export function formatPrice(price: number, currency: string): string {
  return `${price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
}

function offerLine(product: KnowledgeProduct, language: Language): string | null {
  if (!product.offer) return null;
  const until = language === "ar" ? `حتى ${product.offer.validUntil}` : `until ${product.offer.validUntil}`;
  const was = product.price !== null && product.price > product.offer.price ? ` ~${formatPrice(product.price, product.currency)}~` : "";
  const note = product.offer.note ? ` (${product.offer.note})` : "";
  return `${language === "ar" ? "🎉 عرض خاص" : "🎉 Offer"}: *${formatPrice(product.offer.price, product.currency)}*${was} ${until}${note}`;
}

export function describeProduct(product: KnowledgeProduct, language: Language): string {
  const lines = [`*${product.name}*`];
  if (product.description) lines.push(product.description);
  const offer = offerLine(product, language);
  if (offer) {
    lines.push(offer);
  } else if (product.price !== null) {
    lines.push(`${language === "ar" ? "السعر" : "Price"}: ${formatPrice(product.price, product.currency)}`);
  } else {
    lines.push(language === "ar" ? "للاستفسار عن السعر يرجى التواصل معنا." : "Please contact us for pricing.");
  }
  lines.push(AVAILABILITY_TEXT[language][product.availability]);
  return lines.join("\n");
}

/** Lists the products that have a valid offer right now (expired offers are already removed). */
export function offersReply(products: readonly KnowledgeProduct[], language: Language): string {
  const current = products.filter((product) => product.offer && product.availability !== "discontinued");
  if (current.length === 0) {
    return language === "ar" ? "لا توجد عروض خاصة حالياً، لكن يسعدنا مساعدتك في أي منتج." : "We don't have any special offers right now, but we're happy to help you with any product.";
  }
  const heading = language === "ar" ? "عروضنا الحالية:" : "Our current offers:";
  return [heading, ...current.slice(0, 5).map((product) => describeProduct(product, language))].join("\n\n");
}

/** Drops offers whose last day (company timezone) has passed. */
export function withCurrentOffers(products: readonly KnowledgeProduct[], today: string): KnowledgeProduct[] {
  return products.map((product) => (product.offer && product.offer.validUntil < today ? { ...product, offer: null } : product));
}

export function hoursReply(settings: BotSettings, language: Language, now: Date): string | null {
  const hours = formatHours(settings.businessHours, language);
  if (!hours) return null;
  const open = isOpenNow(settings.businessHours, settings.specialClosures, settings.timezone, now);
  const status =
    open === null ? "" : language === "ar" ? (open ? "\n\nنحن مفتوحون الآن." : "\n\nنحن مغلقون الآن.") : open ? "\n\nWe are open now." : "\n\nWe are closed right now.";
  const heading = language === "ar" ? `ساعات العمل (${settings.timezone}):` : `Our opening hours (${settings.timezone} time):`;
  return `${heading}\n${hours}${status}`;
}

export function locationReply(settings: BotSettings, language: Language): string | null {
  if (!settings.address && !settings.mapsUrl) return null;
  const lines = [language === "ar" ? "عنواننا:" : "You can find us at:"];
  if (settings.address) lines.push(settings.address);
  if (settings.mapsUrl) lines.push(settings.mapsUrl);
  return lines.join("\n");
}

export function contactReply(settings: BotSettings, language: Language): string | null {
  const lines: string[] = [];
  if (settings.humanSupport.phone) lines.push(`${language === "ar" ? "الهاتف" : "Phone"}: ${settings.humanSupport.phone}`);
  if (settings.humanSupport.email) lines.push(`${language === "ar" ? "البريد" : "Email"}: ${settings.humanSupport.email}`);
  if (settings.websiteUrl) lines.push(`${language === "ar" ? "الموقع" : "Website"}: ${settings.websiteUrl}`);
  if (settings.instagramUrl) lines.push(`Instagram: ${settings.instagramUrl}`);
  if (lines.length === 0) return null;
  return [language === "ar" ? "يمكنك التواصل معنا عبر:" : "You can reach us here:", ...lines].join("\n");
}

export function thanksReply(language: Language): string {
  return language === "ar" ? "على الرحب والسعة! هل هناك شيء آخر يمكنني مساعدتك به؟" : "You're welcome! Is there anything else I can help you with?";
}

export function injectionReply(language: Language): string {
  return language === "ar"
    ? "عذراً، لا يمكنني المساعدة في ذلك. يسعدني الإجابة عن أسئلتك حول منتجاتنا وخدماتنا."
    : "Sorry, I can't help with that. I'm happy to answer questions about our products and services.";
}
