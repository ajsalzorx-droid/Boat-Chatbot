import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { OfferBroadcast } from "@/models/offer-broadcast";
import { isWebsiteDbConfigured } from "@/services/knowledge/website-db";
import { runOfferAlerts } from "@/services/offers/offer-alerts-service";
import { getSettings } from "@/services/settings/settings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Offer alerts overview: settings, subscriber count and the latest announced offers with delivery counts. */
export const GET = adminRoute("admin", async () => {
  const [settings, subscribers, broadcasts] = await Promise.all([
    getSettings(),
    Conversation.countDocuments({ offersOptIn: true, optedOut: false }),
    OfferBroadcast.find().sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const counts = await Message.aggregate<{ _id: { key: string; status: string }; count: number }>([
    { $match: { clientRequestId: { $in: broadcasts.map((broadcast) => `offer:${broadcast._id.toString()}`) } } },
    { $group: { _id: { key: "$clientRequestId", status: "$status" }, count: { $sum: 1 } } },
  ]);
  return json({
    enabled: settings.offerAlerts.enabled,
    template: settings.offerAlerts.template,
    websiteConnected: isWebsiteDbConfigured(),
    subscribers,
    broadcasts: broadcasts.map((broadcast) => {
      const key = `offer:${broadcast._id.toString()}`;
      const delivery: Record<string, number> = Object.fromEntries(counts.filter((entry) => entry._id.key === key).map((entry) => [entry._id.status, entry.count]));
      return {
        id: broadcast._id.toString(),
        title: broadcast.title,
        percent: broadcast.percent,
        bannerUrl: broadcast.bannerUrl,
        validUntil: broadcast.validUntil,
        status: broadcast.status,
        note: broadcast.note,
        recipients: broadcast.recipients,
        sentAt: broadcast.sentAt?.toISOString() ?? null,
        delivery,
      };
    }),
  });
});

/** Checks for new offers now instead of waiting for the next scheduled run. */
export const POST = adminRoute("admin", async ({ session }) => {
  const report = await runOfferAlerts();
  logger.info("offers.checked_manually", { by: session.user._id.toString() });
  return json({ report });
});
