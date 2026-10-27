import "server-only";

import type { Types } from "mongoose";

import { logger } from "@/lib/logging/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { customerServiceWindow } from "@/lib/whatsapp/policy";
import { Conversation } from "@/models/conversation";
import { Message, type MessageDoc } from "@/models/message";
import { getAiProvider } from "@/providers/ai";
import { generateReply } from "@/services/chatbot/engine";
import { pick } from "@/services/chatbot/rules";
import { containsPhrase, detectLanguage, normalize } from "@/services/chatbot/text";
import type { ChatbotReply, HistoryTurn } from "@/services/chatbot/types";
import { requestHandoff, setOptOut } from "@/services/conversations/conversation-service";
import { loadKnowledge } from "@/services/knowledge/knowledge-service";
import { createOutboundMessage, deliverOutboundMessage } from "@/services/messages/outbound-service";
import { getSettings, toBotSettings } from "@/services/settings/settings-service";

/**
 * Handles one stored inbound message: decides whether and how the bot replies, then delivers the
 * reply. Safe to run more than once for the same message: at most one bot reply can ever exist
 * (unique `botReplyTo`), and a reply already sent is never sent again.
 */

export type InboundOutcome =
  | "replied"
  | "already_replied"
  | "no_reply_bot_disabled"
  | "no_reply_opted_out"
  | "no_reply_window_closed"
  | "no_reply_staff_replied"
  | "no_reply_staff_active"
  | "reply_failed";

const AI_CALLS_PER_WINDOW = 20;
const AI_WINDOW_SECONDS = 10 * 60;

function isKeywordOnly(text: string, keywords: readonly string[]): boolean {
  const normalised = normalize(text);
  return normalised.length > 0 && normalised.length <= 20 && containsPhrase(normalised, keywords) && normalised.split(" ").length <= 2;
}

function unsupportedReply(language: "en" | "ar"): string {
  return language === "ar"
    ? "شكراً لرسالتك! حالياً يمكنني قراءة الرسائل النصية فقط. يرجى كتابة سؤالك وسأساعدك."
    : "Thanks for your message! I can only read text messages at the moment. Please type your question and I'll help.";
}

async function loadHistory(conversationId: Types.ObjectId, beforeMessageId: Types.ObjectId, limit: number): Promise<HistoryTurn[]> {
  if (limit <= 0) return [];
  const recent = await Message.find({ conversationId, _id: { $lt: beforeMessageId }, type: "text", text: { $ne: null } })
    .sort({ _id: -1 })
    .limit(limit)
    .select({ direction: 1, text: 1 })
    .lean();
  return recent.reverse().map((message) => ({
    role: message.direction === "inbound" ? "customer" : "business",
    text: message.text ?? "",
  }));
}

async function deliver(message: MessageDoc): Promise<InboundOutcome> {
  if (message.status !== "pending") return "already_replied";
  const result = await deliverOutboundMessage(message._id);
  return result.status === "failed" ? "reply_failed" : "replied";
}

export async function processInboundMessage(messageId: Types.ObjectId): Promise<InboundOutcome> {
  const inbound = await Message.findById(messageId).lean();
  if (!inbound || inbound.direction !== "inbound") throw new Error("Inbound message not found");
  const replyKey = inbound.whatsappMessageId ?? inbound._id.toString();

  // Retry path: a reply record already exists, so only (re)deliver it.
  const existingReply = await Message.findOne({ botReplyTo: replyKey }).lean();
  if (existingReply) return deliver(existingReply);

  const conversation = await Conversation.findById(inbound.conversationId).lean();
  if (!conversation) throw new Error("Conversation not found for inbound message");
  const settings = await getSettings();
  const text = inbound.text ?? "";
  const language = detectLanguage(text);
  const log = logger.child({ conversationId: conversation._id.toString(), inboundId: inbound._id.toString() });

  // Policy: only reply while the customer service window is open (a very late retry may not be).
  if (conversation.channel === "whatsapp" && !customerServiceWindow(conversation.lastInboundAt).open) {
    log.warn("inbound.window_closed_no_reply");
    return "no_reply_window_closed";
  }

  // Opt-out / opt-in keywords are honoured even when the bot is paused.
  if (inbound.type === "text" && isKeywordOnly(text, settings.messaging.optOutKeywords)) {
    await setOptOut(conversation._id, true);
    const { message } = await createOutboundMessage({
      conversation,
      sender: "system",
      text: pick(settings.messages.optOut, language),
      botReplyTo: replyKey,
      botMeta: { source: "policy", intent: "opt_out", aiModel: null },
    });
    return deliver(message);
  }
  if (inbound.type === "text" && isKeywordOnly(text, settings.messaging.optInKeywords) && conversation.optedOut) {
    await setOptOut(conversation._id, false);
    const { message } = await createOutboundMessage({
      conversation: { ...conversation, optedOut: false },
      sender: "system",
      text: pick(settings.messages.optIn, language),
      botReplyTo: replyKey,
      botMeta: { source: "policy", intent: "opt_in", aiModel: null },
    });
    return deliver(message);
  }

  if (conversation.optedOut) return "no_reply_opted_out";
  if (!settings.botEnabled || !conversation.botEnabled || conversation.status === "needs_human") {
    return "no_reply_bot_disabled";
  }

  // Staff answered this message already (dashboard or WhatsApp Business app): one reply is enough.
  const staffReplied = await Message.exists({
    conversationId: conversation._id,
    direction: "outbound",
    sender: { $in: ["agent", "business_app"] },
    createdAt: { $gte: inbound.createdAt },
  });
  if (staffReplied) {
    log.info("inbound.staff_replied_no_bot_reply");
    return "no_reply_staff_replied";
  }
  // Staff is in the middle of this chat (staff-first mode): let them continue without the bot.
  if (settings.humanFirst.enabled && conversation.humanActiveUntil && conversation.humanActiveUntil.getTime() > Date.now()) {
    log.info("inbound.staff_active_no_bot_reply");
    return "no_reply_staff_active";
  }

  let reply: ChatbotReply;
  if (inbound.type !== "text") {
    reply = { text: unsupportedReply(language), intent: "fallback", source: "rules", handoff: false, language, aiModel: null };
  } else {
    const knowledge = await loadKnowledge();
    // Per-customer AI budget: a flooding sender still gets rule/FAQ replies, but cannot run up AI cost.
    const aiBudget = await consumeRateLimit("ai-per-conversation", conversation._id.toString(), AI_CALLS_PER_WINDOW, AI_WINDOW_SECONDS);
    if (!aiBudget.allowed) log.warn("inbound.ai_rate_limited");
    const ai = aiBudget.allowed ? getAiProvider() : null;
    reply = await generateReply(
      {
        text,
        history: await loadHistory(conversation._id, inbound._id, settings.ai.maxHistoryMessages),
        customerName: conversation.displayName,
        now: new Date(),
      },
      { settings: toBotSettings(settings), ...knowledge },
      { ai, maxHistoryMessages: settings.ai.maxHistoryMessages },
    );
  }

  const { message, created } = await createOutboundMessage({
    conversation,
    sender: "bot",
    text: reply.text,
    botReplyTo: replyKey,
    botMeta: { source: reply.source, intent: reply.intent, aiModel: reply.aiModel },
  });
  if (created && reply.handoff) await requestHandoff(conversation._id);
  log.info("inbound.reply_prepared", { source: reply.source, intent: reply.intent, handoff: reply.handoff });
  return deliver(message);
}
