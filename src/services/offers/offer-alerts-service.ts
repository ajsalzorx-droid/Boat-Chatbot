import "server-only";

import { isDuplicateKeyError } from "@/lib/db/errors";
import { connectToDatabase } from "@/lib/db/mongoose";
import { logger } from "@/lib/logging/logger";
import { WhatsAppClient } from "@/lib/whatsapp/client";
import type { TemplateRef } from "@/models/company-settings";
import { Conversation } from "@/models/conversation";
import { OfferBroadcast, type OfferBroadcastDoc } from "@/models/offer-broadcast";
import { createJob } from "@/services/jobs/job-service";
import { dispatchJob } from "@/services/jobs/queue";
import type { CurrentOffer } from "@/services/knowledge/website-catalog";
import { loadCurrentWebsiteOffers } from "@/services/knowledge/website-db";
import { createOutboundMessage } from "@/services/messages/outbound-service";
import { getSettings } from "@/services/settings/settings-service";

/**
 * Offer alerts: announces each new website offer once to every customer who subscribed
 * (OFFERS ON). Runs from the scheduled recovery job and from the dashboard.
 *
 * Messages to customers go out as an approved Marketing template, since most subscribers are
 * outside the 24-hour customer service window. Each send is a queued outbound message with its
 * own job, so it is retried safely and consent is checked again right before sending.
 */

export interface OfferAlertsReport {
  offersFound: number;
  announced: number;
  waiting: number;
  messagesQueued: number;
}

export interface OfferAlertsDeps {
  loadOffers: () => Promise<CurrentOffer[] | null>;
  /** Meta's approval status for the template, or null when it does not exist. */
  templateStatus: (template: TemplateRef) => Promise<string | null>;
}

const defaultDeps: OfferAlertsDeps = {
  loadOffers: loadCurrentWebsiteOffers,
  templateStatus: async (template) => (await new WhatsAppClient().getTemplate(template.name, template.languageCode))?.status ?? null,
};

async function setWaiting(broadcast: OfferBroadcastDoc, note: string): Promise<void> {
  await OfferBroadcast.updateOne({ _id: broadcast._id, status: "waiting" }, { $set: { note } });
}

/** Returns the number of messages queued, or null when the offer has to wait. */
async function announce(broadcast: OfferBroadcastDoc, template: TemplateRef | null, deps: OfferAlertsDeps): Promise<number | null> {
  if (!broadcast.bannerUrl) {
    await OfferBroadcast.updateOne({ _id: broadcast._id, status: "waiting" }, { $set: { status: "skipped", note: "The offer has no banner image on the website." } });
    return 0;
  }
  if (!template) {
    await setWaiting(broadcast, "Add the offer template under Settings → Offer alerts.");
    return null;
  }

  const subscribers = await Conversation.find({ offersOptIn: true, optedOut: false }).lean();
  if (subscribers.some((conversation) => conversation.channel === "whatsapp")) {
    let status: string | null;
    try {
      status = await deps.templateStatus(template);
    } catch (error) {
      logger.warn("offers.template_check_failed", { error });
      await setWaiting(broadcast, "Could not check the template with WhatsApp; will retry.");
      return null;
    }
    if (status !== "APPROVED") {
      await setWaiting(broadcast, `Template "${template.name}" (${template.languageCode}) is ${status ? status.toLowerCase() : "not found"} on WhatsApp.`);
      return null;
    }
  }

  // Claim first, so two runs at the same moment cannot both announce the offer.
  const claimed = await OfferBroadcast.findOneAndUpdate(
    { _id: broadcast._id, status: "waiting" },
    { $set: { status: "sent", note: null, sentAt: new Date(), recipients: subscribers.length } },
    { returnDocument: "after", lean: true },
  );
  if (!claimed) return 0;

  let queued = 0;
  for (const conversation of subscribers) {
    const { message, created } = await createOutboundMessage({
      conversation,
      sender: "system",
      text: `🎉 ${broadcast.title}: ${broadcast.percent}% off, until ${broadcast.validUntil}`,
      template: {
        name: template.name,
        languageCode: template.languageCode,
        headerImageUrl: broadcast.bannerUrl,
        bodyParameters: [broadcast.title, String(broadcast.percent), broadcast.validUntil],
      },
      // One alert per customer per offer, however often this runs.
      clientRequestId: `offer:${broadcast._id.toString()}`,
    });
    if (!created) continue;
    const { job } = await createJob({ type: "outbound_message", idempotencyKey: `outbound:${message._id.toString()}`, payload: { messageId: message._id, conversationId: conversation._id } });
    await dispatchJob(job._id);
    queued += 1;
  }
  return queued;
}

/** Null when offer alerts are switched off or the website database is not available. */
export async function runOfferAlerts(deps: OfferAlertsDeps = defaultDeps): Promise<OfferAlertsReport | null> {
  await connectToDatabase();
  const settings = await getSettings();
  if (!settings.offerAlerts.enabled) return null;
  const offers = await deps.loadOffers();
  if (!offers) return null;

  for (const offer of offers) {
    try {
      await OfferBroadcast.updateOne(
        { offerKey: offer.key },
        { $setOnInsert: { title: offer.title, percent: offer.percent, bannerUrl: offer.bannerUrl, validUntil: offer.validUntil, status: "waiting" } },
        { upsert: true },
      );
    } catch (error) {
      // A parallel run inserted it first.
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  const report: OfferAlertsReport = { offersFound: offers.length, announced: 0, waiting: 0, messagesQueued: 0 };
  const waiting = await OfferBroadcast.find({ offerKey: { $in: offers.map((offer) => offer.key) }, status: "waiting" }).lean();
  for (const broadcast of waiting) {
    const queued = await announce(broadcast, settings.offerAlerts.template, deps);
    if (queued === null) report.waiting += 1;
    else {
      report.announced += 1;
      report.messagesQueued += queued;
    }
  }
  if (report.announced > 0 || report.waiting > 0) logger.info("offers.alerts_run", { ...report });
  return report;
}
