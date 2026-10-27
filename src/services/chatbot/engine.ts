import { logger } from "@/lib/logging/logger";
import { AiProviderError, type AiProvider } from "@/providers/ai/types";

import { isOpenNow } from "./business-hours";
import { buildMessages, buildSystemPrompt, checkModelOutput } from "./prompt";
import {
  contactReply,
  describeProduct,
  detectSimpleIntent,
  hoursReply,
  injectionReply,
  isInjectionAttempt,
  locationReply,
  pick,
  rankFaqs,
  rankProducts,
  thanksReply,
} from "./rules";
import { detectLanguage, truncate } from "./text";
import type { ChatbotInput, ChatbotReply, Intent, Knowledge, Language } from "./types";

/**
 * Channel-independent chatbot engine.
 *
 * Order of precedence:
 * 1. Safety: manipulation attempts get a fixed refusal; the AI never sees them.
 * 2. Explicit requests for a person hand the conversation to staff.
 * 3. High-confidence rule answers (greeting, hours, location, contact, strong FAQ match) are used
 *    directly: deterministic, instant, free.
 * 4. Otherwise the AI answers from trusted data, if configured and enabled.
 * 5. If AI is off, times out, fails or produces an unsafe answer, the best rule answer is used,
 *    then the configured fallback message.
 */

const FAQ_HIGH_CONFIDENCE = 0.7;
const FAQ_MEDIUM_CONFIDENCE = 0.4;
const PRODUCT_CONFIDENCE = 0.5;
const AI_FAQ_CONTEXT = 12;
const AI_PRODUCT_CONTEXT = 15;

export interface EngineDependencies {
  ai: { provider: AiProvider; timeoutMs: number } | null;
  maxHistoryMessages: number;
}

interface Candidate {
  text: string;
  intent: Intent;
  source: ChatbotReply["source"];
}

function reply(candidate: Candidate, language: Language, maxLength: number, extra: Partial<ChatbotReply> = {}): ChatbotReply {
  return {
    text: truncate(candidate.text, maxLength),
    intent: candidate.intent,
    source: candidate.source,
    handoff: false,
    language,
    aiModel: null,
    ...extra,
  };
}

function ruleCandidate(input: ChatbotInput, knowledge: Knowledge, language: Language): { candidate: Candidate | null; confident: boolean } {
  const { settings } = knowledge;
  const intent = detectSimpleIntent(input.text);

  if (intent === "greeting") {
    const name = input.customerName ? ` ${input.customerName.split(" ")[0] ?? ""}` : "";
    const greeting = pick(settings.messages.greeting, language).replace("{name}", name.trim());
    return { candidate: { text: greeting, intent, source: "rules" }, confident: true };
  }
  if (intent === "thanks") return { candidate: { text: thanksReply(language), intent, source: "rules" }, confident: true };
  if (intent === "hours") {
    const text = hoursReply(settings, language, input.now);
    if (text) return { candidate: { text, intent, source: "rules" }, confident: true };
  }
  if (intent === "location") {
    const text = locationReply(settings, language);
    if (text) return { candidate: { text, intent, source: "rules" }, confident: true };
  }
  if (intent === "contact") {
    const text = contactReply(settings, language);
    if (text) return { candidate: { text, intent, source: "rules" }, confident: true };
  }

  const bestFaq = rankFaqs(input.text, knowledge.faqs)[0];
  const products = rankProducts(input.text, knowledge.products).filter((entry) => entry.score >= PRODUCT_CONFIDENCE);

  if (bestFaq && bestFaq.score >= FAQ_HIGH_CONFIDENCE) {
    return { candidate: { text: bestFaq.faq.answer, intent: "faq", source: "faq" }, confident: true };
  }
  if (products.length > 0) {
    const text = products.slice(0, 3).map((entry) => describeProduct(entry.product, language)).join("\n\n");
    return { candidate: { text, intent: "product", source: "product" }, confident: (products[0]?.score ?? 0) >= 0.99 };
  }
  if (bestFaq && bestFaq.score >= FAQ_MEDIUM_CONFIDENCE) {
    return { candidate: { text: bestFaq.faq.answer, intent: "faq", source: "faq" }, confident: false };
  }
  return { candidate: null, confident: false };
}

