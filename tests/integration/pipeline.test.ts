import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/webhooks/whatsapp/route";
import { WhatsAppApiError } from "@/lib/whatsapp/client";
import { signMetaPayload } from "@/lib/whatsapp/signature";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { ProcessingJob } from "@/models/processing-job";
import { WebhookEvent } from "@/models/webhook-event";
import { updateConversation } from "@/services/conversations/conversation-service";
import { setChannelSenderForTests } from "@/services/messages/channel-sender";
import { sendAgentReply } from "@/services/messages/outbound-service";
import { requeueJob } from "@/services/jobs/job-service";
import { runJob } from "@/services/jobs/queue";
import { reapplyUnmatchedStatuses } from "@/services/webhooks/ingest-service";
import { updateSettings } from "@/services/settings/settings-service";

import { clearDatabase, startTestDatabase, stopTestDatabase } from "../helpers/db";
import { echoPayload, FakeSender, historyPayload, inboundPayload, setWhatsAppEnv, statusPayload, TEST_APP_SECRET } from "../helpers/fixtures";

let sender: FakeSender;

function webhookRequest(payload: unknown, options: { signature?: string } = {}): NextRequest {
  const body = JSON.stringify(payload);
  return new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": options.signature ?? signMetaPayload(body, TEST_APP_SECRET) },
    body,
  });
}

async function deliver(payload: unknown): Promise<number> {
  return (await POST(webhookRequest(payload))).status;
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
  await updateSettings({ companyName: "Desert Bloom" });
});

