import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { signMetaPayload } from "@/lib/whatsapp/signature";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { OfferBroadcast } from "@/models/offer-broadcast";
import type { CurrentOffer } from "@/services/knowledge/website-catalog";
import { setChannelSenderForTests } from "@/services/messages/channel-sender";
import { runOfferAlerts, type OfferAlertsDeps } from "@/services/offers/offer-alerts-service";
import { updateSettings } from "@/services/settings/settings-service";

import { clearDatabase, startTestDatabase, stopTestDatabase } from "../helpers/db";
import { FakeSender, inboundPayload, setWhatsAppEnv, TEST_APP_SECRET } from "../helpers/fixtures";

let sender: FakeSender;

async function deliver(payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  await POST(
    new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signMetaPayload(body, TEST_APP_SECRET) },
      body,
    }),
  );
}

const OFFER: CurrentOffer = { key: "dubai fest|2026-10-25|2026-10-26", title: "Dubai Fest", percent: 50, bannerUrl: "https://img.example.com/fest.jpg", validUntil: "2026-10-26" };

function deps(overrides: Partial<OfferAlertsDeps> = {}): OfferAlertsDeps {
  return { loadOffers: () => Promise.resolve([OFFER]), templateStatus: () => Promise.resolve("APPROVED"), ...overrides };
}

async function subscribe(from: string, id: string): Promise<void> {
  await deliver(inboundPayload({ messageId: id, from, text: "OFFERS ON" }));
}

beforeAll(async () => {
  setWhatsAppEnv();
  await startTestDatabase();
});

afterAll(async () => {
  setChannelSenderForTests("whatsapp", null);
  await stopTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await clearDatabase();
  sender = new FakeSender();
  setChannelSenderForTests("whatsapp", sender);
  await updateSettings({ companyName: "Boat", offerAlerts: { enabled: true, template: { name: "new_offer_alert", languageCode: "en" } } });
});

describe("subscribing", () => {
  it("OFFERS ON subscribes with a confirmation; OFFERS OFF and STOP unsubscribe", async () => {
    await subscribe("971500000001", "wamid.S.1");
    expect(await Conversation.findOne().lean()).toMatchObject({ offersOptIn: true });
    expect(sender.sent[0]?.body).toContain("subscribed");

    await deliver(inboundPayload({ messageId: "wamid.S.2", text: "offers off" }));
    expect(await Conversation.findOne().lean()).toMatchObject({ offersOptIn: false });

    await subscribe("971500000001", "wamid.S.3");
    await deliver(inboundPayload({ messageId: "wamid.S.4", text: "STOP" }));
    expect(await Conversation.findOne().lean()).toMatchObject({ offersOptIn: false, optedOut: true });
  });

  it("does not subscribe while offer alerts are switched off", async () => {
    await updateSettings({ offerAlerts: { enabled: false, template: null } });
    await subscribe("971500000001", "wamid.S.5");
    // Conversations created by the webhook upsert carry no field until it is set.
    expect((await Conversation.findOne().lean())?.offersOptIn).toBeFalsy();
  });
});

describe("announcing offers", () => {
  it("sends the banner template once to each subscriber and never to others", async () => {
    await subscribe("971500000001", "wamid.A.1");
    await subscribe("971500000002", "wamid.A.2");
    await deliver(inboundPayload({ messageId: "wamid.A.3", from: "971500000003", text: "Hi" }));
    sender.sent = [];

    expect(await runOfferAlerts(deps())).toMatchObject({ offersFound: 1, announced: 1, messagesQueued: 2 });
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent.map((sent) => sent.to).sort()).toEqual(["971500000001", "971500000002"]);
    expect(sender.sent[0]).toMatchObject({ template: "new_offer_alert", image: "https://img.example.com/fest.jpg", body: "Dubai Fest | 50 | 2026-10-26" });
    expect(await OfferBroadcast.findOne().lean()).toMatchObject({ status: "sent", recipients: 2 });

    // Later runs see the same offer: nothing is sent again.
    expect(await runOfferAlerts(deps())).toMatchObject({ announced: 0, messagesQueued: 0 });
    expect(sender.sent).toHaveLength(2);
  });

  it("waits while the template is not approved, then sends once it is", async () => {
    await subscribe("971500000001", "wamid.W.1");
    sender.sent = [];

    expect(await runOfferAlerts(deps({ templateStatus: () => Promise.resolve("PENDING") }))).toMatchObject({ waiting: 1, messagesQueued: 0 });
    const waiting = await OfferBroadcast.findOne().lean();
    expect(waiting?.status).toBe("waiting");
    expect(waiting?.note).toContain("pending");
    expect(sender.sent).toHaveLength(0);

    expect(await runOfferAlerts(deps())).toMatchObject({ announced: 1, messagesQueued: 1 });
    expect(sender.sent).toHaveLength(1);
  });

  it("skips customers who unsubscribed after the alert was queued", async () => {
    await subscribe("971500000001", "wamid.U.1");
    sender.sent = [];
    // Queue without delivering, as if the worker had not run yet.
    await Conversation.updateOne({}, { $set: { offersOptIn: true } });
    const queued = vi.spyOn(await import("@/services/jobs/queue"), "dispatchJob").mockResolvedValue(undefined);
    await runOfferAlerts(deps());
    queued.mockRestore();
    await deliver(inboundPayload({ messageId: "wamid.U.2", text: "Stop promotions" }));
    sender.sent = [];

    const { deliverQueuedOutbound } = await import("@/services/messages/outbound-service");
    const alert = await Message.findOne({ clientRequestId: { $regex: "^offer:" } }).lean();
    expect(await deliverQueuedOutbound(alert!._id)).toBe("skipped_unsubscribed");
    expect(sender.sent).toHaveLength(0);
  });

  it("does nothing while offer alerts are off", async () => {
    await updateSettings({ offerAlerts: { enabled: false, template: null } });
    expect(await runOfferAlerts(deps())).toBeNull();
    expect(await OfferBroadcast.countDocuments()).toBe(0);
  });
});