function fallbackReply(knowledge: Knowledge, language: Language, now: Date): Candidate {
  const { settings } = knowledge;
  const open = isOpenNow(settings.businessHours, settings.specialClosures, settings.timezone, now);
  const parts = [pick(settings.messages.fallback, language)];
  if (open === false) parts.push(pick(settings.messages.outOfHours, language));
  return { text: parts.join("\n\n"), intent: "fallback", source: "fallback" };
}

async function aiReply(
  input: ChatbotInput,
  knowledge: Knowledge,
  language: Language,
  deps: EngineDependencies,
): Promise<ChatbotReply | null> {
  if (!deps.ai || !knowledge.settings.aiEnabled) return null;

  // Most relevant trusted data first; small catalogues are sent whole.
  const faqs =
    knowledge.faqs.length <= AI_FAQ_CONTEXT
      ? knowledge.faqs
      : rankFaqs(input.text, knowledge.faqs).slice(0, AI_FAQ_CONTEXT).map((entry) => entry.faq);
  const products =
    knowledge.products.length <= AI_PRODUCT_CONTEXT
      ? knowledge.products
      : rankProducts(input.text, knowledge.products).slice(0, AI_PRODUCT_CONTEXT).map((entry) => entry.product);

  const maxLength = knowledge.settings.maxResponseLength;
  try {
    const result = await deps.ai.provider.generate({
      system: buildSystemPrompt(knowledge.settings, faqs, products, language, input.now),
      messages: buildMessages(input, deps.maxHistoryMessages),
      maxOutputTokens: Math.min(1024, Math.ceil(maxLength / 2.5) + 64),
      timeoutMs: deps.ai.timeoutMs,
    });

    // Prices are checked against the full catalogue, not just the subset sent to the model.
    const checked = checkModelOutput(result.text, knowledge.products);
    if (!checked.ok) {
      logger.warn("chatbot.ai_output_rejected", { reason: checked.reason, model: result.model });
      return null;
    }

    if (checked.handoff) {
      const handoffText = [checked.text, pick(knowledge.settings.messages.handoff, language)].filter(Boolean).join("\n\n");
      return reply({ text: handoffText, intent: "human", source: "ai" }, language, maxLength, { handoff: true, aiModel: result.model });
    }
    return reply({ text: checked.text, intent: "ai", source: "ai" }, language, maxLength, { aiModel: result.model });
  } catch (error) {
    const kind = error instanceof AiProviderError ? error.kind : "unexpected";
    logger.warn("chatbot.ai_failed", { kind, provider: deps.ai.provider.name, error });
    return null;
  }
}

export async function generateReply(input: ChatbotInput, knowledge: Knowledge, deps: EngineDependencies): Promise<ChatbotReply> {
  const language = detectLanguage(input.text);
  const maxLength = knowledge.settings.maxResponseLength;

  if (isInjectionAttempt(input.text)) {
    return reply({ text: injectionReply(language), intent: "injection", source: "policy" }, language, maxLength);
  }

  if (detectSimpleIntent(input.text) === "human") {
    return reply(
      { text: pick(knowledge.settings.messages.handoff, language), intent: "human", source: "rules" },
      language,
      maxLength,
      { handoff: true },
    );
  }

  const rules = ruleCandidate(input, knowledge, language);
  if (rules.candidate && rules.confident) return reply(rules.candidate, language, maxLength);

  const ai = await aiReply(input, knowledge, language, deps);
  if (ai) return ai;

  return reply(rules.candidate ?? fallbackReply(knowledge, language, input.now), language, maxLength);
}
