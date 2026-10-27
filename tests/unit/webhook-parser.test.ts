import { describe, expect, it } from "vitest";

import { parseWebhookPayload } from "@/lib/whatsapp/webhook-parser";

import { echoPayload, historyPayload, inboundPayload, statusPayload, TEST_PHONE_NUMBER_ID } from "../helpers/fixtures";

/** The real "failed" status event Meta sent for this project's test number (error 131031). */
const REAL_FAILED_STATUS = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "1425347453036800",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15556687921", phone_number_id: "1271194902753410" },
            contacts: [{ wa_id: "919000000000", user_id: "IN.1011503765315426" }],
            statuses: [
              {
                id: "wamid.SYNTHETIC-FAILED-STATUS-0001",
                status: "failed",
                timestamp: "1791960525",
                recipient_id: "919000000000",
                recipient_logical_id: "16819125518462",
                recipient_user_id: "IN.1011503765315426",
                errors: [
                  {
                    code: 131031,
                    title: "Business Account locked",
                    message: "Business Account locked",
                    error_data: { details: "Business account has been locked." },
                    href: "https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/",
                  },
                ],
                internal_1p_only_data: { webhook_extra_data: "x" },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

describe("parseWebhookPayload", () => {
  it("parses an inbound text message with the customer's profile", () => {
    const result = parseWebhookPayload(inboundPayload({ messageId: "wamid.1", text: "Do you deliver?", timestamp: 1_700_000_000 }));
    expect(result).toEqual({
      ok: true,
      events: [
        {
          kind: "message",
          phoneNumberId: "123456789012345",
          messageId: "wamid.1",
          customer: { waId: "971500000001", userId: null, profileName: "Aisha" },
          sentAt: new Date(1_700_000_000_000),
          content: { type: "text", body: "Do you deliver?" },
          replyToMessageId: null,
        },
      ],
    });
  });

  it("parses Meta's real failed status event, including the error and user ID", () => {
    const result = parseWebhookPayload(REAL_FAILED_STATUS);
    expect(result.ok && result.events[0]).toEqual({
      kind: "status",
      phoneNumberId: "1271194902753410",
      messageId: "wamid.SYNTHETIC-FAILED-STATUS-0001",
      status: "failed",
      occurredAt: new Date(1_791_960_525_000),
      recipient: { waId: "919000000000", userId: "IN.1011503765315426" },
      errors: [{ code: 131031, title: "Business Account locked", details: "Business account has been locked." }],
    });
  });

  it("parses delivered and read statuses", () => {
    for (const status of ["sent", "delivered", "read"]) {
      const result = parseWebhookPayload(statusPayload({ messageId: "wamid.OUT.1", status }));
      expect(result.ok && result.events[0]).toMatchObject({ kind: "status", status });
    }
  });

  it("marks non-text messages as unsupported content, not as text", () => {
    const payload = inboundPayload({ messageId: "wamid.2" });
    const message = payload.entry[0]!.changes[0]!.value.messages[0]! as Record<string, unknown>;
    message.type = "image";
    delete message.text;
    message.image = { id: "media-id" };
    const result = parseWebhookPayload(payload);
    expect(result.ok && result.events[0]).toMatchObject({ kind: "message", content: { type: "unsupported", originalType: "image" } });
  });

  it("accepts a customer identified only by business-scoped user ID", () => {
    const payload = inboundPayload({ messageId: "wamid.3" });
    const value = payload.entry[0]!.changes[0]!.value as Record<string, unknown>;
    value.contacts = [{ user_id: "AE.123", profile: { name: "No Phone" } }];
    const message = (value.messages as Record<string, unknown>[])[0]!;
    delete message.from;
    message.from_user_id = "AE.123";
    const result = parseWebhookPayload(payload);
    expect(result.ok && result.events[0]).toMatchObject({ customer: { waId: null, userId: "AE.123", profileName: "No Phone" } });
  });

  it("records other webhook fields as unsupported instead of treating them as messages", () => {
    const result = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "account_update", value: { event: "VERIFIED_ACCOUNT" } }] }],
    });
    expect(result).toEqual({ ok: true, events: [{ kind: "unsupported", field: "account_update", reason: "field not handled" }] });
  });

  it("isolates a malformed message without dropping valid ones", () => {
    const payload = inboundPayload({ messageId: "wamid.4" });
    const value = payload.entry[0]!.changes[0]!.value as { messages: unknown[] };
    value.messages.push({ id: "", timestamp: "not-a-number", type: "text" });
    const result = parseWebhookPayload(payload);
    expect(result.ok && result.events.map((event) => event.kind)).toEqual(["message", "unsupported"]);
  });

  it("rejects payloads that are not WhatsApp or have the wrong structure", () => {
    expect(parseWebhookPayload({ object: "page", entry: [] })).toEqual({ ok: false, reason: "not_whatsapp" });
    expect(parseWebhookPayload({ hello: "world" })).toEqual({ ok: false, reason: "invalid_structure" });
    expect(parseWebhookPayload(null)).toEqual({ ok: false, reason: "invalid_structure" });
    expect(parseWebhookPayload({ object: "whatsapp_business_account", entry: "x" })).toEqual({ ok: false, reason: "invalid_structure" });
  });

  it("does not track unknown status values", () => {
    const result = parseWebhookPayload(statusPayload({ messageId: "wamid.OUT.1", status: "deleted" }));
    expect(result.ok && result.events[0]).toMatchObject({ kind: "unsupported", field: "statuses" });
  });
});

describe("coexistence webhooks", () => {
  it("parses a message staff sent from the WhatsApp Business app", () => {
    const result = parseWebhookPayload(echoPayload({ messageId: "wamid.ECHO.1", to: "971500000002", text: "We open at 9", timestamp: 1_790_000_000 }));
    expect(result).toEqual({
      ok: true,
      events: [
        {
          kind: "echo",
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          messageId: "wamid.ECHO.1",
          customer: { waId: "971500000002", userId: null },
          sentAt: new Date(1_790_000_000_000),
          content: { type: "text", body: "We open at 9" },
        },
      ],
    });
  });

  it("parses chat history and tells business messages from customer messages", () => {
    const result = parseWebhookPayload(
      historyPayload({
        customer: "971500000009",
        messages: [
          { id: "wamid.H.1", fromBusiness: false, text: "Do you have lobster?", timestamp: 1_780_000_000 },
          { id: "wamid.H.2", fromBusiness: true, text: "Yes, today!", timestamp: 1_780_000_060, status: "DELIVERED" },
        ],
      }),
    );
    expect(result.ok && result.events).toMatchObject([
      { kind: "history", messageId: "wamid.H.1", customer: { waId: "971500000009" }, fromBusiness: false, deliveryStatus: null, content: { body: "Do you have lobster?" } },
      { kind: "history", messageId: "wamid.H.2", fromBusiness: true, deliveryStatus: "delivered" },
    ]);
  });

  it("reports declined history sharing instead of failing", () => {
    const result = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "history",
              value: { messaging_product: "whatsapp", metadata: { phone_number_id: TEST_PHONE_NUMBER_ID }, history: [{ errors: [{ code: 2593109, title: "declined" }] }] },
            },
          ],
        },
      ],
    });
    expect(result).toEqual({ ok: true, events: [{ kind: "unsupported", field: "history", reason: "history sharing declined or failed" }] });
  });
});