describe("webhook verification (GET)", () => {
  it("returns the exact challenge for the right verify token only", async () => {
    const ok = GET(new NextRequest(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${"v".repeat(48)}&hub.challenge=1158201444`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");

    const wrong = GET(new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"));
    expect(wrong.status).toBe(403);
    const missingMode = GET(new NextRequest(`http://localhost/api/webhooks/whatsapp?hub.verify_token=${"v".repeat(48)}&hub.challenge=1`));
    expect(missingMode.status).toBe(403);
  });
});

describe("inbound message pipeline", () => {
  it("stores the message, processes the job and sends exactly one bot reply", async () => {
    expect(await deliver(inboundPayload({ messageId: "wamid.IN.1", text: "Hi" }))).toBe(200);

    const conversation = await Conversation.findOne({ customerKey: "971500000001" }).lean();
    expect(conversation).toMatchObject({ channel: "whatsapp", displayName: "Aisha", status: "open" });
    const messages = await Message.find({ conversationId: conversation?._id }).sort({ createdAt: 1 }).lean();
    expect(messages.map((message) => [message.direction, message.status])).toEqual([
      ["inbound", "received"],
      ["outbound", "accepted"],
    ]);
    expect(messages[1]).toMatchObject({ whatsappMessageId: "wamid.OUT.1", sender: "bot", botReplyTo: "wamid.IN.1" });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ to: "971500000001", template: null });
    expect(sender.sent[0]?.body).toContain("Hello Aisha");
    expect(await ProcessingJob.findOne({ idempotencyKey: "inbound:wamid.IN.1" }).lean()).toMatchObject({ status: "done", attempts: 1 });
    expect(await WebhookEvent.findOne({ eventKey: "message:wamid.IN.1" }).lean()).toMatchObject({ status: "queued" });
  });

  it("ignores duplicate webhook deliveries: no second message, job or reply", async () => {
    const payload = inboundPayload({ messageId: "wamid.IN.2", text: "Hi" });
    expect(await deliver(payload)).toBe(200);
    expect(await deliver(payload)).toBe(200);
    expect(await deliver(payload)).toBe(200);
    expect(await Message.countDocuments({ direction: "inbound" })).toBe(1);
    expect(await ProcessingJob.countDocuments()).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(await WebhookEvent.findOne({ eventKey: "message:wamid.IN.2" }).lean()).toMatchObject({ attempts: 3 });
  });

  it("handles concurrent deliveries of the same message without duplicates", async () => {
    const payload = inboundPayload({ messageId: "wamid.IN.3", text: "Hi" });
    const statuses = await Promise.all(Array.from({ length: 6 }, () => deliver(payload)));
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(await Conversation.countDocuments()).toBe(1);
    expect(await Message.countDocuments({ direction: "inbound" })).toBe(1);
    expect(await Message.countDocuments({ direction: "outbound" })).toBe(1);
    expect(sender.sent).toHaveLength(1);
  });

  it("keeps concurrent messages from one customer in one conversation", async () => {
    await Promise.all(["a", "b", "c"].map((suffix) => deliver(inboundPayload({ messageId: `wamid.IN.4${suffix}`, text: "Hi" }))));
    expect(await Conversation.countDocuments()).toBe(1);
    expect(await Message.countDocuments({ direction: "inbound" })).toBe(3);
  });

  it("rejects an invalid signature and stores nothing", async () => {
    const response = await POST(webhookRequest(inboundPayload({ messageId: "wamid.IN.5" }), { signature: `sha256=${"0".repeat(64)}` }));
    expect(response.status).toBe(401);
    expect(await Message.countDocuments()).toBe(0);
  });

  it("rejects malformed JSON and acknowledges authentic but unusable payloads", async () => {
    const raw = "{not json";
    const bad = await POST(
      new NextRequest("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signMetaPayload(raw, TEST_APP_SECRET) }, body: raw }),
    );
    expect(bad.status).toBe(400);
    expect(await deliver({ object: "page", entry: [] })).toBe(200);
    expect(await Message.countDocuments()).toBe(0);
  });

  it("ignores events for a different business phone number", async () => {
    expect(await deliver(inboundPayload({ messageId: "wamid.IN.6", phoneNumberId: "999999999999" }))).toBe(200);
    expect(await Message.countDocuments()).toBe(0);
    expect(await WebhookEvent.findOne({ whatsappMessageId: "wamid.IN.6" }).lean()).toMatchObject({ status: "ignored" });
  });
});

describe("delivery status updates", () => {
  async function botReplyId(): Promise<string> {
    await deliver(inboundPayload({ messageId: "wamid.IN.S", text: "Hi" }));
    const reply = await Message.findOne({ direction: "outbound" }).lean();
    return reply?.whatsappMessageId ?? "";
  }

  it("moves forward only, even when events arrive out of order or twice", async () => {
    const id = await botReplyId();
    const t = Math.floor(Date.now() / 1000);
    await deliver(statusPayload({ messageId: id, status: "delivered", timestamp: t + 2 }));
    await deliver(statusPayload({ messageId: id, status: "sent", timestamp: t + 1 }));
    expect(await Message.findOne({ whatsappMessageId: id }).lean()).toMatchObject({ status: "delivered" });

    await deliver(statusPayload({ messageId: id, status: "read", timestamp: t + 3 }));
    await deliver(statusPayload({ messageId: id, status: "delivered", timestamp: t + 2 }));
    await deliver(statusPayload({ messageId: id, status: "failed", timestamp: t + 4, errors: [{ code: 131026, title: "Undeliverable" }] }));
    const message = await Message.findOne({ whatsappMessageId: id }).lean();
    expect(message).toMatchObject({ status: "read", error: null });
    expect(message?.statusTimestamps.sentAt?.getTime()).toBe((t + 1) * 1000);
    expect(message?.statusTimestamps.deliveredAt?.getTime()).toBe((t + 2) * 1000);
  });

  it("records failures with their error code", async () => {
    const id = await botReplyId();
    await deliver(statusPayload({ messageId: id, status: "failed", errors: [{ code: 131031, title: "Business Account locked", error_data: { details: "locked" } }] }));
    expect(await Message.findOne({ whatsappMessageId: id }).lean()).toMatchObject({
      status: "failed",
      error: { code: 131031, title: "Business Account locked", details: "locked" },
    });
  });

  it("keeps statuses that arrive before their message and applies them later", async () => {
    await deliver(statusPayload({ messageId: "wamid.EARLY", status: "delivered" }));
    expect(await WebhookEvent.findOne({ eventKey: "status:wamid.EARLY:delivered" }).lean()).toMatchObject({ status: "unmatched" });

    const conversation = await Conversation.create({ channel: "whatsapp", customerKey: "971500000009", waId: "971500000009" });
    await Message.create({
      conversationId: conversation._id,
      channel: "whatsapp",
      direction: "outbound",
      sender: "agent",
      type: "text",
      text: "x",
      status: "accepted",
      whatsappMessageId: "wamid.EARLY",
    });
    expect(await reapplyUnmatchedStatuses()).toBe(1);
    expect(await Message.findOne({ whatsappMessageId: "wamid.EARLY" }).lean()).toMatchObject({ status: "delivered" });
  });
});

describe("retries, dead letters and safe resends", () => {
  it("retries transient WhatsApp errors and sends the same reply once it recovers", async () => {
    sender.failWith = new WhatsAppApiError("rate limited", { httpStatus: 429, graphCode: 130429, graphSubcode: null, fbtraceId: null, retryable: true });
    await deliver(inboundPayload({ messageId: "wamid.IN.R", text: "Hi" }));

    const job = await ProcessingJob.findOne().lean();
    expect(job).toMatchObject({ status: "retry_scheduled", attempts: 1, lastError: { retryable: true } });
    expect(await Message.findOne({ direction: "outbound" }).lean()).toMatchObject({ status: "pending" });

    sender.failWith = null;
    await ProcessingJob.updateOne({ _id: job?._id }, { $set: { runAt: new Date(Date.now() - 1000) } });
    expect(await runJob(job!._id)).toBe("done");
    expect(sender.sent).toHaveLength(1);
    expect(await Message.countDocuments({ direction: "outbound" })).toBe(1);
  });

  it("dead-letters a job after the final attempt and allows a controlled requeue", async () => {
    sender.failWith = new WhatsAppApiError("down", { httpStatus: 503, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: true });
    await deliver(inboundPayload({ messageId: "wamid.IN.D", text: "Hi" }));
    const job = await ProcessingJob.findOne().lean();
    await ProcessingJob.updateOne({ _id: job?._id }, { $set: { attempts: 5, runAt: new Date(0) } });
    expect(await runJob(job!._id)).toBe("dead");

    sender.failWith = null;
    const requeued = await requeueJob(job!._id);
    expect(requeued).toMatchObject({ status: "pending", attempts: 0 });
    expect(await runJob(job!._id)).toBe("done");
    expect(sender.sent).toHaveLength(1);
  });

  it("never resends automatically when the send outcome is unknown (timeout)", async () => {
    sender.failWith = new WhatsAppApiError("timed out", { httpStatus: 0, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: true, deliveryAmbiguous: true });
    await deliver(inboundPayload({ messageId: "wamid.IN.U", text: "Hi" }));
    expect(await Message.findOne({ direction: "outbound" }).lean()).toMatchObject({ status: "unknown" });
    const job = await ProcessingJob.findOne().lean();
    expect(job?.status).toBe("failed");

    sender.failWith = null;
    await requeueJob(job!._id);
    await runJob(job!._id);
    expect(sender.sent).toHaveLength(0);
  });

  it("records permanent errors without retrying", async () => {
    sender.failWith = new WhatsAppApiError("Recipient not allowed", { httpStatus: 400, graphCode: 131030, graphSubcode: null, fbtraceId: null, retryable: false });
    await deliver(inboundPayload({ messageId: "wamid.IN.P", text: "Hi" }));
    expect(await Message.findOne({ direction: "outbound" }).lean()).toMatchObject({ status: "failed", error: { code: 131030 } });
    expect(await ProcessingJob.findOne().lean()).toMatchObject({ status: "failed", attempts: 1 });
  });
});

describe("conversation rules", () => {
  it("honours opt-out and stops replying until the customer opts back in", async () => {
    await deliver(inboundPayload({ messageId: "wamid.O.1", text: "STOP" }));
    expect(await Conversation.findOne().lean()).toMatchObject({ optedOut: true });
    expect(sender.sent.at(-1)?.body).toContain("unsubscribed");

    await deliver(inboundPayload({ messageId: "wamid.O.2", text: "hello" }));
    expect(sender.sent).toHaveLength(1);

    await deliver(inboundPayload({ messageId: "wamid.O.3", text: "START" }));
    expect(await Conversation.findOne().lean()).toMatchObject({ optedOut: false });
    expect(sender.sent).toHaveLength(2);
  });

  it("pauses the bot after a handoff request", async () => {
    await deliver(inboundPayload({ messageId: "wamid.H.1", text: "I want to speak to a real person" }));
    expect(await Conversation.findOne().lean()).toMatchObject({ status: "needs_human", botEnabled: false });
    await deliver(inboundPayload({ messageId: "wamid.H.2", text: "hello?" }));
    expect(sender.sent).toHaveLength(1);
  });

  it("answers again once staff mark the handed-over chat resolved", async () => {
    await deliver(inboundPayload({ messageId: "wamid.R.1", text: "I want to speak to a real person" }));
    const conversation = await Conversation.findOne().lean();
    await updateConversation(conversation!._id, { status: "resolved" });
    expect(await Conversation.findOne().lean()).toMatchObject({ status: "resolved", botEnabled: true, handoffRequestedAt: null });
    await deliver(inboundPayload({ messageId: "wamid.R.2", text: "Hi" }));
    expect(sender.sent).toHaveLength(2);
  });

  it("does not reply when the bot is switched off globally", async () => {
    await updateSettings({ botEnabled: false });
    await deliver(inboundPayload({ messageId: "wamid.B.1", text: "Hi" }));
    expect(sender.sent).toHaveLength(0);
    expect(await Message.countDocuments({ direction: "inbound" })).toBe(1);
  });

  it("does not add a bot reply when staff already answered the message from the dashboard", async () => {
    await updateSettings({ humanFirst: { enabled: true, waitSeconds: 15, pauseMinutes: 0 } });
    await deliver(inboundPayload({ messageId: "wamid.S.1", text: "Hi" }));
    const conversation = (await Conversation.findOne().lean())!;
    await sendAgentReply({ conversation, agentId: conversation._id, text: "Hello, how can I help?", clientRequestId: "33333333-3333-4333-8333-333333333333" });

    const job = (await ProcessingJob.findOne().lean())!;
    await ProcessingJob.updateOne({ _id: job._id }, { $set: { runAt: new Date(Date.now() - 1000) } });
    expect(await runJob(job._id)).toBe("done");
    expect(sender.sent.map((entry) => entry.body)).toEqual(["Hello, how can I help?"]);
  });

  it("blocks free-form staff replies outside the 24-hour window and dedupes double submits", async () => {
    await deliver(inboundPayload({ messageId: "wamid.W.1", text: "Hi" }));
    const conversation = (await Conversation.findOne().lean())!;
    const agentId = conversation._id; // any ObjectId works for the test

    const first = await sendAgentReply({ conversation, agentId, text: "Thanks!", clientRequestId: "11111111-1111-4111-8111-111111111111" });
    const again = await sendAgentReply({ conversation, agentId, text: "Thanks!", clientRequestId: "11111111-1111-4111-8111-111111111111" });
    expect(again._id.toString()).toBe(first._id.toString());
    expect(sender.sent.filter((entry) => entry.body === "Thanks!")).toHaveLength(1);

    const stale = { ...conversation, lastInboundAt: new Date(Date.now() - 25 * 3_600_000) };
    await expect(sendAgentReply({ conversation: stale, agentId, text: "Late", clientRequestId: "22222222-2222-4222-8222-222222222222" })).rejects.toMatchObject({
      httpStatus: 409,
      details: { reason: "window_closed_template_required" },
    });
  });
});

describe("coexistence (WhatsApp Business app on the same number)", () => {
  async function makeJobDue(): Promise<void> {
    await ProcessingJob.updateMany({}, { $set: { runAt: new Date(Date.now() - 1000) } });
  }

  it("stores a message sent from the app as a staff message and tracks its delivery", async () => {
    expect(await deliver(echoPayload({ messageId: "wamid.ECHO.1", to: "971500000002", text: "Your order is ready" }))).toBe(200);
    expect(await deliver(echoPayload({ messageId: "wamid.ECHO.1", to: "971500000002", text: "Your order is ready" }))).toBe(200);

    const conversation = await Conversation.findOne({ customerKey: "971500000002" }).lean();
    expect(conversation).toMatchObject({ channel: "whatsapp", status: "open", lastMessageDirection: "outbound", lastInboundAt: null });
    const messages = await Message.find({ conversationId: conversation?._id }).lean();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "outbound", sender: "business_app", status: "sent", text: "Your order is ready" });
    expect(await ProcessingJob.countDocuments()).toBe(0);
    expect(sender.sent).toHaveLength(0);

    await deliver(statusPayload({ messageId: "wamid.ECHO.1", status: "read" }));
    expect(await Message.findOne({ whatsappMessageId: "wamid.ECHO.1" }).lean()).toMatchObject({ status: "read" });
  });

  it("staff first: the bot waits, then stays quiet when staff answered from the app", async () => {
    await updateSettings({ humanFirst: { enabled: true, waitSeconds: 15, pauseMinutes: 30 } });
    await deliver(inboundPayload({ messageId: "wamid.SF.1", text: "Hi" }));
    const job = (await ProcessingJob.findOne().lean())!;
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    expect(sender.sent).toHaveLength(0);

    await deliver(echoPayload({ messageId: "wamid.SF.ECHO", text: "Hello! Welcome to the shop" }));
    expect((await Conversation.findOne().lean())?.humanActiveUntil?.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

    await makeJobDue();
    expect(await runJob(job._id)).toBe("done");
    expect(sender.sent).toHaveLength(0);

    // A follow-up while staff is active is left to staff as well.
    await deliver(inboundPayload({ messageId: "wamid.SF.2", text: "Do you deliver?" }));
    await makeJobDue();
    await runJob((await ProcessingJob.findOne({ idempotencyKey: "inbound:wamid.SF.2" }).lean())!._id);
    expect(sender.sent).toHaveLength(0);
  });

  it("staff first: the bot answers after the wait when nobody replied", async () => {
    await updateSettings({ humanFirst: { enabled: true, waitSeconds: 15, pauseMinutes: 30 } });
    await deliver(inboundPayload({ messageId: "wamid.SF.3", text: "Hi" }));
    expect(sender.sent).toHaveLength(0);
    await makeJobDue();
    expect(await runJob((await ProcessingJob.findOne().lean())!._id)).toBe("done");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.body).toContain("Hello Aisha");
  });

  it("imports chat history in order without replying or reopening the 24-hour window", async () => {
    const old = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
    const payload = historyPayload({
      customer: "971500000009",
      messages: [
        { id: "wamid.HIST.2", fromBusiness: true, text: "Yes, fresh today", timestamp: old + 60, status: "READ" },
        { id: "wamid.HIST.1", fromBusiness: false, text: "Do you have hammour?", timestamp: old },
      ],
    });
    expect(await deliver(payload)).toBe(200);
    expect(await deliver(payload)).toBe(200);

    const conversation = await Conversation.findOne({ customerKey: "971500000009" }).lean();
    expect(conversation).toMatchObject({ lastInboundAt: null, lastMessagePreview: "Yes, fresh today", lastMessageDirection: "outbound" });
    expect(conversation?.lastMessageAt?.getTime()).toBe((old + 60) * 1000);
    const messages = await Message.find({ conversationId: conversation?._id }).sort({ createdAt: 1 }).lean();
    expect(messages.map((message) => [message.sender, message.status, message.text])).toEqual([
      ["customer", "received", "Do you have hammour?"],
      ["business_app", "read", "Yes, fresh today"],
    ]);
    expect(messages[0]?.createdAt.getTime()).toBe(old * 1000);
    expect(await ProcessingJob.countDocuments()).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });
});
