import type { ChannelSender, SendOutcome } from "@/services/messages/channel-sender";
import type { BotSettings, Knowledge } from "@/services/chatbot/types";

export const TEST_APP_SECRET = "0123456789abcdef0123456789abcdef";
export const TEST_PHONE_NUMBER_ID = "123456789012345";

export function setWhatsAppEnv(): void {
  process.env.WHATSAPP_ACCESS_TOKEN = `EAAG${"a".repeat(48)}`;
  process.env.WHATSAPP_PHONE_NUMBER_ID = TEST_PHONE_NUMBER_ID;
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "987654321098765";
  process.env.WHATSAPP_VERIFY_TOKEN = "v".repeat(48);
  process.env.META_APP_SECRET = TEST_APP_SECRET;
  process.env.WHATSAPP_API_VERSION = "v25.0";
  process.env.ADMIN_SESSION_SECRET = "s".repeat(48);
}

/** A webhook body exactly in Meta's format, with one text message. */
export function inboundPayload(options: { messageId: string; from?: string; text?: string; name?: string; timestamp?: number; phoneNumberId?: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "987654321098765",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: options.phoneNumberId ?? TEST_PHONE_NUMBER_ID },
              contacts: [{ wa_id: options.from ?? "971500000001", profile: { name: options.name ?? "Aisha" } }],
              messages: [
                {
                  id: options.messageId,
                  from: options.from ?? "971500000001",
                  timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: options.text ?? "Hello" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusPayload(options: { messageId: string; status: string; timestamp?: number; errors?: unknown[] }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "987654321098765",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: TEST_PHONE_NUMBER_ID },
              statuses: [
                {
                  id: options.messageId,
                  status: options.status,
                  timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
                  recipient_id: "971500000001",
                  ...(options.errors ? { errors: options.errors } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Coexistence: staff sent a message from the WhatsApp Business app (`smb_message_echoes`). */
export function echoPayload(options: { messageId: string; to?: string; text?: string; timestamp?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "987654321098765",
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: TEST_PHONE_NUMBER_ID },
              message_echoes: [
                {
                  from: "15550000000",
                  to: options.to ?? "971500000001",
                  id: options.messageId,
                  timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: options.text ?? "Hi from the shop" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Coexistence: one batch of shared chat history for one customer thread. */
export function historyPayload(options: { customer?: string; messages: { id: string; fromBusiness: boolean; text: string; timestamp: number; status?: string }[] }) {
  const customer = options.customer ?? "971500000009";
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "987654321098765",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: TEST_PHONE_NUMBER_ID },
              history: [
                {
                  metadata: { phase: 0, chunk_order: 1, progress: 100 },
                  threads: [
                    {
                      id: customer,
                      messages: options.messages.map((message) => ({
                        from: message.fromBusiness ? "15550000000" : customer,
                        ...(message.fromBusiness ? { to: customer } : {}),
                        id: message.id,
                        timestamp: String(message.timestamp),
                        type: "text",
                        text: { body: message.text },
                        history_context: { status: message.status ?? "READ" },
                      })),
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Records every send and returns predictable message IDs; can be told to fail. */
export class FakeSender implements ChannelSender {
  sent: { to: string | null; body: string | null; template: string | null; image?: string }[] = [];
  private counter = 0;
  failWith: Error | null = null;

  sendText(recipient: { waId: string | null }, body: string): Promise<SendOutcome> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ to: recipient.waId, body, template: null });
    this.counter += 1;
    return Promise.resolve({ kind: "sent", messageId: `wamid.OUT.${this.counter}` });
  }

  sendTemplate(recipient: { waId: string | null }, template: { name: string }): Promise<SendOutcome> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ to: recipient.waId, body: null, template: template.name });
    this.counter += 1;
    return Promise.resolve({ kind: "sent", messageId: `wamid.OUT.${this.counter}` });
  }

  sendImage(recipient: { waId: string | null }, image: { url: string; caption: string }): Promise<SendOutcome> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ to: recipient.waId, body: image.caption, template: null, image: image.url });
    this.counter += 1;
    return Promise.resolve({ kind: "sent", messageId: `wamid.OUT.${this.counter}` });
  }
}

export function botSettings(overrides: Partial<BotSettings> = {}): BotSettings {
  return {
    companyName: "Desert Bloom Flowers",
    description: "Flower shop in Dubai Marina",
    address: "Shop 12, Marina Walk, Dubai",
    mapsUrl: "https://maps.example.com/desert-bloom",
    websiteUrl: "https://desertbloom.example.com",
    instagramUrl: "https://instagram.com/desertbloom",
    timezone: "Asia/Dubai",
    businessHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: day === 5, open: "09:00", close: "21:00" })),
    specialClosures: [],
    botInstructions: "Friendly and short.",
    messages: {
      greeting: { en: "Hello {name}! How can we help?", ar: "مرحباً {name}! كيف نساعدك؟" },
      fallback: { en: "Sorry, I don't have that information. Our team will reply soon.", ar: "عذراً، لا تتوفر لدي هذه المعلومات." },
      handoff: { en: "A team member will reply shortly.", ar: "سيرد عليك أحد الموظفين قريباً." },
      outOfHours: { en: "We are closed now.", ar: "نحن مغلقون الآن." },
    },
    humanSupport: { phone: "+971 4 000 0000", email: "help@desertbloom.example.com", hoursNote: "" },
    maxResponseLength: 700,
    aiEnabled: true,
    aiFirst: false,
    ...overrides,
  };
}

export function knowledge(overrides: Partial<Knowledge> = {}): Knowledge {
  return {
    settings: botSettings(),
    faqs: [
      { id: "f1", question: "Do you deliver to Sharjah?", answer: "Yes, we deliver to Sharjah for 25 AED, same day before 4pm.", keywords: ["delivery", "shipping", "توصيل"] },
      { id: "f2", question: "What payment methods do you accept?", answer: "We accept cash, card and Apple Pay.", keywords: ["pay", "card", "cash"] },
    ],
    products: [
      { id: "p1", kind: "product", name: "Red Rose Bouquet", description: "12 fresh red roses", price: 199, currency: "AED", availability: "available", keywords: ["roses"], offer: null },
      { id: "p2", kind: "product", name: "Orchid Pot", description: "White orchid", price: null, currency: "AED", availability: "on_request", keywords: [], offer: null },
    ],
    ...overrides,
  };
}
