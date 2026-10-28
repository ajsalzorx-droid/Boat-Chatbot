import { normalize } from "./text";
import type { Language } from "./types";

/**
 * Keywords customers send to subscribe to offer alerts or stop them. Subscribing is an explicit
 * opt-in, which WhatsApp requires before a business sends marketing messages. STOP (the general
 * opt-out) also ends offer alerts.
 */
export const OFFER_ALERTS_ON_KEYWORD = "OFFERS ON";
export const OFFER_ALERTS_OFF_KEYWORD = "OFFERS OFF";

const ON_KEYWORDS = ["offers on", "offer on", "عروض نعم"].map(normalize);
// "stop promotions" is the label of WhatsApp's marketing opt-out button on templates.
const OFF_KEYWORDS = ["offers off", "offer off", "stop promotions", "عروض لا", "إيقاف العروض الترويجية"].map(normalize);

export function offerAlertsCommand(normalizedText: string): "on" | "off" | null {
  if (ON_KEYWORDS.includes(normalizedText)) return "on";
  if (OFF_KEYWORDS.includes(normalizedText)) return "off";
  return null;
}

export function offerAlertsReply(command: "on" | "off", language: Language): string {
  if (command === "on") {
    return language === "ar"
      ? `✅ تم الاشتراك! سنرسل لك عروضنا الجديدة هنا على واتساب. أرسل ${OFFER_ALERTS_OFF_KEYWORD} لإيقافها في أي وقت.`
      : `✅ You're subscribed! We'll send our new offers here on WhatsApp. Reply ${OFFER_ALERTS_OFF_KEYWORD} anytime to stop.`;
  }
  return language === "ar"
    ? `تم إيقاف رسائل العروض. أرسل ${OFFER_ALERTS_ON_KEYWORD} للاشتراك مرة أخرى.`
    : `Offer alerts are off. Reply ${OFFER_ALERTS_ON_KEYWORD} anytime to get them again.`;
}

/** Appended to answers about offers while alerts are on, so customers learn how to subscribe. */
export function offerAlertsHint(keyword: string, language: Language): string {
  return language === "ar" ? `📣 أرسل ${keyword} لتصلك العروض الجديدة على واتساب.` : `📣 Reply ${keyword} to get new offers here on WhatsApp.`;
}
